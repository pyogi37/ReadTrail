const DEFAULTS = {
  style: "ruler",
  color: "#FF6B6B",
  size: 30,
  opacity: 0.3,
  dotCount: 20,
  fadeSpeed: 0.9,
  highlightLine: false,
  highlightColor: "#FFEB3B"
};

const PAGE_STATE_VERSION = 1;
const DEFAULT_PAGE_STATE = Object.freeze({
  version: PAGE_STATE_VERSION,
  active: false,
  mode: "following",
  position: null
});

const SAVED_PREFIX = "readtrail.saved.v1:";
const SAVED_VERSION = 1;
const SAVED_TITLE_MAX = 512;
// Bound durable anchor geometry so malformed records cannot carry enormous
// integers into persistent storage. Session-state anchors stay unconstrained.
const SAVED_ANCHOR_MAX_DEPTH = 64;
const SAVED_ANCHOR_MAX_INDEX = 100000;
const SAVED_ANCHOR_MAX_OFFSET = 1000000;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidPageUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 8192) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.href === value;
  } catch (_) {
    return false;
  }
}

function isValidAnchor(anchor) {
  return isRecord(anchor)
    && anchor.version === 1
    && Array.isArray(anchor.path)
    && anchor.path.length > 0
    && anchor.path.every((index) => Number.isInteger(index) && index >= 0)
    && Number.isInteger(anchor.offset)
    && anchor.offset >= 0;
}

function isValidPosition(position) {
  return isRecord(position)
    && isValidAnchor(position.anchor)
    && isFiniteNumber(position.viewportOffset)
    && isFiniteNumber(position.scrollY)
    && position.scrollY >= 0
    && isFiniteNumber(position.scrollRatio)
    && position.scrollRatio >= 0
    && position.scrollRatio <= 1
    && isFiniteNumber(position.savedAt)
    && position.savedAt >= 0;
}

function clonePosition(position) {
  return {
    anchor: {
      version: position.anchor.version,
      path: [...position.anchor.path],
      offset: position.anchor.offset
    },
    viewportOffset: position.viewportOffset,
    scrollY: position.scrollY,
    scrollRatio: position.scrollRatio,
    savedAt: position.savedAt
  };
}

function isValidPageState(state) {
  return isRecord(state)
    && state.version === PAGE_STATE_VERSION
    && typeof state.active === "boolean"
    && (state.mode === "following" || state.mode === "frozen")
    && (state.position === null || isValidPosition(state.position));
}

function clonePageState(state = DEFAULT_PAGE_STATE) {
  return {
    version: PAGE_STATE_VERSION,
    active: state.active,
    mode: state.mode,
    position: state.position ? clonePosition(state.position) : null
  };
}

function getSessionStore() {
  return chrome.storage && chrome.storage.session ? chrome.storage.session : null;
}

function readPages(callback) {
  const store = getSessionStore();
  if (!store) {
    callback(null);
    return;
  }
  store.get("readingPages", (result) => {
    callback(isRecord(result && result.readingPages) ? result.readingPages : {});
  });
}

function writePages(pages, state, sendResponse) {
  const store = getSessionStore();
  if (!store) {
    sendResponse({ ok: false, error: "session-storage-unavailable" });
    return;
  }
  store.set({ readingPages: pages }, () => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: "session-storage-error" });
      return;
    }
    sendResponse({ ok: true, state: clonePageState(state) });
  });
}

function isValidSavedPosition(position) {
  return isValidPosition(position)
    && position.anchor.path.length <= SAVED_ANCHOR_MAX_DEPTH
    && position.anchor.path.every((index) => index <= SAVED_ANCHOR_MAX_INDEX)
    && position.anchor.offset <= SAVED_ANCHOR_MAX_OFFSET;
}

function isValidSavedRecord(record) {
  return isRecord(record)
    && record.version === SAVED_VERSION
    && typeof record.title === "string"
    && record.title.length > 0
    && record.title.length <= SAVED_TITLE_MAX
    && record.title === record.title.trim()
    && isValidSavedPosition(record.position)
    && isFiniteNumber(record.savedAt)
    && record.savedAt >= 0;
}

function cloneSavedRecord(record) {
  return {
    version: record.version,
    title: record.title,
    position: clonePosition(record.position),
    savedAt: record.savedAt
  };
}

function savedKey(url) {
  return SAVED_PREFIX + url;
}

function urlFromSavedKey(key) {
  if (typeof key !== "string" || !key.startsWith(SAVED_PREFIX)) return null;
  const url = key.slice(SAVED_PREFIX.length);
  return isValidPageUrl(url) ? url : null;
}

function getLocalStore() {
  return chrome.storage && chrome.storage.local ? chrome.storage.local : null;
}

function handlePersistResumePoint(msg, sender, sendResponse) {
  if (
    !sender
    || !sender.tab
    || sender.tab.incognito === true
    || !Number.isInteger(sender.tab.id)
    || sender.tab.id < 0
  ) {
    sendResponse({ ok: false, error: "invalid-sender" });
    return;
  }
  const url = msg.url;
  if (!isValidPageUrl(url) || sender.tab.url !== url || typeof msg.title !== "string") {
    sendResponse({ ok: false, error: "invalid-input" });
    return;
  }
  const title = msg.title.trim();
  if (title.length === 0 || title.length > SAVED_TITLE_MAX || !isValidSavedPosition(msg.position)) {
    sendResponse({ ok: false, error: "invalid-input" });
    return;
  }
  const store = getLocalStore();
  if (!store) {
    sendResponse({ ok: false, error: "storage-unavailable" });
    return;
  }
  const record = {
    version: SAVED_VERSION,
    title,
    position: clonePosition(msg.position),
    savedAt: Date.now()
  };
  store.set({ [savedKey(url)]: record }, () => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: "save-storage-error" });
      return;
    }
    sendResponse({ ok: true });
  });
}

function handleGetSavedResumePoint(msg, sendResponse) {
  if (!isValidPageUrl(msg.url)) {
    sendResponse({ ok: false, error: "invalid-input" });
    return;
  }
  const store = getLocalStore();
  if (!store) {
    sendResponse({ ok: false, error: "storage-unavailable" });
    return;
  }
  const key = savedKey(msg.url);
  store.get([key], (result) => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: "get-storage-error" });
      return;
    }
    const record = result && result[key];
    sendResponse({ ok: true, record: isValidSavedRecord(record) ? cloneSavedRecord(record) : null });
  });
}

function handleListSavedResumePoints(sendResponse) {
  const store = getLocalStore();
  if (!store) {
    sendResponse({ ok: false, error: "storage-unavailable" });
    return;
  }
  store.get(null, (result) => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: "get-storage-error" });
      return;
    }
    const items = [];
    for (const [key, record] of Object.entries(result || {})) {
      const url = urlFromSavedKey(key);
      if (url && isValidSavedRecord(record)) {
        items.push({ url, ...cloneSavedRecord(record) });
      }
    }
    items.sort((a, b) => b.savedAt - a.savedAt);
    sendResponse({ ok: true, items });
  });
}

function handleRemoveSavedResumePoint(msg, sendResponse) {
  if (!isValidPageUrl(msg.url)) {
    sendResponse({ ok: false, error: "invalid-input" });
    return;
  }
  const store = getLocalStore();
  if (!store) {
    sendResponse({ ok: false, error: "storage-unavailable" });
    return;
  }
  store.remove([savedKey(msg.url)], () => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: "remove-storage-error" });
      return;
    }
    sendResponse({ ok: true });
  });
}

function handleClearSavedResumePoints(sendResponse) {
  const store = getLocalStore();
  if (!store) {
    sendResponse({ ok: false, error: "storage-unavailable" });
    return;
  }
  store.get(null, (result) => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: "get-storage-error" });
      return;
    }
    const keys = Object.keys(result || {}).filter((key) => key.startsWith(SAVED_PREFIX));
    if (keys.length === 0) {
      sendResponse({ ok: true });
      return;
    }
    store.remove(keys, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: "clear-storage-error" });
        return;
      }
      sendResponse({ ok: true });
    });
  });
}

function restoreSeededSession(sessionStore, pages, previous, msgUrl, onDone) {
  const rollbackPages = { ...pages };
  if (previous === undefined) {
    delete rollbackPages[msgUrl];
  } else {
    rollbackPages[msgUrl] = previous;
  }
  sessionStore.set({ readingPages: rollbackPages }, () => {
    const failed = Boolean(chrome.runtime.lastError);
    onDone(failed);
  });
}

function handleContinueSavedResumePoint(msg, sendResponse) {
  if (!isValidPageUrl(msg.url)) {
    sendResponse({ ok: false, error: "invalid-input" });
    return;
  }
  const store = getLocalStore();
  if (!store) {
    sendResponse({ ok: false, error: "storage-unavailable" });
    return;
  }
  const key = savedKey(msg.url);
  store.get([key], (result) => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: "get-storage-error" });
      return;
    }
    const record = result && result[key];
    if (!isValidSavedRecord(record)) {
      sendResponse({ ok: false, error: "no-saved-record" });
      return;
    }
    const sessionStore = getSessionStore();
    if (!sessionStore) {
      sendResponse({ ok: false, error: "session-storage-unavailable" });
      return;
    }
    sessionStore.get("readingPages", (sessionResult) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: "session-read-error" });
        return;
      }
      const pages = isRecord(sessionResult && sessionResult.readingPages) ? sessionResult.readingPages : {};
      const previous = pages[msg.url];
      const seededState = {
        version: PAGE_STATE_VERSION,
        active: true,
        mode: "frozen",
        position: clonePosition(record.position)
      };
      sessionStore.set({ readingPages: { ...pages, [msg.url]: seededState } }, () => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: "session-storage-error" });
          return;
        }
        const tabs = chrome.tabs;
        if (!tabs || typeof tabs.create !== "function") {
          restoreSeededSession(sessionStore, pages, previous, msg.url, (rollbackFailed) => {
            sendResponse(rollbackFailed
              ? { ok: false, error: "rollback-storage-error" }
              : { ok: false, error: "tabs-unavailable" });
          });
          return;
        }
        tabs.create({ url: msg.url }, (tab) => {
          if (chrome.runtime.lastError || !tab || !Number.isInteger(tab.id) || tab.id < 0) {
            restoreSeededSession(sessionStore, pages, previous, msg.url, (rollbackFailed) => {
              sendResponse(rollbackFailed
                ? { ok: false, error: "rollback-storage-error" }
                : { ok: false, error: "tab-create-failed" });
            });
            return;
          }
          sendResponse({ ok: true, tabId: tab.id });
        });
      });
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("settings", (result) => {
    if (!result.settings) {
      chrome.storage.local.set({ settings: { ...DEFAULTS } });
      return;
    }
    if (Object.prototype.hasOwnProperty.call(result.settings, "enabled")) {
      const { enabled: _legacyEnabled, ...appearance } = result.settings;
      chrome.storage.local.set({ settings: { ...DEFAULTS, ...appearance } });
    }
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return false;

  if (msg.type === "getSettings") {
    chrome.storage.local.get("settings", (result) => {
      const { enabled: _legacyEnabled, ...appearance } = result.settings || {};
      sendResponse({ ...DEFAULTS, ...appearance });
    });
    return true;
  }

  if (msg.type === "getPageState" && isValidPageUrl(msg.url)) {
    readPages((pages) => {
      if (!pages) {
        sendResponse({ ok: false, error: "session-storage-unavailable" });
        return;
      }
      const stored = pages[msg.url];
      const state = isValidPageState(stored) ? stored : DEFAULT_PAGE_STATE;
      sendResponse({ ok: true, state: clonePageState(state) });
    });
    return true;
  }

  if (msg.type === "setPageActive" && isValidPageUrl(msg.url) && typeof msg.active === "boolean") {
    readPages((pages) => {
      if (!pages) {
        sendResponse({ ok: false, error: "session-storage-unavailable" });
        return;
      }
      const stored = isValidPageState(pages[msg.url]) ? pages[msg.url] : DEFAULT_PAGE_STATE;
      const state = { ...clonePageState(stored), active: msg.active };
      writePages({ ...pages, [msg.url]: state }, state, sendResponse);
    });
    return true;
  }

  if (
    msg.type === "savePagePosition"
    && isValidPageUrl(msg.url)
    && (msg.mode === "following" || msg.mode === "frozen")
    && isValidPosition(msg.position)
  ) {
    readPages((pages) => {
      if (!pages) {
        sendResponse({ ok: false, error: "session-storage-unavailable" });
        return;
      }
      const stored = isValidPageState(pages[msg.url]) ? pages[msg.url] : DEFAULT_PAGE_STATE;
      if (!stored.active) {
        sendResponse({ ok: false, error: "page-inactive" });
        return;
      }
      const state = {
        ...clonePageState(stored),
        mode: msg.mode,
        position: clonePosition(msg.position)
      };
      writePages({ ...pages, [msg.url]: state }, state, sendResponse);
    });
    return true;
  }

  if (msg.type === "persistResumePoint") {
    handlePersistResumePoint(msg, sender, sendResponse);
    return true;
  }

  if (msg.type === "getSavedResumePoint") {
    handleGetSavedResumePoint(msg, sendResponse);
    return true;
  }

  if (msg.type === "listSavedResumePoints") {
    handleListSavedResumePoints(sendResponse);
    return true;
  }

  if (msg.type === "removeSavedResumePoint") {
    handleRemoveSavedResumePoint(msg, sendResponse);
    return true;
  }

  if (msg.type === "clearSavedResumePoints") {
    handleClearSavedResumePoints(sendResponse);
    return true;
  }

  if (msg.type === "continueSavedResumePoint") {
    handleContinueSavedResumePoint(msg, sendResponse);
    return true;
  }
  return false;
});
