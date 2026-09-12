import { vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const EXTENSION_ORIGIN = "chrome-extension://test/";

export function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

// Evaluates the shared classic scripts into the JSDOM window so surfaces under
// test see the same `ReadTrailShared` namespace they get in Chrome.
export function loadShared() {
  window.eval(readSource("shared/constants.js"));
  window.eval(readSource("shared/validators.js"));
  return globalThis.ReadTrailShared;
}

// Build a mock chrome.storage.* store backed by an in-memory object so reads
// observe earlier writes, while `set`/`get`/`remove` remain callable mocks.
// The `errors` map can mark a specific operation to fail by setting
// `chrome.runtime.lastError` inside its callback, WITHOUT mutating stored data.
// `set`/`remove` error specs may be a boolean or a function
// (arg, perOperationCallIndex) => boolean for call-scoped failures.
export function createBackedStore(initial = {}, errors = {}) {
  const data = { ...initial };
  const getCalls = { n: 0 };
  const setCalls = { n: 0 };
  const removeCalls = { n: 0 };

  function shouldFail(spec, arg, callIndex) {
    if (typeof spec === "function") return Boolean(spec(arg, callIndex));
    return Boolean(spec);
  }

  const get = vi.fn((key, callback) => {
    getCalls.n += 1;
    const fail = shouldFail(errors.get, key, getCalls.n);
    let result = {};
    if (key === null || key === undefined) {
      result = { ...data };
    } else if (typeof key === "string") {
      if (Object.prototype.hasOwnProperty.call(data, key)) result[key] = data[key];
    } else if (Array.isArray(key)) {
      for (const k of key) {
        if (Object.prototype.hasOwnProperty.call(data, k)) result[k] = data[k];
      }
    }
    chrome.runtime.lastError = fail ? { message: "operation failed" } : null;
    callback(result);
    chrome.runtime.lastError = null;
  });

  const set = vi.fn((obj, callback) => {
    setCalls.n += 1;
    const fail = shouldFail(errors.set, obj, setCalls.n);
    chrome.runtime.lastError = fail ? { message: "operation failed" } : null;
    if (!fail) Object.assign(data, obj);
    callback?.();
    chrome.runtime.lastError = null;
  });

  const remove = vi.fn((keys, callback) => {
    removeCalls.n += 1;
    const fail = shouldFail(errors.remove, keys, removeCalls.n);
    const list = Array.isArray(keys) ? keys : [keys];
    chrome.runtime.lastError = fail ? { message: "operation failed" } : null;
    if (!fail) for (const k of list) delete data[k];
    callback?.();
    chrome.runtime.lastError = null;
  });

  return { get, set, remove, data };
}

function createEvent() {
  const listeners = [];
  return {
    addListener: vi.fn((handler) => { listeners.push(handler); }),
    removeListener: vi.fn((handler) => {
      const index = listeners.indexOf(handler);
      if (index >= 0) listeners.splice(index, 1);
    }),
    emit: (...args) => listeners.slice().map((handler) => handler(...args)),
    listeners
  };
}

// Sender factories matching what Chrome passes to runtime.onMessage.
export const senders = {
  content(tabId, url, extra = {}) {
    return { tab: { id: tabId, url, incognito: false, ...extra } };
  },
  page(relativePath = "sidepanel/sidepanel.html") {
    return { url: EXTENSION_ORIGIN + relativePath };
  }
};

// Full chrome mock for the service worker and extension pages. Returns the
// mock plus `emit` helpers that fire registered listeners synchronously.
export function createChromeMock({
  local = {},
  session = {},
  errors = {},
  tabs = [],
  disableTabs = false,
  onTabsCreate = null,
  tabsCreateError = false
} = {}) {
  const localStore = createBackedStore(local, errors.local || {});
  const sessionStore = createBackedStore(session, errors.session || {});
  const tabTable = new Map(tabs.map((tab) => [tab.id, tab]));
  let nextTabId = 100;

  const events = {
    onInstalled: createEvent(),
    onMessage: createEvent(),
    tabsOnRemoved: createEvent(),
    tabsOnReplaced: createEvent(),
    tabsOnActivated: createEvent(),
    tabsOnUpdated: createEvent(),
    storageOnChanged: createEvent(),
    windowsOnFocusChanged: createEvent()
  };

  const tabsMock = {
    create: vi.fn((props, callback) => {
      if (onTabsCreate) {
        onTabsCreate(props, callback);
        return;
      }
      if (tabsCreateError) {
        chrome.runtime.lastError = { message: "create failed" };
        callback();
        chrome.runtime.lastError = null;
        return;
      }
      const tab = { id: nextTabId++, url: props.url, incognito: false };
      tabTable.set(tab.id, tab);
      callback(tab);
    }),
    get: vi.fn((tabId, callback) => {
      const tab = tabTable.get(tabId);
      chrome.runtime.lastError = tab ? null : { message: "No tab with id" };
      callback(tab ? { ...tab } : undefined);
      chrome.runtime.lastError = null;
    }),
    query: vi.fn((_query, callback) => {
      callback([...tabTable.values()].filter((tab) => tab.active));
    }),
    sendMessage: vi.fn((_tabId, _message, callback) => {
      chrome.runtime.lastError = { message: "no receiver" };
      callback?.(undefined);
      chrome.runtime.lastError = null;
    }),
    onRemoved: events.tabsOnRemoved,
    onReplaced: events.tabsOnReplaced,
    onActivated: events.tabsOnActivated,
    onUpdated: events.tabsOnUpdated
  };

  const chromeMock = {
    runtime: {
      lastError: null,
      getURL: vi.fn((relativePath) => EXTENSION_ORIGIN + relativePath),
      onInstalled: events.onInstalled,
      onMessage: events.onMessage,
      sendMessage: vi.fn(),
      openOptionsPage: vi.fn()
    },
    storage: {
      local: { get: localStore.get, set: localStore.set, remove: localStore.remove },
      session: { get: sessionStore.get, set: sessionStore.set, remove: sessionStore.remove },
      onChanged: events.storageOnChanged
    },
    tabs: disableTabs ? undefined : tabsMock,
    windows: { onFocusChanged: events.windowsOnFocusChanged },
    action: { setBadgeText: vi.fn((_details, callback) => callback?.()) },
    sidePanel: { setPanelBehavior: vi.fn(() => Promise.resolve()) }
  };

  const emit = {
    installed: () => events.onInstalled.emit(),
    message: (msg, sender, sendResponse) => {
      const handler = events.onMessage.listeners[0];
      return handler ? handler(msg, sender, sendResponse) : undefined;
    },
    tabs: {
      onRemoved: (tabId, info = { isWindowClosing: false }) => {
        tabTable.delete(tabId);
        return events.tabsOnRemoved.emit(tabId, info);
      },
      onReplaced: (addedTabId, removedTabId) => events.tabsOnReplaced.emit(addedTabId, removedTabId),
      onActivated: (info) => events.tabsOnActivated.emit(info),
      onUpdated: (tabId, changeInfo, tab) => events.tabsOnUpdated.emit(tabId, changeInfo, tab)
    },
    storage: {
      onChanged: (changes, areaName) => events.storageOnChanged.emit(changes, areaName)
    },
    windows: {
      onFocusChanged: (windowId) => events.windowsOnFocusChanged.emit(windowId)
    }
  };

  return { chrome: chromeMock, emit, localStore, sessionStore, tabTable };
}

// Loads the service worker into the JSDOM window with a fresh chrome mock.
// `importScripts` is shimmed to evaluate the shared modules from disk.
export function loadServiceWorker(options = {}) {
  const mock = createChromeMock(options);
  globalThis.chrome = mock.chrome;
  globalThis.importScripts = (...paths) => {
    for (const relative of paths) {
      window.eval(fs.readFileSync(path.resolve(ROOT, "background", relative), "utf8"));
    }
  };
  window.eval(readSource("background/service-worker.js"));
  return {
    ...mock,
    messageHandler: (msg, sender, sendResponse) => mock.emit.message(msg, sender, sendResponse),
    installedHandler: () => mock.emit.installed(),
    localData: mock.localStore.data,
    sessionData: mock.sessionStore.data,
    localSet: mock.localStore.set,
    sessionSet: mock.sessionStore.set,
    tabsCreate: mock.chrome.tabs ? mock.chrome.tabs.create : undefined
  };
}
