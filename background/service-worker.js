const DEFAULTS = {
  enabled: true,
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

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("settings", (result) => {
    if (!result.settings) {
      chrome.storage.local.set({ settings: { ...DEFAULTS } });
    }
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return false;

  if (msg.type === "getSettings") {
    chrome.storage.local.get("settings", (result) => {
      sendResponse({ ...DEFAULTS, ...(result.settings || {}) });
    });
    return true;
  }
  if (msg.type === "toggleEnabled" && typeof msg.enabled === "boolean") {
    chrome.storage.local.get("settings", (result) => {
      const settings = { ...DEFAULTS, ...(result.settings || {}), enabled: msg.enabled };
      chrome.storage.local.set({ settings });
      sendResponse(settings);
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
  return false;
});
