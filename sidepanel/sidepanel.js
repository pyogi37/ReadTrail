// Side panel shell: tracks the active tab of this window, wires the three
// views, and re-renders on tab and storage changes. With `?mode=page` the
// same document runs in a full tab, where "This page" is hidden because the
// current tab is the panel itself.
(() => {
  "use strict";

  const NS = globalThis.ReadTrailSidePanel = globalThis.ReadTrailSidePanel || {};
  const shared = globalThis.ReadTrailShared || {};
  const KEYS = shared.KEYS || { TAB_PREFIX: "readtrail.tab.v1:", SAVED_PREFIX: "readtrail.saved.v1:", RECENT: "readtrail.recent.v1" };

  const params = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
  const mode = params.get("mode") === "page" ? "page" : "panel";

  const pageView = NS.pageView;
  const recentView = NS.recentView;
  const knowledgeView = NS.knowledgeView;
  const LIBRARY_PREFIXES = [KEYS.SAVED_PREFIX, "readtrail.passage.v1:", "readtrail.note.v1:", "readtrail.pagemeta.v1:"];

  function hasChrome() {
    return typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.sendMessage === "function";
  }

  function sendMessage(message, callback) {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          callback(null);
          return;
        }
        callback(response);
      });
    } catch (_) {
      callback(null);
    }
  }

  function queryActiveTab(callback) {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
          callback(null);
          return;
        }
        callback(tabs && tabs[0] ? tabs[0] : null);
      });
    } catch (_) {
      callback(null);
    }
  }

  let syncRevision = 0;

  // Resolve the active tab, then ask the worker for its URL and title (the
  // worker falls back to the content script when Chrome hides the URL).
  function syncTab() {
    if (mode !== "panel" || !pageView) return;
    const revision = ++syncRevision;
    queryActiveTab((tab) => {
      if (revision !== syncRevision) return;
      if (!tab || !Number.isInteger(tab.id)) {
        pageView.setTab(null);
        return;
      }
      sendMessage({ type: "getTabInfo", tabId: tab.id }, (info) => {
        if (revision !== syncRevision) return;
        if (!info || !info.ok) {
          pageView.setTab({ tabId: tab.id, url: null, title: "", supported: false });
          return;
        }
        pageView.setTab({
          tabId: tab.id,
          url: info.supported ? info.url : null,
          title: info.title || "",
          supported: Boolean(info.supported),
          excluded: Boolean(info.excluded),
          incognito: Boolean(info.incognito)
        });
      });
    });
  }

  function onStorageChanged(changes, areaName) {
    if (!changes || typeof changes !== "object") return;
    if (areaName === "session") {
      const tabId = pageView ? pageView.currentTabId() : null;
      if (tabId !== null && changes[KEYS.TAB_PREFIX + String(tabId)]) pageView.refresh();
      if (changes[KEYS.RECENT] && recentView) recentView.reload();
    } else if (areaName === "local") {
      const keys = Object.keys(changes);
      const touchedLibrary = keys.some((key) => LIBRARY_PREFIXES.some((prefix) => key.startsWith(prefix)));
      if (touchedLibrary && knowledgeView) knowledgeView.scheduleReload();
      if (changes.settings && pageView && mode === "panel") syncTab();
    }
  }

  function wireEvents() {
    if (!hasChrome()) return;
    const tabs = chrome.tabs;
    if (mode === "panel" && tabs) {
      if (tabs.onActivated) tabs.onActivated.addListener(() => syncTab());
      if (tabs.onUpdated) {
        tabs.onUpdated.addListener((tabId, changeInfo) => {
          if (!pageView || tabId !== pageView.currentTabId()) return;
          if (changeInfo && (typeof changeInfo.url === "string" || changeInfo.status === "complete")) syncTab();
        });
      }
    }
    if (chrome.storage && chrome.storage.onChanged) chrome.storage.onChanged.addListener(onStorageChanged);
  }

  function init() {
    const panel = document.getElementById("panel");
    if (panel) panel.dataset.mode = mode;
    const pageSection = document.getElementById("pageSection");
    const openInTab = document.getElementById("openInTab");
    const openOptions = document.getElementById("openOptions");

    if (mode === "page") {
      if (pageSection) pageSection.hidden = true;
      if (openInTab) openInTab.hidden = true;
    } else if (pageView) {
      pageView.init();
    }
    if (recentView) recentView.init();
    if (knowledgeView) knowledgeView.init();

    if (openOptions) {
      openOptions.addEventListener("click", () => {
        try { chrome.runtime.openOptionsPage(); } catch (_) { /* unavailable outside Chrome */ }
      });
    }
    if (openInTab) {
      openInTab.addEventListener("click", () => {
        try {
          chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel/desk.html") });
        } catch (_) { /* unavailable outside Chrome */ }
      });
    }

    wireEvents();
    syncTab();
  }

  NS.shell = { init, syncTab, onStorageChanged, mode };
  init();
})();
