// ReadTrail service worker: the single trust boundary. Every runtime message
// and stored record is validated here. The worker keeps no in-memory state so
// Chrome may suspend it at any time; every handler reads, acts, and writes.
importScripts("../shared/constants.js", "../shared/validators.js", "./library.js");

const S = globalThis.ReadTrailShared;
const { DEFAULTS, KEYS, VERSIONS, LIMITS, ERRORS } = S;
const LIBRARY = globalThis.ReadTrailLibrary;

const DEFAULT_PAGE_STATE = Object.freeze({
  version: VERSIONS.PAGE_STATE,
  active: false,
  mode: "following",
  position: null
});

// --- Storage accessors ---

function getSessionStore() {
  return chrome.storage && chrome.storage.session ? chrome.storage.session : null;
}

function getLocalStore() {
  return chrome.storage && chrome.storage.local ? chrome.storage.local : null;
}

function tabKey(tabId) {
  return KEYS.TAB_PREFIX + String(tabId);
}

function savedKey(url) {
  return KEYS.SAVED_PREFIX + url;
}

function urlFromSavedKey(key) {
  if (typeof key !== "string" || !key.startsWith(KEYS.SAVED_PREFIX)) return null;
  const url = key.slice(KEYS.SAVED_PREFIX.length);
  return S.isValidPageUrl(url) ? url : null;
}

function extensionOrigin() {
  try {
    return chrome.runtime && typeof chrome.runtime.getURL === "function"
      ? chrome.runtime.getURL("")
      : null;
  } catch (_) {
    return null;
  }
}

// --- Tab identity trust rule ---
//
// A content script is identified only by sender.tab.id; any tabId it claims is
// ignored. An extension page (side panel, popup, options) has no sender.tab and
// must name the tab it is acting on; it is trusted only when its sender URL is
// inside this extension. Anything else is refused.
// An extension page may itself live in a tab (the panel's "Open in a tab"
// mode) and then carries sender.tab too, so the origin check comes first.
function resolveTabId(msg, sender) {
  if (LIBRARY.isExtensionPageSender(sender)) {
    return S.isValidTabId(msg.tabId)
      ? { tabId: msg.tabId, fromContent: false }
      : { error: ERRORS.INVALID_INPUT };
  }
  if (sender && sender.tab) {
    return S.isValidTabId(sender.tab.id)
      ? { tabId: sender.tab.id, fromContent: true }
      : { error: ERRORS.INVALID_SENDER };
  }
  return { error: ERRORS.INVALID_SENDER };
}

// --- Tab records ---

function readTabRecord(tabId, callback) {
  const store = getSessionStore();
  if (!store) {
    callback(undefined, ERRORS.SESSION_UNAVAILABLE);
    return;
  }
  const key = tabKey(tabId);
  store.get(key, (result) => {
    if (chrome.runtime.lastError) {
      callback(undefined, ERRORS.SESSION_READ);
      return;
    }
    const stored = result && result[key];
    callback(S.isValidTabRecord(stored) ? stored : null, null);
  });
}

function writeTabRecord(tabId, record, callback) {
  const store = getSessionStore();
  if (!store) {
    callback(ERRORS.SESSION_UNAVAILABLE);
    return;
  }
  store.set({ [tabKey(tabId)]: record }, () => {
    callback(chrome.runtime.lastError ? ERRORS.SESSION_WRITE : null);
  });
}

function removeTabRecord(tabId) {
  const store = getSessionStore();
  if (!store || !S.isValidTabId(tabId)) return;
  try {
    store.remove(tabKey(tabId), () => {
      // A failed cleanup is not recoverable here; the record is inert once the
      // tab is gone because no sender can present that tab id again.
      void chrome.runtime.lastError;
    });
  } catch (_) { /* fail safely */ }
}

function pageStateOf(record, url) {
  if (record && record.url === url) return S.clonePageState(record);
  return S.clonePageState(DEFAULT_PAGE_STATE);
}

function newTabRecord(url, overrides) {
  return {
    version: VERSIONS.TAB_RECORD,
    url,
    title: "",
    active: false,
    mode: "following",
    position: null,
    incognito: false,
    origin: "user",
    updatedAt: Date.now(),
    ...overrides
  };
}

function cleanTitle(value) {
  if (typeof value !== "string") return null;
  const title = value.trim();
  return title.length <= LIMITS.TITLE_MAX ? title : title.slice(0, LIMITS.TITLE_MAX);
}

// --- Settings ---

function handleGetSettings(sendResponse) {
  const store = getLocalStore();
  if (!store) {
    sendResponse({ ...DEFAULTS });
    return;
  }
  store.get(KEYS.SETTINGS, (result) => {
    const stored = result && result[KEYS.SETTINGS];
    sendResponse(S.mergeSettings(stored, null));
  });
}

function handleSetSettings(msg, sendResponse) {
  if (!S.isValidSettings(msg.settings)) {
    sendResponse({ ok: false, error: ERRORS.INVALID_INPUT });
    return;
  }
  const store = getLocalStore();
  if (!store) {
    sendResponse({ ok: false, error: ERRORS.STORAGE_UNAVAILABLE });
    return;
  }
  store.get(KEYS.SETTINGS, (result) => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: ERRORS.GET_STORAGE });
      return;
    }
    const settings = S.mergeSettings(result && result[KEYS.SETTINGS], msg.settings);
    store.set({ [KEYS.SETTINGS]: settings }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: ERRORS.SAVE_STORAGE });
        return;
      }
      sendResponse({ ok: true, settings });
    });
  });
}

// --- Page state (per tab) ---

function handleGetPageState(msg, sender, sendResponse) {
  if (!S.isValidPageUrl(msg.url)) {
    sendResponse({ ok: false, error: ERRORS.INVALID_INPUT });
    return;
  }
  const resolved = resolveTabId(msg, sender);
  if (resolved.error) {
    sendResponse({ ok: false, error: resolved.error });
    return;
  }
  readTabRecord(resolved.tabId, (record, error) => {
    if (error) {
      sendResponse({ ok: false, error });
      return;
    }
    sendResponse({ ok: true, state: pageStateOf(record, msg.url) });
  });
}

function readExcludedHosts(callback) {
  const store = getLocalStore();
  if (!store) {
    callback([]);
    return;
  }
  store.get(KEYS.SETTINGS, (result) => {
    const settings = S.mergeSettings(result && result[KEYS.SETTINGS], null);
    callback(settings.excludedHosts);
  });
}

function handleSetPageActive(msg, sender, sendResponse) {
  if (!S.isValidPageUrl(msg.url) || typeof msg.active !== "boolean") {
    sendResponse({ ok: false, error: ERRORS.INVALID_INPUT });
    return;
  }
  const resolved = resolveTabId(msg, sender);
  if (resolved.error) {
    sendResponse({ ok: false, error: resolved.error });
    return;
  }
  if (msg.active) {
    readExcludedHosts((hosts) => {
      if (S.isHostExcluded(msg.url, hosts)) {
        sendResponse({ ok: false, error: ERRORS.SITE_EXCLUDED });
        return;
      }
      setPageActiveForTab(msg, sender, resolved.tabId, sendResponse);
    });
    return;
  }
  setPageActiveForTab(msg, sender, resolved.tabId, sendResponse);
}

function setPageActiveForTab(msg, sender, tabId, sendResponse) {
  const resolved = { tabId };
  readTabRecord(resolved.tabId, (record, error) => {
    if (error) {
      sendResponse({ ok: false, error });
      return;
    }
    const current = record && record.url === msg.url ? record : null;
    if (!current && !msg.active) {
      // Nothing to deactivate for this URL in this tab; report the inactive
      // default without touching storage.
      sendResponse({ ok: true, state: S.clonePageState(DEFAULT_PAGE_STATE) });
      return;
    }
    const next = current
      ? { ...S.cloneTabRecord(current), active: msg.active, updatedAt: Date.now() }
      : newTabRecord(msg.url, { active: true });
    if (LIBRARY.isContentSender(sender) && typeof sender.tab.incognito === "boolean") {
      next.incognito = sender.tab.incognito;
    }
    writeTabRecord(resolved.tabId, next, (writeError) => {
      if (writeError) {
        sendResponse({ ok: false, error: writeError });
        return;
      }
      sendResponse({ ok: true, state: S.clonePageState(next) });
    });
  });
}

function handleSavePagePosition(msg, sender, sendResponse) {
  if (
    !S.isValidPageUrl(msg.url)
    || (msg.mode !== "following" && msg.mode !== "frozen")
    || !S.isValidPosition(msg.position)
  ) {
    sendResponse({ ok: false, error: ERRORS.INVALID_INPUT });
    return;
  }
  const resolved = resolveTabId(msg, sender);
  if (resolved.error) {
    sendResponse({ ok: false, error: resolved.error });
    return;
  }
  readTabRecord(resolved.tabId, (record, error) => {
    if (error) {
      sendResponse({ ok: false, error });
      return;
    }
    if (!record || record.url !== msg.url || !record.active) {
      sendResponse({ ok: false, error: ERRORS.PAGE_INACTIVE });
      return;
    }
    const next = {
      ...S.cloneTabRecord(record),
      mode: msg.mode,
      position: S.clonePosition(msg.position),
      updatedAt: Date.now()
    };
    const title = cleanTitle(msg.title);
    if (title !== null) next.title = title;
    if (S.isRestoreQuality(msg.restoreQuality)) next.restoreQuality = msg.restoreQuality;
    if (LIBRARY.isContentSender(sender) && typeof sender.tab.incognito === "boolean") {
      next.incognito = sender.tab.incognito;
    }
    writeTabRecord(resolved.tabId, next, (writeError) => {
      if (writeError) {
        sendResponse({ ok: false, error: writeError });
        return;
      }
      sendResponse({ ok: true, state: S.clonePageState(next) });
    });
  });
}

// --- Tab info for extension pages ---

function handleGetTabInfo(msg, sender, sendResponse) {
  const resolved = resolveTabId(msg, sender);
  if (resolved.error || resolved.fromContent) {
    sendResponse({ ok: false, error: resolved.error || ERRORS.INVALID_SENDER });
    return;
  }
  const tabs = chrome.tabs;
  if (!tabs || typeof tabs.get !== "function") {
    sendResponse({ ok: false, error: ERRORS.TABS_UNAVAILABLE });
    return;
  }
  const tabId = resolved.tabId;
  const reply = (url, title, incognito) => {
    const supported = S.isValidPageUrl(url);
    readExcludedHosts((hosts) => {
      sendResponse({
        ok: true,
        url: supported ? url : null,
        title: supported && typeof title === "string" ? title : "",
        incognito: Boolean(incognito),
        supported,
        excluded: supported && S.isHostExcluded(url, hosts)
      });
    });
  };
  try {
    tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        sendResponse({ ok: false, error: ERRORS.TAB_UNAVAILABLE });
        return;
      }
      if (typeof tab.url === "string" && tab.url.length > 0) {
        reply(tab.url, tab.title, tab.incognito);
        return;
      }
      // Without host visibility for this tab, ask the content script itself.
      if (typeof tabs.sendMessage !== "function") {
        reply(null, "", tab.incognito);
        return;
      }
      try {
        tabs.sendMessage(tabId, { type: "pageInfo" }, (info) => {
          if (chrome.runtime.lastError || !info) {
            reply(null, "", tab.incognito);
            return;
          }
          reply(info.url, info.title, tab.incognito);
        });
      } catch (_) {
        reply(null, "", tab.incognito);
      }
    });
  } catch (_) {
    sendResponse({ ok: false, error: ERRORS.TAB_UNAVAILABLE });
  }
}

// --- Durable saved pages ---

function handlePersistResumePoint(msg, sender, sendResponse) {
  if (
    !sender
    || !sender.tab
    || sender.tab.incognito === true
    || !S.isValidTabId(sender.tab.id)
  ) {
    sendResponse({ ok: false, error: ERRORS.INVALID_SENDER });
    return;
  }
  const url = msg.url;
  if (!S.isValidPageUrl(url) || sender.tab.url !== url || typeof msg.title !== "string") {
    sendResponse({ ok: false, error: ERRORS.INVALID_INPUT });
    return;
  }
  const title = msg.title.trim();
  if (!S.isValidTitle(title) || !S.isValidSavedPosition(msg.position)) {
    sendResponse({ ok: false, error: ERRORS.INVALID_INPUT });
    return;
  }
  const store = getLocalStore();
  if (!store) {
    sendResponse({ ok: false, error: ERRORS.STORAGE_UNAVAILABLE });
    return;
  }
  const record = {
    version: VERSIONS.SAVED_RECORD,
    title,
    position: S.clonePosition(msg.position),
    savedAt: Date.now()
  };
  store.set({ [savedKey(url)]: record }, () => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: ERRORS.SAVE_STORAGE });
      return;
    }
    sendResponse({ ok: true });
  });
}

function handleGetSavedResumePoint(msg, sendResponse) {
  if (!S.isValidPageUrl(msg.url)) {
    sendResponse({ ok: false, error: ERRORS.INVALID_INPUT });
    return;
  }
  const store = getLocalStore();
  if (!store) {
    sendResponse({ ok: false, error: ERRORS.STORAGE_UNAVAILABLE });
    return;
  }
  const key = savedKey(msg.url);
  store.get([key], (result) => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: ERRORS.GET_STORAGE });
      return;
    }
    const record = result && result[key];
    sendResponse({ ok: true, record: S.isValidSavedRecord(record) ? S.cloneSavedRecord(record) : null });
  });
}

function handleListSavedResumePoints(sendResponse) {
  const store = getLocalStore();
  if (!store) {
    sendResponse({ ok: false, error: ERRORS.STORAGE_UNAVAILABLE });
    return;
  }
  store.get(null, (result) => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: ERRORS.GET_STORAGE });
      return;
    }
    const items = [];
    for (const [key, record] of Object.entries(result || {})) {
      const url = urlFromSavedKey(key);
      if (url && S.isValidSavedRecord(record)) {
        items.push({ url, ...S.cloneSavedRecord(record) });
      }
    }
    items.sort((a, b) => b.savedAt - a.savedAt);
    sendResponse({ ok: true, items });
  });
}

function handleRemoveSavedResumePoint(msg, sendResponse) {
  if (!S.isValidPageUrl(msg.url)) {
    sendResponse({ ok: false, error: ERRORS.INVALID_INPUT });
    return;
  }
  const store = getLocalStore();
  if (!store) {
    sendResponse({ ok: false, error: ERRORS.STORAGE_UNAVAILABLE });
    return;
  }
  store.remove([savedKey(msg.url)], () => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: ERRORS.REMOVE_STORAGE });
      return;
    }
    sendResponse({ ok: true });
  });
}

function handleClearSavedResumePoints(sendResponse) {
  const store = getLocalStore();
  if (!store) {
    sendResponse({ ok: false, error: ERRORS.STORAGE_UNAVAILABLE });
    return;
  }
  store.get(null, (result) => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: ERRORS.GET_STORAGE });
      return;
    }
    const keys = Object.keys(result || {}).filter((key) => key.startsWith(KEYS.SAVED_PREFIX));
    if (keys.length === 0) {
      sendResponse({ ok: true });
      return;
    }
    store.remove(keys, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: ERRORS.CLEAR_STORAGE });
        return;
      }
      sendResponse({ ok: true });
    });
  });
}

// Continue reading opens a fresh tab and seeds that tab's record, so an
// already-open tab on the same URL is never affected. The tab is created first
// because the record is keyed by its id; if seeding then fails the tab stays
// open and dormant and the caller is told which tab it was.
function handleContinueSavedResumePoint(msg, sendResponse) {
  if (!S.isValidPageUrl(msg.url)) {
    sendResponse({ ok: false, error: ERRORS.INVALID_INPUT });
    return;
  }
  const store = getLocalStore();
  if (!store) {
    sendResponse({ ok: false, error: ERRORS.STORAGE_UNAVAILABLE });
    return;
  }
  const key = savedKey(msg.url);
  store.get([key], (result) => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: ERRORS.GET_STORAGE });
      return;
    }
    const record = result && result[key];
    if (!S.isValidSavedRecord(record)) {
      sendResponse({ ok: false, error: ERRORS.NO_SAVED_RECORD });
      return;
    }
    if (!getSessionStore()) {
      sendResponse({ ok: false, error: ERRORS.SESSION_UNAVAILABLE });
      return;
    }
    const tabs = chrome.tabs;
    if (!tabs || typeof tabs.create !== "function") {
      sendResponse({ ok: false, error: ERRORS.TABS_UNAVAILABLE });
      return;
    }
    tabs.create({ url: msg.url }, (tab) => {
      if (chrome.runtime.lastError || !tab || !S.isValidTabId(tab.id)) {
        sendResponse({ ok: false, error: ERRORS.TAB_CREATE_FAILED });
        return;
      }
      const seeded = newTabRecord(msg.url, {
        title: record.title,
        active: true,
        mode: "frozen",
        position: S.clonePosition(record.position),
        incognito: Boolean(tab.incognito),
        origin: "continue"
      });
      writeTabRecord(tab.id, seeded, (writeError) => {
        if (writeError) {
          sendResponse({ ok: false, error: writeError, tabId: tab.id });
          return;
        }
        sendResponse({ ok: true, tabId: tab.id });
      });
    });
  });
}

// --- Recently closed: offer to save reading that was open in a closed tab ---

function updateBadge(count) {
  const action = chrome.action;
  if (!action || typeof action.setBadgeText !== "function") return;
  try {
    action.setBadgeText({ text: count > 0 ? String(count) : "" }, () => { void chrome.runtime.lastError; });
  } catch (_) { /* badge is cosmetic */ }
}

function readRecent(callback) {
  const store = getSessionStore();
  if (!store) {
    callback(null, ERRORS.SESSION_UNAVAILABLE);
    return;
  }
  store.get(KEYS.RECENT, (result) => {
    if (chrome.runtime.lastError) {
      callback(null, ERRORS.SESSION_READ);
      return;
    }
    const raw = result && result[KEYS.RECENT];
    const rawCount = raw && Array.isArray(raw.items) ? raw.items.length : 0;
    const list = S.normalizeRecentList(raw, Date.now());
    callback(list, null, rawCount !== list.items.length);
  });
}

function writeRecent(list, callback) {
  const store = getSessionStore();
  if (!store) {
    callback(ERRORS.SESSION_UNAVAILABLE);
    return;
  }
  store.set({ [KEYS.RECENT]: list }, () => {
    if (chrome.runtime.lastError) {
      callback(ERRORS.SESSION_WRITE);
      return;
    }
    updateBadge(list.items.length);
    callback(null);
  });
}

function titleForSaved(title, url) {
  const clean = typeof title === "string" ? title.trim() : "";
  if (S.isValidTitle(clean)) return clean;
  try {
    return new URL(url).hostname || "Saved page";
  } catch (_) {
    return "Saved page";
  }
}

function writeSavedFromPosition(url, title, position, callback) {
  const store = getLocalStore();
  if (!store || !S.isValidSavedPosition(position)) {
    callback(ERRORS.STORAGE_UNAVAILABLE);
    return;
  }
  const record = {
    version: VERSIONS.SAVED_RECORD,
    title: titleForSaved(title, url),
    position: S.clonePosition(position),
    savedAt: Date.now()
  };
  store.set({ [savedKey(url)]: record }, () => {
    callback(chrome.runtime.lastError ? ERRORS.SAVE_STORAGE : null);
  });
}

// Runs on tabs.onRemoved. Reads the tab's last checkpoint before deleting the
// record and, when that checkpoint is newer than the durable one, applies the
// reader's closeSave preference. Incognito tabs never leave a trace.
function handleTabRemoved(tabId) {
  const finish = () => removeTabRecord(tabId);
  readTabRecord(tabId, (record, error) => {
    if (error || !record || !record.active || !record.position || record.incognito) {
      finish();
      return;
    }
    if (!S.isValidSavedPosition(record.position)) {
      finish();
      return;
    }
    const local = getLocalStore();
    if (!local) {
      finish();
      return;
    }
    const key = savedKey(record.url);
    local.get([key, KEYS.SETTINGS], (result) => {
      if (chrome.runtime.lastError) {
        finish();
        return;
      }
      const saved = result && result[key];
      if (S.isValidSavedRecord(saved) && saved.position.savedAt >= record.position.savedAt) {
        finish();
        return;
      }
      const settings = S.mergeSettings(result && result[KEYS.SETTINGS], null);
      if (settings.closeSave === "never") {
        finish();
        return;
      }
      if (settings.closeSave === "always") {
        writeSavedFromPosition(record.url, record.title, record.position, () => finish());
        return;
      }
      readRecent((list) => {
        if (!list) {
          finish();
          return;
        }
        const now = Date.now();
        const items = list.items.filter((item) => item.url !== record.url);
        items.unshift({
          tabId,
          url: record.url,
          title: record.title,
          position: S.clonePosition(record.position),
          closedAt: now
        });
        writeRecent(S.normalizeRecentList({ items }, now), () => finish());
      });
    });
  });
}

function handleListRecentlyClosed(sendResponse) {
  readRecent((list, error, changed) => {
    if (error) {
      sendResponse({ ok: false, error });
      return;
    }
    const reply = () => sendResponse({
      ok: true,
      items: list.items.map((item) => ({ url: item.url, title: item.title, closedAt: item.closedAt }))
    });
    if (changed) {
      writeRecent(list, () => reply());
      return;
    }
    updateBadge(list.items.length);
    reply();
  });
}

function handleSaveRecentlyClosed(msg, sendResponse) {
  if (!S.isValidPageUrl(msg.url)) {
    sendResponse({ ok: false, error: ERRORS.INVALID_INPUT });
    return;
  }
  readRecent((list, error) => {
    if (error) {
      sendResponse({ ok: false, error });
      return;
    }
    const item = list.items.find((entry) => entry.url === msg.url);
    if (!item) {
      sendResponse({ ok: false, error: ERRORS.NO_RECENT_ITEM });
      return;
    }
    // The stored item is the source of truth; the panel only names the URL.
    writeSavedFromPosition(item.url, item.title, item.position, (saveError) => {
      if (saveError) {
        sendResponse({ ok: false, error: saveError });
        return;
      }
      const remaining = { version: 1, items: list.items.filter((entry) => entry.url !== msg.url) };
      writeRecent(remaining, (writeError) => {
        sendResponse(writeError ? { ok: false, error: writeError } : { ok: true });
      });
    });
  });
}

function handleDismissRecentlyClosed(msg, sendResponse) {
  if (!S.isValidPageUrl(msg.url)) {
    sendResponse({ ok: false, error: ERRORS.INVALID_INPUT });
    return;
  }
  readRecent((list, error) => {
    if (error) {
      sendResponse({ ok: false, error });
      return;
    }
    const remaining = { version: 1, items: list.items.filter((entry) => entry.url !== msg.url) };
    writeRecent(remaining, (writeError) => {
      sendResponse(writeError ? { ok: false, error: writeError } : { ok: true });
    });
  });
}

// --- Side panel ---

function enableSidePanelOnActionClick() {
  const sidePanel = chrome.sidePanel;
  if (!sidePanel || typeof sidePanel.setPanelBehavior !== "function") return;
  try {
    const result = sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch (_) { /* older Chrome without side panel support */ }
}

enableSidePanelOnActionClick();

// --- Lifecycle ---

chrome.runtime.onInstalled.addListener(() => {
  enableSidePanelOnActionClick();
  LIBRARY.registerContextMenu();
  chrome.storage.local.get(KEYS.SETTINGS, (result) => {
    const stored = result && result[KEYS.SETTINGS];
    if (!stored) {
      chrome.storage.local.set({ [KEYS.SETTINGS]: { ...DEFAULTS } });
    } else if (Object.prototype.hasOwnProperty.call(stored, "enabled")) {
      chrome.storage.local.set({ [KEYS.SETTINGS]: S.mergeSettings(stored, null) });
    }
  });
  const session = getSessionStore();
  if (session && typeof session.remove === "function") {
    try {
      session.remove(KEYS.LEGACY_PAGES, () => { void chrome.runtime.lastError; });
    } catch (_) { /* legacy key absent or storage unavailable */ }
  }
});

if (chrome.contextMenus && chrome.contextMenus.onClicked && typeof chrome.contextMenus.onClicked.addListener === "function") {
  chrome.contextMenus.onClicked.addListener((info, tab) => LIBRARY.onContextMenuClick(info, tab));
}

if (chrome.tabs && chrome.tabs.onRemoved && typeof chrome.tabs.onRemoved.addListener === "function") {
  chrome.tabs.onRemoved.addListener((tabId) => handleTabRemoved(tabId));
}
if (chrome.tabs && chrome.tabs.onReplaced && typeof chrome.tabs.onReplaced.addListener === "function") {
  chrome.tabs.onReplaced.addListener((_addedTabId, removedTabId) => removeTabRecord(removedTabId));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return false;

  switch (msg.type) {
    case "getSettings":
      handleGetSettings(sendResponse);
      return true;
    case "setSettings":
      handleSetSettings(msg, sendResponse);
      return true;
    case "getPageState":
      handleGetPageState(msg, sender, sendResponse);
      return true;
    case "setPageActive":
      handleSetPageActive(msg, sender, sendResponse);
      return true;
    case "savePagePosition":
      handleSavePagePosition(msg, sender, sendResponse);
      return true;
    case "getTabInfo":
      handleGetTabInfo(msg, sender, sendResponse);
      return true;
    case "persistResumePoint":
      handlePersistResumePoint(msg, sender, sendResponse);
      return true;
    case "getSavedResumePoint":
      handleGetSavedResumePoint(msg, sendResponse);
      return true;
    case "listSavedResumePoints":
      handleListSavedResumePoints(sendResponse);
      return true;
    case "removeSavedResumePoint":
      handleRemoveSavedResumePoint(msg, sendResponse);
      return true;
    case "clearSavedResumePoints":
      handleClearSavedResumePoints(sendResponse);
      return true;
    case "continueSavedResumePoint":
      handleContinueSavedResumePoint(msg, sendResponse);
      return true;
    case "listRecentlyClosed":
      handleListRecentlyClosed(sendResponse);
      return true;
    case "saveRecentlyClosed":
      handleSaveRecentlyClosed(msg, sendResponse);
      return true;
    case "dismissRecentlyClosed":
      handleDismissRecentlyClosed(msg, sendResponse);
      return true;
    case "savePassage":
      LIBRARY.handlers.savePassage(msg, sender, sendResponse);
      return true;
    case "updatePassage":
      LIBRARY.handlers.updatePassage(msg, sendResponse);
      return true;
    case "removePassage":
      LIBRARY.handlers.removePassage(msg, sendResponse);
      return true;
    case "listPassages":
      LIBRARY.handlers.listPassages(msg, sendResponse);
      return true;
    case "saveNote":
      LIBRARY.handlers.saveNote(msg, sender, sendResponse);
      return true;
    case "updateNote":
      LIBRARY.handlers.updateNote(msg, sendResponse);
      return true;
    case "removeNote":
      LIBRARY.handlers.removeNote(msg, sendResponse);
      return true;
    case "listNotes":
      LIBRARY.handlers.listNotes(msg, sendResponse);
      return true;
    case "setPageTags":
      LIBRARY.handlers.setPageTags(msg, sendResponse);
      return true;
    case "listLibrary":
      LIBRARY.handlers.listLibrary(sendResponse);
      return true;
    case "clearLibrary":
      LIBRARY.handlers.clearLibrary(msg, sendResponse);
      return true;
    case "removePageData":
      LIBRARY.handlers.removePageData(msg, sendResponse);
      return true;
    case "exportLibrary":
      LIBRARY.handlers.exportLibrary(sendResponse);
      return true;
    case "importLibrary":
      LIBRARY.handlers.importLibrary(msg, sendResponse);
      return true;
    default:
      return false;
  }
});
