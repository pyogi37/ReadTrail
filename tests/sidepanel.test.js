import { describe, expect, it, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const readSource = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const html = readSource("sidepanel/sidepanel.html");
const constantsSrc = readSource("shared/constants.js");
const validatorsSrc = readSource("shared/validators.js");
const pageControlsSrc = readSource("shared/page-controls.js");
const pageViewSrc = readSource("sidepanel/page-view.js");
const recentViewSrc = readSource("sidepanel/recent-view.js");
const sidepanelSrc = readSource("sidepanel/sidepanel.js");

// Every external <script src="..."></script> is stripped so the harness can
// eval the same sources itself, in the same order the manifest/HTML loads
// them, against a mock chrome instead of the packaged files.
const strippedHtml = html.replace(/<script[^>]*src="[^"]+"[^>]*><\/script>\s*/g, "");

const makeState = (active, extra = {}) => ({ version: 1, active, mode: "following", position: null, ...extra });
const HTTP_TAB = { id: 7, url: "https://example.com/article", title: "An Article" };

// Loads sidepanel.html and evaluates the shell + two views with a deferring
// chrome mock. Every async callback (tabs.query, runtime.sendMessage,
// tabs.sendMessage) is captured so tests can drive and order the
// conversations exactly. Because the shell, page-view, and recent-view all
// talk to chrome.runtime.sendMessage concurrently, callbacks are keyed by
// message `type` (FIFO per type) rather than by call index.
function loadSidePanel({ mode = "panel" } = {}) {
  // IIFEs guard on `globalThis.ReadTrailShared`/`ReadTrailSidePanel` already
  // being set, so each load must clear them first to force re-registration.
  delete globalThis.ReadTrailShared;
  delete globalThis.ReadTrailSidePanel;

  document.open();
  document.write(strippedHtml);
  document.close();

  const url = mode === "page" ? "/sidepanel/sidepanel.html?mode=page" : "/sidepanel/sidepanel.html";
  window.history.replaceState(null, "", url);

  const pending = { query: [], byType: {}, tab: [] };
  const runtimeMsgs = [];
  const tabMsgs = [];
  const registered = { onActivated: [], onUpdated: [], onChanged: [] };

  function pushType(type, cb) {
    (pending.byType[type] = pending.byType[type] || []).push(cb);
  }

  globalThis.chrome = {
    runtime: {
      lastError: null,
      sendMessage: vi.fn((msg, cb) => {
        runtimeMsgs.push(msg);
        pushType(msg.type, cb);
      }),
      openOptionsPage: vi.fn(),
      getURL: vi.fn((relativePath) => `chrome-extension://test/${relativePath}`)
    },
    tabs: {
      query: vi.fn((_query, cb) => {
        pending.query.push(cb);
      }),
      sendMessage: vi.fn((_tabId, msg, cb) => {
        tabMsgs.push(msg);
        pending.tab.push(cb);
      }),
      create: vi.fn(),
      onActivated: { addListener: vi.fn((handler) => registered.onActivated.push(handler)) },
      onUpdated: { addListener: vi.fn((handler) => registered.onUpdated.push(handler)) }
    },
    storage: {
      onChanged: { addListener: vi.fn((handler) => registered.onChanged.push(handler)) }
    }
  };

  window.eval(constantsSrc);
  window.eval(validatorsSrc);
  window.eval(pageControlsSrc);
  window.eval(pageViewSrc);
  window.eval(recentViewSrc);
  window.eval(sidepanelSrc);

  function shiftQuery() {
    const cb = pending.query.shift();
    if (!cb) throw new Error("no pending tabs.query callback");
    return cb;
  }
  function shiftType(type) {
    const arr = pending.byType[type];
    const cb = arr && arr.shift();
    if (!cb) throw new Error(`no pending "${type}" runtime.sendMessage callback`);
    return cb;
  }
  function shiftTab() {
    const cb = pending.tab.shift();
    if (!cb) throw new Error("no pending tabs.sendMessage callback");
    return cb;
  }
  function pendingCount(type) {
    return pending.byType[type] ? pending.byType[type].length : 0;
  }

  return {
    pending,
    runtimeMsgs,
    tabMsgs,
    registered,
    chrome: globalThis.chrome,
    KEYS: globalThis.ReadTrailShared.KEYS,
    shiftQuery,
    shiftType,
    shiftTab,
    pendingCount,
    emitActivated: (...args) => registered.onActivated.forEach((handler) => handler(...args)),
    emitUpdated: (...args) => registered.onUpdated.forEach((handler) => handler(...args)),
    emitChanged: (...args) => registered.onChanged.forEach((handler) => handler(...args))
  };
}

// Resolves the active-tab query, the getTabInfo lookup, the getPageState
// read, and (when the state is valid) the getSavedResumePoint read, settling
// the panel into a real "This page" state for a supported http(s) tab.
function initTab(h, tab, stateResponse, savedResponse = { ok: true, record: null }) {
  h.shiftQuery()([tab]);
  h.shiftType("getTabInfo")({ ok: true, supported: true, url: tab.url, title: tab.title || "" });
  h.shiftType("getPageState")(stateResponse);
  if (h.pendingCount("getSavedResumePoint") > 0) {
    h.shiftType("getSavedResumePoint")(savedResponse);
  }
}

const toggleEl = () => document.querySelector("#toggleSwitch");
const statusEl = () => document.querySelector("#statusLabel");
const descriptionEl = () => document.querySelector("#description");
const readingLockNoticeEl = () => document.querySelector("#readingLockNotice");
const saveSectionEl = () => document.querySelector("#saveSection");
const saveButtonEl = () => document.querySelector("#saveButton");
const saveHintEl = () => document.querySelector("#saveHint");
const saveStatusEl = () => document.querySelector("#saveStatus");
const restoreNoteEl = () => document.querySelector("#restoreNote");
const errorEl = () => document.querySelector("#error");
const localNoteEl = () => document.querySelector("#localNote");
const recentSectionEl = () => document.querySelector("#recentSection");
const pageTitleEl = () => document.querySelector("#pageTitle");
const openInTabEl = () => document.querySelector("#openInTab");
const openOptionsEl = () => document.querySelector("#openOptions");
const pageSectionEl = () => document.querySelector("#pageSection");

function clickSave() {
  saveButtonEl().click();
}

function clickToggle(checked) {
  const toggle = toggleEl();
  toggle.checked = checked;
  toggle.dispatchEvent(new Event("change"));
}

describe("ReadTrail side panel current-page activation", () => {
  it("shows a loading state before the active tab is resolved", () => {
    const h = loadSidePanel();
    expect(statusEl().textContent).toBe("Loading…");
    expect(toggleEl().disabled).toBe(true);
    expect(h.pending.query).toHaveLength(1);
  });

  it("initializes an inactive page with no forced toggle", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { ok: true, state: makeState(false) });

    expect(statusEl().textContent).toBe("Use on this page");
    expect(toggleEl().checked).toBe(false);
    expect(toggleEl().disabled).toBe(false);
    expect(readingLockNoticeEl().hidden).toBe(false);
    expect(readingLockNoticeEl().textContent).toContain("reserves primary clicks");
    expect(h.runtimeMsgs).toContainEqual({ type: "getPageState", tabId: HTTP_TAB.id, url: HTTP_TAB.url });
    expect(h.runtimeMsgs).toContainEqual({ type: "getSavedResumePoint", url: HTTP_TAB.url });
    // Never touches settings.enabled or chrome.storage directly.
    expect(h.runtimeMsgs.some((m) => m.type === "getSettings" || m.type === "toggleEnabled")).toBe(false);
    expect(globalThis.chrome.storage.local).toBeUndefined();
    expect(globalThis.chrome.storage.session).toBeUndefined();
  });

  it("initializes an active page with the toggle on and shows the page title", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { ok: true, state: makeState(true) });

    expect(statusEl().textContent).toBe("Active on this page");
    expect(toggleEl().checked).toBe(true);
    expect(toggleEl().disabled).toBe(false);
    expect(readingLockNoticeEl().hidden).toBe(true);
    expect(descriptionEl().textContent).toContain("Reading lock is on");
    expect(pageTitleEl().textContent).toBe(HTTP_TAB.title);
    expect(pageTitleEl().hidden).toBe(false);
  });

  it("reports unsupported pages when the worker says so, and never reads page state", () => {
    const h = loadSidePanel();
    h.shiftQuery()([HTTP_TAB]);
    h.shiftType("getTabInfo")({ ok: true, supported: false });

    expect(statusEl().textContent).toBe("Not available on this page");
    expect(toggleEl().disabled).toBe(true);
    expect(h.pendingCount("getPageState")).toBe(0);
  });

  it("shows unsupported and never queries tab info when there is no usable active tab", () => {
    const noTab = loadSidePanel();
    noTab.shiftQuery()([]);
    expect(noTab.runtimeMsgs.some((m) => m.type === "getTabInfo")).toBe(false);
    expect(statusEl().textContent).toBe("Not available on this page");

    const badId = loadSidePanel();
    badId.shiftQuery()([{ id: NaN, url: "https://example.com/x" }]);
    expect(badId.runtimeMsgs.some((m) => m.type === "getTabInfo")).toBe(false);
    expect(statusEl().textContent).toBe("Not available on this page");
  });

  it("uses the exact tab URL and tab id for activation messaging", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { ok: true, state: makeState(false) });

    clickToggle(true);
    expect(h.runtimeMsgs).toContainEqual({ type: "setPageActive", tabId: HTTP_TAB.id, url: HTTP_TAB.url, active: true });

    h.shiftType("setPageActive")({ ok: true, state: makeState(true) });
    expect(h.chrome.tabs.sendMessage).toHaveBeenCalledWith(HTTP_TAB.id, expect.any(Object), expect.any(Function));
    expect(h.tabMsgs[0]).toEqual({ type: "setPageActive", active: true, state: makeState(true) });

    h.shiftTab()({ ok: true });
    expect(statusEl().textContent).toBe("Active on this page");
    expect(toggleEl().checked).toBe(true);
  });

  it("keeps the toggle disabled while an enable transition is in flight", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { ok: true, state: makeState(false) });

    clickToggle(true);
    expect(toggleEl().disabled).toBe(true);

    h.shiftType("setPageActive")({ ok: true, state: makeState(true) });
    expect(toggleEl().disabled).toBe(true);

    h.shiftTab()({ ok: true });
    expect(toggleEl().disabled).toBe(false);
  });

  it("rolls the service state back and shows an error when content delivery fails", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { ok: true, state: makeState(false) });

    clickToggle(true);
    h.shiftType("setPageActive")({ ok: true, state: makeState(true) });
    h.shiftTab()(null);

    expect(h.runtimeMsgs.some((m) => m.type === "setPageActive" && m.url === HTTP_TAB.url && m.active === false)).toBe(true);
    h.shiftType("setPageActive")({ ok: true, state: makeState(false) });

    expect(statusEl().textContent).toBe("Use on this page");
    expect(errorEl().hidden).toBe(false);
    expect(errorEl().textContent.length).toBeGreaterThan(0);
  });

  it("rolls back on an explicit content delivery failure too", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { ok: true, state: makeState(false) });

    clickToggle(true);
    h.shiftType("setPageActive")({ ok: true, state: makeState(true) });
    h.shiftTab()({ ok: false, error: "no-receiver" });

    expect(h.runtimeMsgs.some((m) => m.type === "setPageActive" && m.active === false)).toBe(true);
    h.shiftType("setPageActive")({ ok: true, state: makeState(false) });
    expect(statusEl().textContent).toBe("Use on this page");
    expect(errorEl().hidden).toBe(false);
  });

  it("does not claim inactivity when activation rollback fails", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { ok: true, state: makeState(false) });

    clickToggle(true);
    h.shiftType("setPageActive")({ ok: true, state: makeState(true) });
    h.shiftTab()(null);
    h.shiftType("setPageActive")({ ok: false, error: "session-storage-error" });

    expect(statusEl().textContent).toBe("Something went wrong");
    expect(toggleEl().disabled).toBe(true);
    expect(errorEl().textContent).toContain("check the page state");
  });

  it("waits for the save-before-off acknowledgement before deactivating in the service", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { ok: true, state: makeState(true) });

    clickToggle(false);
    expect(h.tabMsgs[0]).toEqual({ type: "setPageActive", active: false });
    expect(h.runtimeMsgs.filter((m) => m.type === "setPageActive")).toEqual([]);

    h.shiftTab()({ ok: true });
    expect(h.runtimeMsgs.filter((m) => m.type === "setPageActive")).toEqual([
      { type: "setPageActive", tabId: HTTP_TAB.id, url: HTTP_TAB.url, active: false }
    ]);

    h.shiftType("setPageActive")({ ok: true, state: makeState(false) });
    expect(statusEl().textContent).toBe("Use on this page");
    expect(toggleEl().checked).toBe(false);
    expect(toggleEl().disabled).toBe(false);
  });

  it("continues deactivating when the content script is unavailable", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { ok: true, state: makeState(true) });

    clickToggle(false);
    h.shiftTab()(null);

    expect(h.runtimeMsgs.filter((m) => m.type === "setPageActive")).toEqual([
      { type: "setPageActive", tabId: HTTP_TAB.id, url: HTTP_TAB.url, active: false }
    ]);
    h.shiftType("setPageActive")({ ok: true, state: makeState(false) });
    expect(statusEl().textContent).toBe("Use on this page");
    expect(errorEl().hidden).toBe(true);
  });

  it("keeps the page active and shows an error on an explicit content save failure", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { ok: true, state: makeState(true) });

    clickToggle(false);
    h.shiftTab()({ ok: false, error: "save-failed" });

    expect(h.runtimeMsgs.filter((m) => m.type === "setPageActive")).toEqual([]);
    expect(statusEl().textContent).toBe("Active on this page");
    expect(toggleEl().checked).toBe(true);
    expect(toggleEl().disabled).toBe(false);
    expect(errorEl().hidden).toBe(false);
    expect(errorEl().textContent).toContain("before turning off");
  });

  it("reactivates the content when the service worker deactivation fails", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { ok: true, state: makeState(true) });

    clickToggle(false);
    h.shiftTab()({ ok: true });
    h.shiftType("setPageActive")({ ok: false, error: "session-storage-error" });

    expect(h.tabMsgs[h.tabMsgs.length - 1]).toEqual({ type: "setPageActive", active: true, state: makeState(true) });
    h.shiftTab()({ ok: true });

    expect(statusEl().textContent).toBe("Active on this page");
    expect(toggleEl().checked).toBe(true);
    expect(errorEl().hidden).toBe(false);
    expect(errorEl().textContent).toContain("still active on this page");
  });

  it("still reports the page active when reactivation delivery is unavailable", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { ok: true, state: makeState(true) });

    clickToggle(false);
    h.shiftTab()({ ok: true });
    h.shiftType("setPageActive")({ ok: false, error: "session-storage-error" });
    h.shiftTab()(null);

    expect(statusEl().textContent).toBe("Active on this page");
    expect(toggleEl().checked).toBe(true);
    expect(errorEl().textContent).toContain("Reload the page");
  });

  it("rejects malformed service-worker page state", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { ok: true, state: { active: false, mode: "following", position: null } });

    expect(statusEl().textContent).toBe("Something went wrong");
    expect(toggleEl().disabled).toBe(true);
    expect(errorEl().hidden).toBe(false);
  });

  it("exposes accessible loading and error states", () => {
    loadSidePanel();
    expect(document.querySelector("#activation").getAttribute("aria-live")).toBe("polite");
    expect(statusEl().textContent).toBe("Loading…");
    expect(toggleEl().disabled).toBe(true);

    const h2 = loadSidePanel();
    h2.shiftQuery()([HTTP_TAB]);
    h2.shiftType("getTabInfo")({ ok: true, supported: true, url: HTTP_TAB.url, title: HTTP_TAB.title });
    h2.shiftType("getPageState")({ ok: false, error: "session-storage-unavailable" });

    expect(errorEl().getAttribute("role")).toBe("alert");
    expect(statusEl().textContent).toBe("Something went wrong");
    expect(toggleEl().disabled).toBe(true);
  });

  it("preserves the Open settings action", () => {
    const h = loadSidePanel();
    openOptionsEl().click();
    expect(h.chrome.runtime.openOptionsPage).toHaveBeenCalled();
  });
});

describe("ReadTrail side panel save lifecycle", () => {
  it("keeps save unavailable until the exact page is active", () => {
    const h = loadSidePanel();
    expect(saveSectionEl().hidden).toBe(true);
    initTab(h, HTTP_TAB, { ok: true, state: makeState(false) });
    expect(saveSectionEl().hidden).toBe(true);
    expect(saveButtonEl().disabled).toBe(true);
  });

  it("offers Save for later on an active page with no durable record", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { ok: true, state: makeState(true) });
    expect(saveSectionEl().hidden).toBe(false);
    expect(saveButtonEl().disabled).toBe(false);
    expect(saveButtonEl().textContent).toBe("Save for later");
    expect(localNoteEl().textContent).toContain("exact page URL and title");
  });

  it("offers Update saved position when this exact URL already has a record", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { ok: true, state: makeState(true) }, {
      ok: true,
      record: { version: 1, title: "Article", position: {}, savedAt: 10 }
    });
    expect(saveButtonEl().textContent).toBe("Update saved position");
  });

  it("shows Saved (disabled) when the durable record is at least as new as the tab position", () => {
    const h = loadSidePanel();
    const position = { anchor: { version: 1, path: [0], offset: 0 }, viewportOffset: 1, scrollY: 0, scrollRatio: 0, savedAt: 100 };
    initTab(h, HTTP_TAB, { ok: true, state: makeState(true, { mode: "frozen", position }) }, {
      ok: true,
      record: { version: 1, title: "Article", position: { ...position, savedAt: 100 }, savedAt: 10 }
    });
    expect(saveButtonEl().textContent).toBe("Saved");
    expect(saveButtonEl().disabled).toBe(true);
    expect(saveHintEl().textContent).toContain("matches where you are now");
  });

  it("offers Update saved position when the tab position is newer than the durable record", () => {
    const h = loadSidePanel();
    const position = { anchor: { version: 1, path: [0], offset: 0 }, viewportOffset: 1, scrollY: 0, scrollRatio: 0, savedAt: 200 };
    initTab(h, HTTP_TAB, { ok: true, state: makeState(true, { mode: "frozen", position }) }, {
      ok: true,
      record: { version: 1, title: "Article", position: { ...position, savedAt: 100 }, savedAt: 10 }
    });
    expect(saveButtonEl().textContent).toBe("Update saved position");
    expect(saveButtonEl().disabled).toBe(false);
  });

  it("explains an approximate or fallback restoration and stays quiet when exact", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { ok: true, state: makeState(true, { restoreQuality: "approximate" }) });
    expect(restoreNoteEl().hidden).toBe(false);
    expect(restoreNoteEl().textContent).toContain("Restored approximately");

    const h2 = loadSidePanel();
    initTab(h2, HTTP_TAB, { ok: true, state: makeState(true, { restoreQuality: "fallback" }) });
    expect(restoreNoteEl().textContent).toContain("could not be found");

    const h3 = loadSidePanel();
    initTab(h3, HTTP_TAB, { ok: true, state: makeState(true, { restoreQuality: "exact" }) });
    expect(restoreNoteEl().hidden).toBe(true);
  });

  it("saves through the active tab, guards the in-flight request, and confirms success", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { ok: true, state: makeState(true) });
    clickSave();
    clickSave();
    expect(h.tabMsgs).toEqual([{ type: "saveForLater" }]);
    expect(saveButtonEl().disabled).toBe(true);

    h.shiftTab()({ ok: true });
    expect(saveButtonEl().textContent).toBe("Saved");
    expect(saveButtonEl().classList.contains("is-saved")).toBe(true);
    expect(saveStatusEl().hidden).toBe(false);
    expect(saveStatusEl().textContent).toContain("Saved on this device");
  });

  it("shows failures without claiming that the position was saved", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { ok: true, state: makeState(true) });
    clickSave();
    h.shiftTab()({ ok: false, error: "no-checkpoint" });
    expect(errorEl().hidden).toBe(false);
    expect(errorEl().textContent).toContain("Pause at a line first");
    expect(saveStatusEl().hidden).toBe(true);
    expect(saveButtonEl().textContent).toBe("Save for later");
  });
});

describe("ReadTrail side panel recently closed", () => {
  const URL_A = "https://example.com/article-a";
  const makeRecentItem = (url, title, closedAt) => ({ url, tabId: 1, title, closedAt });

  function recentItems() {
    return [...document.querySelectorAll("#recentList .recent-item")];
  }
  function findRecentItem(url) {
    return recentItems().find((li) => li.dataset.url === url);
  }
  function recentButtonsFor(url) {
    const li = findRecentItem(url);
    return {
      li,
      save: li.querySelector(".btn-save-place"),
      dismiss: li.querySelector(".btn-dismiss"),
      status: li.querySelector(".item-status")
    };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hides the section when there is nothing recently closed", () => {
    const h = loadSidePanel();
    h.shiftType("listRecentlyClosed")({ ok: true, items: [] });
    expect(recentSectionEl().hidden).toBe(true);
  });

  it("renders items with title, domain, and age, offering Save place and Dismiss", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-05T12:35:00Z"));
    const closedAt = new Date("2026-01-05T12:30:00Z").getTime(); // 5 minutes ago

    const h = loadSidePanel();
    h.shiftType("listRecentlyClosed")({ ok: true, items: [makeRecentItem(URL_A, "Recent Article", closedAt)] });

    const b = recentButtonsFor(URL_A);
    expect(recentSectionEl().hidden).toBe(false);
    expect(b.li.textContent).toContain("Recent Article");
    expect(b.li.textContent).toContain("example.com");
    expect(b.li.textContent).toContain("closed 5 minutes ago");
    expect(b.save.textContent).toBe("Save place");
    expect(b.dismiss.textContent).toBe("Dismiss");
  });

  it("Save place sends saveRecentlyClosed and removes the row on success", () => {
    const h = loadSidePanel();
    h.shiftType("listRecentlyClosed")({ ok: true, items: [makeRecentItem(URL_A, "Recent Article", Date.now())] });

    recentButtonsFor(URL_A).save.click();
    expect(h.runtimeMsgs.filter((m) => m.type === "saveRecentlyClosed")).toEqual([
      { type: "saveRecentlyClosed", url: URL_A }
    ]);

    h.shiftType("saveRecentlyClosed")({ ok: true });
    expect(findRecentItem(URL_A)).toBeUndefined();
  });

  it("shows an alert status when Save place fails and keeps the row", () => {
    const h = loadSidePanel();
    h.shiftType("listRecentlyClosed")({ ok: true, items: [makeRecentItem(URL_A, "Recent Article", Date.now())] });

    recentButtonsFor(URL_A).save.click();
    h.shiftType("saveRecentlyClosed")({ ok: false, error: "save-storage-error" });

    const b = recentButtonsFor(URL_A);
    expect(b.li).toBeTruthy();
    expect(b.status.getAttribute("role")).toBe("alert");
    expect(b.status.textContent).toContain("Could not save this place");
  });

  it("Dismiss sends dismissRecentlyClosed and removes the row", () => {
    const h = loadSidePanel();
    h.shiftType("listRecentlyClosed")({ ok: true, items: [makeRecentItem(URL_A, "Recent Article", Date.now())] });

    recentButtonsFor(URL_A).dismiss.click();
    expect(h.runtimeMsgs.filter((m) => m.type === "dismissRecentlyClosed")).toEqual([
      { type: "dismissRecentlyClosed", url: URL_A }
    ]);

    h.shiftType("dismissRecentlyClosed")({ ok: true });
    expect(findRecentItem(URL_A)).toBeUndefined();
  });
});

describe("ReadTrail side panel shell and tab tracking", () => {
  it("queries the active tab on load and asks the worker for its info", () => {
    const h = loadSidePanel();
    h.shiftQuery()([HTTP_TAB]);
    expect(h.runtimeMsgs).toContainEqual({ type: "getTabInfo", tabId: HTTP_TAB.id });
  });

  it("re-syncs on tabs.onActivated and reloads state for the newly active tab", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { ok: true, state: makeState(false) });

    const otherTab = { id: 9, url: "https://example.org/other", title: "Other" };
    h.emitActivated({ tabId: otherTab.id, windowId: 1 });

    h.shiftQuery()([otherTab]);
    h.shiftType("getTabInfo")({ ok: true, supported: true, url: otherTab.url, title: otherTab.title });
    expect(h.runtimeMsgs).toContainEqual({ type: "getPageState", tabId: otherTab.id, url: otherTab.url });
  });

  it("re-syncs on tabs.onUpdated for the tracked tab when status is complete, and ignores other tabs", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { ok: true, state: makeState(false) });

    const queryCountBefore = h.pending.query.length;
    h.emitUpdated(9999, { status: "complete" });
    expect(h.pending.query.length).toBe(queryCountBefore);

    h.emitUpdated(HTTP_TAB.id, { status: "complete" });
    expect(h.pending.query.length).toBe(queryCountBefore + 1);
  });

  it("refreshes page state on a session storage change for the tracked tab only", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { ok: true, state: makeState(false) });

    const before = h.pendingCount("getPageState");
    h.emitChanged({ [h.KEYS.TAB_PREFIX + "999"]: { newValue: {} } }, "session");
    expect(h.pendingCount("getPageState")).toBe(before);

    h.emitChanged({ [h.KEYS.TAB_PREFIX + String(HTTP_TAB.id)]: { newValue: {} } }, "session");
    expect(h.pendingCount("getPageState")).toBe(before + 1);
  });

  it("reloads the recently-closed list on a session storage change to the recent key", () => {
    const h = loadSidePanel();
    h.shiftType("listRecentlyClosed")({ ok: true, items: [] });
    const before = h.pendingCount("listRecentlyClosed");

    h.emitChanged({ [h.KEYS.RECENT]: { newValue: {} } }, "session");
    expect(h.pendingCount("listRecentlyClosed")).toBe(before + 1);
  });

  it("hides This page and Open desk, and sends no getTabInfo, in ?mode=page", () => {
    const h = loadSidePanel({ mode: "page" });
    expect(pageSectionEl().hidden).toBe(true);
    expect(openInTabEl().hidden).toBe(true);
    expect(h.runtimeMsgs.some((m) => m.type === "getTabInfo")).toBe(false);
    expect(h.pending.query).toHaveLength(0);
  });

  it("opens the Desk in a full tab from Open desk", () => {
    const h = loadSidePanel();
    openInTabEl().click();
    expect(h.chrome.tabs.create).toHaveBeenCalledWith({
      url: "chrome-extension://test/sidepanel/desk.html"
    });
  });
});
