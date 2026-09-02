import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const script = fs.readFileSync(path.join(root, "background/service-worker.js"), "utf8");

// Build a mock chrome.storage.* store backed by an in-memory object so reads
// observe earlier writes, while `set`/`get`/`remove` remain callable mocks.
// The `errors` map can mark a specific operation to fail by setting
// `chrome.runtime.lastError` inside its callback, WITHOUT mutating stored data
// (so failure tests remain meaningful). `set`/`remove` error specs may be a
// boolean or a function (obj, perOperationCallIndex) => boolean for call-scoped
// failures.
function createBackedStore(initial = {}, errors = {}) {
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

function loadWorker(storedSettings, storedPages = {}, options = {}) {
  let installedHandler;
  let messageHandler;
  const localInit = storedSettings !== undefined ? { settings: storedSettings } : {};
  const sessionInit = storedPages ? { readingPages: storedPages } : {};
  const local = createBackedStore(localInit, {
    get: options.localGetError,
    set: options.localSetError,
    remove: options.localRemoveError
  });
  const session = createBackedStore(sessionInit, {
    get: options.sessionGetError,
    set: options.sessionSetError,
    remove: options.sessionRemoveError
  });
  const onTabsCreate = options.onTabsCreate;
  const tabsMock = {
    create: vi.fn((props, callback) => {
      if (onTabsCreate) {
        onTabsCreate(props, callback);
      } else if (options.tabsCreateError) {
        chrome.runtime.lastError = { message: "create failed" };
        callback();
        chrome.runtime.lastError = null;
      } else {
        callback({ id: 123, url: props.url });
      }
    })
  };

  globalThis.chrome = {
    runtime: {
      lastError: null,
      onInstalled: { addListener: vi.fn((handler) => { installedHandler = handler; }) },
      onMessage: { addListener: vi.fn((handler) => { messageHandler = handler; }) }
    },
    storage: {
      local: { get: local.get, set: local.set, remove: local.remove },
      session: { get: session.get, set: session.set, remove: session.remove }
    },
    tabs: options.disableTabs ? undefined : tabsMock
  };

  window.eval(script);
  return {
    installedHandler,
    messageHandler,
    localSet: local.set,
    sessionSet: session.set,
    localStore: local,
    sessionStore: session,
    localData: local.data,
    sessionData: session.data,
    tabsCreate: chrome.tabs ? chrome.tabs.create : undefined,
    chromeRef: chrome
  };
}

describe("ReadTrail service worker", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("creates an independent default settings object on install", () => {
    const { installedHandler, localSet } = loadWorker(undefined);
    installedHandler();

    expect(localSet).toHaveBeenCalledWith({
      settings: expect.objectContaining({ style: "ruler" })
    });
  });

  it("merges stored values with defaults when settings are requested", () => {
    const { messageHandler } = loadWorker({ style: "dots" });
    const sendResponse = vi.fn();

    expect(messageHandler({ type: "getSettings" }, {}, sendResponse)).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ style: "dots", size: 30 })
    );
  });

  it("removes the legacy global enable setting during extension updates", () => {
    const { installedHandler, localSet } = loadWorker({ enabled: false, style: "underline" });
    installedHandler();

    expect(localSet).toHaveBeenCalledWith({
      settings: expect.objectContaining({ style: "underline" })
    });
    expect(localSet.mock.calls[0][0].settings).not.toHaveProperty("enabled");
  });

  it("does not expose or accept the removed global enable setting", () => {
    const { messageHandler } = loadWorker({ enabled: false, style: "underline" });
    const sendResponse = vi.fn();

    expect(messageHandler({ type: "getSettings" }, {}, sendResponse)).toBe(true);
    expect(sendResponse.mock.calls[0][0]).not.toHaveProperty("enabled");
    expect(messageHandler({ type: "toggleEnabled", enabled: false }, {}, vi.fn())).toBe(false);
  });

  it("returns an inactive default for a page without session state", () => {
    const { messageHandler, sessionSet } = loadWorker({});
    const sendResponse = vi.fn();

    expect(messageHandler(
      { type: "getPageState", url: "https://example.com/article#part" },
      {},
      sendResponse
    )).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      state: { version: 1, active: false, mode: "following", position: null }
    });
    expect(sessionSet).not.toHaveBeenCalled();
  });

  it("isolates activation by exact page URL and retains an existing position", () => {
    const url = "https://example.com/article?edition=1#part";
    const position = {
      anchor: { version: 1, path: [0, 1], offset: 2 },
      viewportOffset: 40,
      scrollY: 300,
      scrollRatio: 0.25,
      savedAt: 123
    };
    const storedPages = {
      [url]: { version: 1, active: true, mode: "frozen", position }
    };
    const { messageHandler, sessionSet } = loadWorker({}, storedPages);
    const sendResponse = vi.fn();

    expect(messageHandler({ type: "setPageActive", url, active: false }, {}, sendResponse)).toBe(true);
    expect(sessionSet).toHaveBeenCalledWith({
      readingPages: expect.objectContaining({
        [url]: expect.objectContaining({ active: false, mode: "frozen", position })
      })
    }, expect.any(Function));
    expect(storedPages[url].active).toBe(true);
    expect(storedPages["https://example.com/article?edition=2#part"]).toBeUndefined();
  });

  it("saves a validated position only for an active page", () => {
    const url = "https://example.com/article";
    const position = {
      anchor: { version: 1, path: [0, 1], offset: 2 },
      viewportOffset: 40,
      scrollY: 300,
      scrollRatio: 0.25,
      savedAt: 123
    };
    const { messageHandler, sessionSet } = loadWorker({}, {
      [url]: { version: 1, active: true, mode: "following", position: null }
    });
    const sendResponse = vi.fn();

    expect(messageHandler(
      { type: "savePagePosition", url, mode: "frozen", position },
      {},
      sendResponse
    )).toBe(true);
    expect(sessionSet).toHaveBeenCalledWith({
      readingPages: expect.objectContaining({
        [url]: { version: 1, active: true, mode: "frozen", position }
      })
    }, expect.any(Function));
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      state: { version: 1, active: true, mode: "frozen", position }
    });
  });

  it("rejects writes for inactive pages and malformed records", () => {
    const url = "https://example.com/article";
    const position = {
      anchor: { version: 1, path: [0], offset: 0 },
      viewportOffset: 10,
      scrollY: 0,
      scrollRatio: 0,
      savedAt: 123
    };
    const { messageHandler, sessionSet } = loadWorker({});
    const sendResponse = vi.fn();

    expect(messageHandler(
      { type: "savePagePosition", url, mode: "following", position },
      {},
      sendResponse
    )).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "page-inactive" });
    expect(sessionSet).not.toHaveBeenCalled();

    expect(messageHandler(
      { type: "savePagePosition", url, mode: "following", position: { ...position, scrollRatio: 2 } },
      {},
      vi.fn()
    )).toBe(false);
    expect(messageHandler(
      { type: "setPageActive", url: "chrome://extensions", active: true },
      {},
      vi.fn()
    )).toBe(false);
    expect(sessionSet).not.toHaveBeenCalled();
  });

  describe("persistent saved-page service", () => {
    const urlA = "https://example.com/article-a";
    const urlB = "https://example.com/article-b";

    function position(overrides = {}) {
      return {
        anchor: { version: 1, path: [0, 1], offset: 2 },
        viewportOffset: 40,
        scrollY: 300,
        scrollRatio: 0.25,
        savedAt: 123,
        ...overrides
      };
    }

    function senderFor(tabUrl) {
      return { tab: { id: 42, url: tabUrl, incognito: false } };
    }

    function savedKeyFor(url) {
      return `readtrail.saved.v1:${url}`;
    }

    it("persists a validated resume point from a non-incognito tab", () => {
      const { messageHandler, localData, localSet } = loadWorker({});
      const sendResponse = vi.fn();
      const msg = { type: "persistResumePoint", url: urlA, title: "  Article A  ", position: position() };

      expect(messageHandler(msg, senderFor(urlA), sendResponse)).toBe(true);

      const key = savedKeyFor(urlA);
      const record = localData[key];
      expect(record).toBeDefined();
      expect(record.title).toBe("Article A");
      expect(record.version).toBe(1);
      expect(record.position).toEqual(position());
      expect(typeof record.savedAt).toBe("number");
      expect(record.savedAt).toBeGreaterThan(0);
      expect(localSet).toHaveBeenCalledWith({ [key]: record }, expect.any(Function));
      expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });

    it("isolates saved records by exact URL and does not store passage text", () => {
      const { messageHandler, localData } = loadWorker({});
      const positionA = position({ scrollY: 100 });
      const positionB = position({ scrollY: 200 });
      const extra = { passage: "secret text", source: "auto-history" };

      messageHandler(
        { type: "persistResumePoint", url: urlA, title: "A", position: positionA, ...extra },
        senderFor(urlA),
        vi.fn()
      );
      messageHandler(
        { type: "persistResumePoint", url: urlB, title: "B", position: positionB, ...extra },
        senderFor(urlB),
        vi.fn()
      );

      expect(localData[savedKeyFor(urlA)].position).toEqual(positionA);
      expect(localData[savedKeyFor(urlB)].position).toEqual(positionB);
      expect(localData[savedKeyFor(urlA)]).not.toHaveProperty("passage");
      expect(localData[savedKeyFor(urlA)]).not.toHaveProperty("source");
      expect(localData[savedKeyFor(urlA)]).not.toHaveProperty("url");
    });

    it("re-saving replaces only that exact URL's record", () => {
      const { messageHandler, localData } = loadWorker({});
      const first = { type: "persistResumePoint", url: urlA, title: "First", position: position({ scrollY: 1 }) };
      const second = { type: "persistResumePoint", url: urlA, title: "Second", position: position({ scrollY: 2 }) };
      const other = { type: "persistResumePoint", url: urlB, title: "B", position: position({ scrollY: 3 }) };

      messageHandler(first, senderFor(urlA), vi.fn());
      messageHandler(other, senderFor(urlB), vi.fn());
      messageHandler(second, senderFor(urlA), vi.fn());

      const keys = Object.keys(localData).filter((k) => k.startsWith("readtrail.saved.v1:"));
      expect(keys).toEqual([savedKeyFor(urlA), savedKeyFor(urlB)]);
      expect(localData[savedKeyFor(urlA)].title).toBe("Second");
      expect(localData[savedKeyFor(urlA)].position.scrollY).toBe(2);
      expect(localData[savedKeyFor(urlB)].position.scrollY).toBe(3);
    });

    it("rejects a sender URL mismatch", () => {
      const { messageHandler, localData } = loadWorker({});
      const sendResponse = vi.fn();

      expect(messageHandler(
        { type: "persistResumePoint", url: urlA, title: "A", position: position() },
        senderFor("https://example.com/different"),
        sendResponse
      )).toBe(true);
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "invalid-input" });
      expect(localData).not.toHaveProperty(savedKeyFor(urlA));
    });

    it("rejects incognito, non-tab, and malformed-tab-id senders", () => {
      const { messageHandler, localData } = loadWorker({});
      const sendResponse = vi.fn();
      const msg = { type: "persistResumePoint", url: urlA, title: "A", position: position() };

      expect(messageHandler(msg, { tab: { id: 42, url: urlA, incognito: true } }, vi.fn())).toBe(true);
      expect(messageHandler(msg, {}, vi.fn())).toBe(true);
      expect(messageHandler(msg, undefined, vi.fn())).toBe(true);
      expect(localData).not.toHaveProperty(savedKeyFor(urlA));

      // Valid-looking sender but a missing or non-integer tab id must be refused.
      expect(messageHandler(msg, { tab: { url: urlA, incognito: false } }, vi.fn())).toBe(true);
      expect(messageHandler(msg, { tab: { id: "7", url: urlA, incognito: false } }, vi.fn())).toBe(true);
      expect(messageHandler(msg, { tab: { id: -1, url: urlA, incognito: false } }, vi.fn())).toBe(true);
      expect(messageHandler(
        { type: "persistResumePoint", url: urlA, title: "A", position: position() },
        { tab: { id: 42, url: urlA, incognito: false } },
        sendResponse
      )).toBe(true);
      expect(sendResponse).toHaveBeenCalledWith({ ok: true });
      expect(localData).toHaveProperty(savedKeyFor(urlA));
    });

    it("rejects malformed and oversized titles", () => {
      const { messageHandler, localData } = loadWorker({});
      const blank = vi.fn();
      const oversized = vi.fn();

      messageHandler(
        { type: "persistResumePoint", url: urlA, title: "   ", position: position() },
        senderFor(urlA),
        blank
      );
      messageHandler(
        { type: "persistResumePoint", url: urlA, title: "x".repeat(513), position: position() },
        senderFor(urlA),
        oversized
      );

      expect(blank).toHaveBeenCalledWith({ ok: false, error: "invalid-input" });
      expect(oversized).toHaveBeenCalledWith({ ok: false, error: "invalid-input" });
      expect(localData).not.toHaveProperty(savedKeyFor(urlA));
    });

    it("rejects malformed and oversized positions, including over-deep anchors", () => {
      const { messageHandler, localData } = loadWorker({});
      const bad = vi.fn();
      const badRatio = vi.fn();
      const deep = vi.fn();
      const overIndex = vi.fn();
      const overOffset = vi.fn();

      messageHandler(
        { type: "persistResumePoint", url: urlA, title: "A", position: position({ scrollRatio: 2 }) },
        senderFor(urlA),
        badRatio
      );
      messageHandler(
        { type: "persistResumePoint", url: urlA, title: "A", position: position({ scrollY: "300" }) },
        senderFor(urlA),
        bad
      );
      messageHandler(
        {
          type: "persistResumePoint",
          url: urlA,
          title: "A",
          position: position({ anchor: { version: 1, path: Array.from({ length: 65 }, () => 0), offset: 0 } })
        },
        senderFor(urlA),
        deep
      );
      // Path index values and anchor offset must respect their explicit durable bounds.
      messageHandler(
        {
          type: "persistResumePoint",
          url: urlA,
          title: "A",
          position: position({ anchor: { version: 1, path: [0, 100001], offset: 0 } })
        },
        senderFor(urlA),
        overIndex
      );
      messageHandler(
        {
          type: "persistResumePoint",
          url: urlA,
          title: "A",
          position: position({ anchor: { version: 1, path: [0], offset: 1000001 } })
        },
        senderFor(urlA),
        overOffset
      );

      expect(badRatio).toHaveBeenCalledWith({ ok: false, error: "invalid-input" });
      expect(bad).toHaveBeenCalledWith({ ok: false, error: "invalid-input" });
      expect(deep).toHaveBeenCalledWith({ ok: false, error: "invalid-input" });
      expect(overIndex).toHaveBeenCalledWith({ ok: false, error: "invalid-input" });
      expect(overOffset).toHaveBeenCalledWith({ ok: false, error: "invalid-input" });
      expect(localData).not.toHaveProperty(savedKeyFor(urlA));
    });

    it("accepts durable positions at the explicit anchor bounds", () => {
      const { messageHandler, localData } = loadWorker({});
      // A max-depth path with a max-index and max-offset is still accepted.
      const boundary = position({
        anchor: {
          version: 1,
          path: Array.from({ length: 64 }, (_, i) => (i === 63 ? 100000 : 0)),
          offset: 1000000
        }
      });
      messageHandler(
        { type: "persistResumePoint", url: urlA, title: "Boundary", position: boundary },
        senderFor(urlA),
        vi.fn()
      );
      expect(localData[savedKeyFor(urlA)].position.anchor.path).toHaveLength(64);
      expect(localData[savedKeyFor(urlA)].position.anchor.offset).toBe(1000000);
    });

    it("gets an existing saved record and null for a missing one", () => {
      const { messageHandler, localData } = loadWorker({});
      const msg = { type: "persistResumePoint", url: urlA, title: "A", position: position() };
      messageHandler(msg, senderFor(urlA), vi.fn());

      const got = vi.fn();
      expect(messageHandler({ type: "getSavedResumePoint", url: urlA }, {}, got)).toBe(true);
      const returned = got.mock.calls[0][0];
      expect(returned.ok).toBe(true);
      expect(returned.record.url).toBeUndefined();
      expect(returned.record.title).toBe("A");
      expect(returned.record.position).toEqual(localData[savedKeyFor(urlA)].position);

      const missing = vi.fn();
      messageHandler({ type: "getSavedResumePoint", url: urlB }, {}, missing);
      expect(missing).toHaveBeenCalledWith({ ok: true, record: null });
    });

    it("lists saved points sorted newest savedAt first with url attached", () => {
      let now = 1000;
      vi.spyOn(Date, "now").mockImplementation(() => {
        now += 100;
        return now;
      });
      const { messageHandler } = loadWorker({});
      messageHandler(
        { type: "persistResumePoint", url: urlA, title: "A", position: position({ scrollY: 1 }) },
        senderFor(urlA),
        vi.fn()
      );
      messageHandler(
        { type: "persistResumePoint", url: urlB, title: "B", position: position({ scrollY: 2 }) },
        senderFor(urlB),
        vi.fn()
      );

      const done = vi.fn();
      expect(messageHandler({ type: "listSavedResumePoints" }, {}, done)).toBe(true);
      const items = done.mock.calls[0][0].items;
      expect(done.mock.calls[0][0].ok).toBe(true);
      expect(items.map((i) => i.url)).toEqual([urlB, urlA]);
      expect(items[0]).toMatchObject({ url: urlB, title: "B" });
    });

    it("ignores malformed and unrelated stored entries when listing", () => {
      const local = loadWorker({});
      const keyA = savedKeyFor(urlA);
      const keyB = savedKeyFor(urlB);
      // Seed one valid prefixed record, one malformed prefixed record, one
      // unrelated key, and a settings appearance key.
      local.localData[keyA] = { version: 1, title: "A", position: position({ scrollY: 1 }), savedAt: 100 };
      local.localData[keyB] = { version: 1, title: "B", position: { not: "valid" }, savedAt: 200 };
      local.localData["readtrail.saved.v1:https://[broken"] = { version: 1, title: "X", position: position(), savedAt: 300 };
      local.localData["settings"] = { color: "#000000" };
      local.localData["readtrail.unrelated"] = { something: true };

      const done = vi.fn();
      expect(local.messageHandler({ type: "listSavedResumePoints" }, {}, done)).toBe(true);
      const items = done.mock.calls[0][0].items;
      expect(items).toEqual([
        { url: urlA, version: 1, title: "A", position: position({ scrollY: 1 }), savedAt: 100 }
      ]);
    });

    it("ignores stored records with whitespace-only or padded titles", () => {
      const { messageHandler, localData } = loadWorker({});
      const keyA = savedKeyFor(urlA);
      const keyB = savedKeyFor(urlB);
      const keyC = savedKeyFor("https://example.com/article-c");
      const valid = { version: 1, title: "Valid", position: position({ scrollY: 1 }), savedAt: 100 };
      const whitespaceOnly = { version: 1, title: "   ", position: position({ scrollY: 2 }), savedAt: 200 };
      const padded = { version: 1, title: "  Padded  ", position: position({ scrollY: 3 }), savedAt: 300 };

      localData[keyA] = valid;
      localData[keyB] = whitespaceOnly;
      localData[keyC] = padded;

      // get ignores corrupt titles.
      const got = vi.fn();
      messageHandler({ type: "getSavedResumePoint", url: urlA }, {}, got);
      expect(got).toHaveBeenCalledWith({ ok: true, record: expect.objectContaining({ title: "Valid" }) });
      const gotB = vi.fn();
      messageHandler({ type: "getSavedResumePoint", url: "https://example.com/article-b" }, {}, gotB);
      expect(gotB).toHaveBeenCalledWith({ ok: true, record: null });

      // list includes only canonical-titled records.
      const listed = vi.fn();
      messageHandler({ type: "listSavedResumePoints" }, {}, listed);
      expect(listed.mock.calls[0][0].items).toEqual([
        { url: urlA, version: 1, title: "Valid", position: position({ scrollY: 1 }), savedAt: 100 }
      ]);

      // continue refuses corrupt-titled records without opening a tab.
      const done = vi.fn();
      expect(messageHandler({ type: "continueSavedResumePoint", url: "https://example.com/article-b" }, {}, done)).toBe(true);
      expect(done).toHaveBeenCalledWith({ ok: false, error: "no-saved-record" });
    });

    it("removes only the exact matching saved record", () => {
      const { messageHandler, localStore, localData } = loadWorker({});
      const msg = { type: "persistResumePoint", url: urlA, title: "A", position: position() };
      messageHandler(msg, senderFor(urlA), vi.fn());
      const keyA = savedKeyFor(urlA);
      const sentinel = { keep: true };
      localData["settings"] = sentinel;

      const done = vi.fn();
      expect(messageHandler({ type: "removeSavedResumePoint", url: urlA }, {}, done)).toBe(true);
      expect(done).toHaveBeenCalledWith({ ok: true });
      expect(localData[keyA]).toBeUndefined();
      expect(localData["settings"]).toBe(sentinel);
      expect(localStore.remove).toHaveBeenCalledWith([keyA], expect.any(Function));
    });

    it("clears only prefixed saved records, preserving settings and unrelated keys", () => {
      const { messageHandler, localData } = loadWorker({});
      const keyA = savedKeyFor(urlA);
      const keyB = savedKeyFor(urlB);
      const settings = { color: "#FFEE00" };
      const unrelated = { anything: true };
      localData[keyA] = { version: 1, title: "A", position: position({ scrollY: 1 }), savedAt: 1 };
      localData[keyB] = { version: 1, title: "B", position: position({ scrollY: 2 }), savedAt: 2 };
      localData["settings"] = settings;
      localData["readtrail.unrelated"] = unrelated;

      const done = vi.fn();
      expect(messageHandler({ type: "clearSavedResumePoints" }, {}, done)).toBe(true);
      expect(done).toHaveBeenCalledWith({ ok: true });
      expect(localData[keyA]).toBeUndefined();
      expect(localData[keyB]).toBeUndefined();
      expect(localData["settings"]).toBe(settings);
      expect(localData["readtrail.unrelated"]).toBe(unrelated);
    });

    it("continues: seeds session state active/frozen with persistent position before opening the tab", () => {
      const storedRecord = {
        version: 1,
        title: "A",
        position: position({ scrollY: 42 }),
        savedAt: 500
      };
      const { messageHandler, localStore, sessionData, tabsCreate } = loadWorker(
        {},
        {},
        {
          onTabsCreate: (_props, callback) => {
            // At the moment the tab is opened, the session must already be
            // seeded with the persistent position (proving order).
            const state = sessionData.readingPages && sessionData.readingPages[urlA];
            expect(state).toMatchObject({
              version: 1,
              active: true,
              mode: "frozen",
              position: expect.objectContaining({ scrollY: 42 })
            });
            callback({ id: 9, url: urlA });
          }
        }
      );
      localStore.data[savedKeyFor(urlA)] = storedRecord;

      const done = vi.fn();
      expect(messageHandler({ type: "continueSavedResumePoint", url: urlA }, {}, done)).toBe(true);
      expect(tabsCreate).toHaveBeenCalledWith({ url: urlA }, expect.any(Function));
      expect(done).toHaveBeenCalledWith({ ok: true, tabId: 9 });
    });

    it("continue: takes no valid tab without stored record and never writes persistent data", () => {
      const storedRecord = { version: 1, title: "A", position: position({ scrollY: 7 }), savedAt: 500 };
      const { messageHandler, localData, sessionData, tabsCreate } = loadWorker({});
      const keyA = savedKeyFor(urlA);
      localData[keyA] = storedRecord;
      const before = { ...localData[keyA] };

      const done = vi.fn();
      expect(messageHandler({ type: "continueSavedResumePoint", url: urlB }, {}, done)).toBe(true);
      expect(done).toHaveBeenCalledWith({ ok: false, error: "no-saved-record" });
      expect(tabsCreate).not.toHaveBeenCalled();
      expect(sessionData.readingPages || {}).not.toHaveProperty(urlB);
      expect(localData[keyA]).toEqual(storedRecord);
      expect(before).toEqual(storedRecord);
    });

    it("continue: does not modify the persistent record", () => {
      const storedRecord = { version: 1, title: "A", position: position({ scrollY: 11 }), savedAt: 500 };
      const { messageHandler, localData } = loadWorker({});
      localData[savedKeyFor(urlA)] = storedRecord;

      const done = vi.fn();
      messageHandler({ type: "continueSavedResumePoint", url: urlA }, {}, done);
      expect(done).toHaveBeenCalledWith({ ok: true, tabId: 123 });
      expect(localData[savedKeyFor(urlA)]).toEqual(storedRecord);
    });

    it("continue: rolls back session state exactly when tab creation fails", () => {
      const storedRecord = { version: 1, title: "A", position: position({ scrollY: 5 }), savedAt: 500 };
      const previous = { version: 1, active: true, mode: "following", position: position({ scrollY: 999 }) };
      const { messageHandler, localStore, sessionStore, sessionData, tabsCreate } = loadWorker(
        {},
        { [urlA]: previous },
        { onTabsCreate: (_props, callback) => callback(null) }
      );
      localStore.data[savedKeyFor(urlA)] = storedRecord;
      // Retain the same object identity so restoration is verified exactly.
      const previousValue = sessionData.readingPages[urlA];

      const done = vi.fn();
      expect(messageHandler({ type: "continueSavedResumePoint", url: urlA }, {}, done)).toBe(true);
      expect(tabsCreate).toHaveBeenCalledWith({ url: urlA }, expect.any(Function));
      expect(done).toHaveBeenCalledWith({ ok: false, error: "tab-create-failed" });
      // The session seed was rolled back to the exact previous state.
      expect(sessionData.readingPages[urlA]).toEqual(previousValue);
      expect(sessionData.readingPages[urlA]).toEqual(previous);
      // The persistent record was never touched.
      expect(localStore.data[savedKeyFor(urlA)]).toEqual(storedRecord);
      // Rollback wrote session storage (the removed seed either restored or removed the key).
      expect(sessionStore.set).toHaveBeenCalledTimes(2);
    });

    it("persist: a failed storage write does not store the record", () => {
      const msg = { type: "persistResumePoint", url: urlA, title: "A", position: position() };

      const failing = loadWorker({}, {}, { localSetError: true });
      const done = vi.fn();
      expect(failing.messageHandler(msg, senderFor(urlA), done)).toBe(true);
      expect(done).toHaveBeenCalledWith({ ok: false, error: "save-storage-error" });
      // No data was mutated on the failed write.
      expect(failing.localData).not.toHaveProperty(savedKeyFor(urlA));
    });

    it("continue: fails safely when chrome.tabs is unavailable", () => {
      const storedRecord = { version: 1, title: "A", position: position({ scrollY: 13 }), savedAt: 500 };
      const previous = { version: 1, active: true, mode: "following", position: position({ scrollY: 999 }) };
      const { messageHandler, localStore, sessionStore } = loadWorker(
        {},
        { [urlA]: previous },
        { disableTabs: true }
      );
      localStore.data[savedKeyFor(urlA)] = storedRecord;

      const done = vi.fn();
      expect(messageHandler({ type: "continueSavedResumePoint", url: urlA }, {}, done)).toBe(true);
      expect(done).toHaveBeenCalledWith({ ok: false, error: "tabs-unavailable" });
      expect(sessionStore.set).toHaveBeenCalledTimes(2); // seed + rollback
      // Seed was rolled back to the exact previous state.
      expect(sessionStore.data.readingPages[urlA]).toEqual(previous);
    });

    it("continue: returns a stable error when the session get fails, without seeding or opening a tab", () => {
      const storedRecord = { version: 1, title: "A", position: position({ scrollY: 21 }), savedAt: 500 };
      const { messageHandler, localStore, sessionStore, sessionData, tabsCreate } = loadWorker(
        {},
        {},
        { sessionGetError: true }
      );
      localStore.data[savedKeyFor(urlA)] = storedRecord;

      const done = vi.fn();
      expect(messageHandler({ type: "continueSavedResumePoint", url: urlA }, {}, done)).toBe(true);
      expect(done).toHaveBeenCalledWith({ ok: false, error: "session-read-error" });
      expect(sessionStore.set).not.toHaveBeenCalled();
      expect(tabsCreate).not.toHaveBeenCalled();
      expect((sessionData.readingPages || {})[urlA]).toBeUndefined();
    });

    it("continue: reports tab-create lastError as tab-create-failed after rolling back", () => {
      const storedRecord = { version: 1, title: "A", position: position({ scrollY: 29 }), savedAt: 500 };
      const previous = { version: 1, active: true, mode: "following", position: position({ scrollY: 999 }) };
      const { messageHandler, localStore, sessionStore, sessionData } = loadWorker(
        {},
        { [urlA]: previous },
        { tabsCreateError: true }
      );
      localStore.data[savedKeyFor(urlA)] = storedRecord;

      const done = vi.fn();
      expect(messageHandler({ type: "continueSavedResumePoint", url: urlA }, {}, done)).toBe(true);
      expect(done).toHaveBeenCalledWith({ ok: false, error: "tab-create-failed" });
      expect(sessionStore.set).toHaveBeenCalledTimes(2); // seed + rollback
      expect(sessionData.readingPages[urlA]).toEqual(previous);
    });

    it("continue: reports a distinct error when the rollback session write itself fails", () => {
      const storedRecord = { version: 1, title: "A", position: position({ scrollY: 37 }), savedAt: 500 };
      const previous = { version: 1, active: true, mode: "following", position: position({ scrollY: 999 }) };
      // Seed set (set #1) succeeds; rollback set (set #2) fails.
      const { messageHandler, localStore, sessionStore, tabsCreate } = loadWorker(
        {},
        { [urlA]: previous },
        {
          onTabsCreate: (_props, callback) => callback(null),
          sessionSetError: (_obj, n) => n === 2
        }
      );
      localStore.data[savedKeyFor(urlA)] = storedRecord;

      const done = vi.fn();
      expect(messageHandler({ type: "continueSavedResumePoint", url: urlA }, {}, done)).toBe(true);
      expect(done).toHaveBeenCalledWith({ ok: false, error: "rollback-storage-error" });
      expect(tabsCreate).toHaveBeenCalledWith({ url: urlA }, expect.any(Function));
      expect(sessionStore.set).toHaveBeenCalledTimes(2);
    });
  });
});
