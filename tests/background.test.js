import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadServiceWorker, senders } from "./helpers/chrome-mock.js";

// Compatibility wrapper around the shared helper so the persistent-service
// suite keeps its `loadWorker(settings, _pages, options)` call shape.
function loadWorker(storedSettings, _storedPages = {}, options = {}) {
  const local = storedSettings !== undefined ? { settings: storedSettings } : {};
  return loadServiceWorker({
    local,
    errors: {
      local: { get: options.localGetError, set: options.localSetError, remove: options.localRemoveError },
      session: { get: options.sessionGetError, set: options.sessionSetError, remove: options.sessionRemoveError }
    },
    disableTabs: options.disableTabs,
    onTabsCreate: options.onTabsCreate,
    tabsCreateError: options.tabsCreateError,
    tabs: options.tabs
  });
}

const TAB_KEY = (id) => `readtrail.tab.v1:${id}`;
const PAGE = senders.page("popup/popup.html");

function makePosition(overrides = {}) {
  return {
    anchor: { version: 1, path: [0, 1], offset: 2 },
    viewportOffset: 40,
    scrollY: 300,
    scrollRatio: 0.25,
    savedAt: 123,
    ...overrides
  };
}

function tabRecord(url, overrides = {}) {
  return {
    version: 1,
    url,
    title: "",
    active: true,
    mode: "following",
    position: null,
    incognito: false,
    origin: "user",
    updatedAt: 1,
    ...overrides
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

  it("removes the legacy global enable setting and the legacy session map on update", () => {
    const { installedHandler, localSet, sessionStore, sessionData } = loadWorker({ enabled: false, style: "underline" });
    sessionData.readingPages = { "https://example.com/a": { version: 1, active: true, mode: "following", position: null } };
    installedHandler();

    expect(localSet).toHaveBeenCalledWith({
      settings: expect.objectContaining({ style: "underline" })
    });
    expect(localSet.mock.calls[0][0].settings).not.toHaveProperty("enabled");
    expect(sessionStore.remove).toHaveBeenCalledWith("readingPages", expect.any(Function));
    expect(sessionData).not.toHaveProperty("readingPages");
  });

  it("does not expose or accept the removed global enable setting", () => {
    const { messageHandler } = loadWorker({ enabled: false, style: "underline" });
    const sendResponse = vi.fn();

    expect(messageHandler({ type: "getSettings" }, {}, sendResponse)).toBe(true);
    expect(sendResponse.mock.calls[0][0]).not.toHaveProperty("enabled");
    expect(messageHandler({ type: "toggleEnabled", enabled: false }, {}, vi.fn())).toBe(false);
  });

  describe("settings writes", () => {
    it("accepts a validated partial update and merges it over stored values", () => {
      const { messageHandler, localData } = loadWorker({ style: "dots", size: 40 });
      const done = vi.fn();

      expect(messageHandler({ type: "setSettings", settings: { color: "#123456" } }, PAGE, done)).toBe(true);
      expect(done).toHaveBeenCalledWith({
        ok: true,
        settings: expect.objectContaining({ style: "dots", size: 40, color: "#123456" })
      });
      expect(localData.settings).toEqual(expect.objectContaining({ style: "dots", size: 40, color: "#123456" }));
    });

    it("rejects malformed or unknown settings without writing", () => {
      const { messageHandler, localSet, localData } = loadWorker({ style: "dots" });
      const bad = [
        { size: "30" },
        { color: "red" },
        { style: "laser" },
        { enabled: true },
        { opacity: 2 },
        "nope",
        null
      ];
      for (const settings of bad) {
        const done = vi.fn();
        expect(messageHandler({ type: "setSettings", settings }, PAGE, done)).toBe(true);
        expect(done).toHaveBeenCalledWith({ ok: false, error: "invalid-input" });
      }
      expect(localSet).not.toHaveBeenCalled();
      expect(localData.settings).toEqual({ style: "dots" });
    });
  });

  describe("per-tab session state", () => {
    const urlA = "https://example.com/article?edition=1#part";
    const urlB = "https://example.com/other";

    it("returns an inactive default for a tab without session state", () => {
      const { messageHandler, sessionSet } = loadWorker({});
      const sendResponse = vi.fn();

      expect(messageHandler({ type: "getPageState", url: urlA }, senders.content(1, urlA), sendResponse)).toBe(true);
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        state: { version: 1, active: false, mode: "following", position: null }
      });
      expect(sessionSet).not.toHaveBeenCalled();
    });

    it("activates one tab without touching another tab on the same exact URL", () => {
      const { messageHandler, sessionData } = loadWorker({});

      const done = vi.fn();
      expect(messageHandler({ type: "setPageActive", tabId: 1, url: urlA, active: true }, PAGE, done)).toBe(true);
      expect(done).toHaveBeenCalledWith({
        ok: true,
        state: { version: 1, active: true, mode: "following", position: null }
      });
      expect(sessionData[TAB_KEY(1)]).toEqual(expect.objectContaining({ url: urlA, active: true, origin: "user" }));
      expect(sessionData[TAB_KEY(2)]).toBeUndefined();

      const other = vi.fn();
      messageHandler({ type: "getPageState", url: urlA }, senders.content(2, urlA), other);
      expect(other).toHaveBeenCalledWith({
        ok: true,
        state: { version: 1, active: false, mode: "following", position: null }
      });
    });

    it("keeps positions separate across two active tabs on the same URL", () => {
      const { messageHandler, sessionData } = loadWorker({});
      messageHandler({ type: "setPageActive", tabId: 1, url: urlA, active: true }, PAGE, vi.fn());
      messageHandler({ type: "setPageActive", tabId: 2, url: urlA, active: true }, PAGE, vi.fn());

      messageHandler(
        { type: "savePagePosition", url: urlA, mode: "frozen", position: makePosition({ scrollY: 100 }), title: " Tab one " },
        senders.content(1, urlA),
        vi.fn()
      );
      messageHandler(
        { type: "savePagePosition", url: urlA, mode: "following", position: makePosition({ scrollY: 900 }) },
        senders.content(2, urlA),
        vi.fn()
      );

      expect(sessionData[TAB_KEY(1)]).toEqual(expect.objectContaining({
        mode: "frozen",
        title: "Tab one",
        position: expect.objectContaining({ scrollY: 100 })
      }));
      expect(sessionData[TAB_KEY(2)]).toEqual(expect.objectContaining({
        mode: "following",
        position: expect.objectContaining({ scrollY: 900 })
      }));
    });

    it("turning off one tab leaves the other tab's record byte-identical", () => {
      const before = tabRecord(urlA, { mode: "frozen", position: makePosition() });
      const { messageHandler, sessionData } = loadWorker({}, {}, {});
      sessionData[TAB_KEY(2)] = before;
      const snapshot = JSON.stringify(before);
      messageHandler({ type: "setPageActive", tabId: 1, url: urlA, active: true }, PAGE, vi.fn());

      const done = vi.fn();
      messageHandler({ type: "setPageActive", tabId: 1, url: urlA, active: false }, PAGE, done);
      expect(done).toHaveBeenCalledWith({
        ok: true,
        state: { version: 1, active: false, mode: "following", position: null }
      });
      expect(sessionData[TAB_KEY(1)].active).toBe(false);
      expect(JSON.stringify(sessionData[TAB_KEY(2)])).toBe(snapshot);
    });

    it("retains the position when a tab is turned off and reports the record for its exact URL only", () => {
      const { messageHandler, sessionData } = loadWorker({});
      sessionData[TAB_KEY(1)] = tabRecord(urlA, { mode: "frozen", position: makePosition() });

      const done = vi.fn();
      messageHandler({ type: "setPageActive", tabId: 1, url: urlA, active: false }, PAGE, done);
      expect(done).toHaveBeenCalledWith({
        ok: true,
        state: { version: 1, active: false, mode: "frozen", position: makePosition() }
      });

      const drifted = vi.fn();
      messageHandler({ type: "getPageState", url: urlB }, senders.content(1, urlB), drifted);
      expect(drifted).toHaveBeenCalledWith({
        ok: true,
        state: { version: 1, active: false, mode: "following", position: null }
      });
    });

    it("deactivating a tab with no record replies with the default and writes nothing", () => {
      const { messageHandler, sessionSet } = loadWorker({});
      const done = vi.fn();
      messageHandler({ type: "setPageActive", tabId: 5, url: urlA, active: false }, PAGE, done);
      expect(done).toHaveBeenCalledWith({
        ok: true,
        state: { version: 1, active: false, mode: "following", position: null }
      });
      expect(sessionSet).not.toHaveBeenCalled();
    });

    it("activating a tab that navigated replaces the stale record for the old URL", () => {
      const { messageHandler, sessionData } = loadWorker({});
      sessionData[TAB_KEY(1)] = tabRecord(urlB, { mode: "frozen", position: makePosition() });

      messageHandler({ type: "setPageActive", tabId: 1, url: urlA, active: true }, PAGE, vi.fn());
      expect(sessionData[TAB_KEY(1)]).toEqual(expect.objectContaining({ url: urlA, active: true, position: null }));
    });

    it("rejects position writes for inactive tabs, other URLs, and malformed records", () => {
      const { messageHandler, sessionSet, sessionData } = loadWorker({});
      sessionData[TAB_KEY(1)] = tabRecord(urlA, { active: false });
      sessionData[TAB_KEY(2)] = tabRecord(urlB);
      const position = makePosition();

      const inactive = vi.fn();
      messageHandler({ type: "savePagePosition", url: urlA, mode: "following", position }, senders.content(1, urlA), inactive);
      expect(inactive).toHaveBeenCalledWith({ ok: false, error: "page-inactive" });

      const otherUrl = vi.fn();
      messageHandler({ type: "savePagePosition", url: urlA, mode: "following", position }, senders.content(2, urlA), otherUrl);
      expect(otherUrl).toHaveBeenCalledWith({ ok: false, error: "page-inactive" });

      const noRecord = vi.fn();
      messageHandler({ type: "savePagePosition", url: urlA, mode: "following", position }, senders.content(3, urlA), noRecord);
      expect(noRecord).toHaveBeenCalledWith({ ok: false, error: "page-inactive" });

      const malformed = vi.fn();
      messageHandler(
        { type: "savePagePosition", url: urlA, mode: "following", position: { ...position, scrollRatio: 2 } },
        senders.content(2, urlB),
        malformed
      );
      expect(malformed).toHaveBeenCalledWith({ ok: false, error: "invalid-input" });

      const badUrl = vi.fn();
      messageHandler({ type: "setPageActive", tabId: 1, url: "chrome://extensions", active: true }, PAGE, badUrl);
      expect(badUrl).toHaveBeenCalledWith({ ok: false, error: "invalid-input" });

      expect(sessionSet).not.toHaveBeenCalled();
    });

    it("stores a valid restoreQuality from checkpoints and ignores invalid ones", () => {
      const { messageHandler, sessionData } = loadWorker({});
      messageHandler({ type: "setPageActive", tabId: 1, url: urlA, active: true }, PAGE, vi.fn());
      messageHandler(
        { type: "savePagePosition", url: urlA, mode: "following", position: makePosition(), restoreQuality: "approximate" },
        senders.content(1, urlA),
        vi.fn()
      );
      expect(sessionData[TAB_KEY(1)].restoreQuality).toBe("approximate");

      const state = vi.fn();
      messageHandler({ type: "getPageState", url: urlA }, senders.content(1, urlA), state);
      expect(state.mock.calls[0][0].state.restoreQuality).toBe("approximate");

      messageHandler(
        { type: "savePagePosition", url: urlA, mode: "following", position: makePosition(), restoreQuality: "perfect" },
        senders.content(1, urlA),
        vi.fn()
      );
      expect(sessionData[TAB_KEY(1)].restoreQuality).toBe("approximate");
    });

    it("records incognito from the content-script sender on checkpoints", () => {
      const { messageHandler, sessionData } = loadWorker({});
      messageHandler({ type: "setPageActive", tabId: 1, url: urlA, active: true }, PAGE, vi.fn());
      messageHandler(
        { type: "savePagePosition", url: urlA, mode: "following", position: makePosition() },
        senders.content(1, urlA, { incognito: true }),
        vi.fn()
      );
      expect(sessionData[TAB_KEY(1)].incognito).toBe(true);
    });

    it("keys content-script senders by sender.tab.id and ignores a spoofed tabId", () => {
      const { messageHandler, sessionData } = loadWorker({});
      sessionData[TAB_KEY(1)] = tabRecord(urlA);
      sessionData[TAB_KEY(99)] = tabRecord(urlA);

      messageHandler(
        { type: "savePagePosition", tabId: 99, url: urlA, mode: "frozen", position: makePosition({ scrollY: 7 }) },
        senders.content(1, urlA),
        vi.fn()
      );
      expect(sessionData[TAB_KEY(1)].position).toEqual(expect.objectContaining({ scrollY: 7 }));
      expect(sessionData[TAB_KEY(99)].position).toBeNull();
    });

    it("treats an extension page that is open in a tab as an extension page, not a content script", () => {
      const { messageHandler, sessionData } = loadWorker({}, {}, { tabs: [{ id: 1, url: urlA, title: "A" }] });
      const pageInTab = { ...senders.page("sidepanel/sidepanel.html?mode=page"), tab: { id: 77, url: "chrome-extension://test/sidepanel/sidepanel.html?mode=page" } };
      const done = vi.fn();
      messageHandler({ type: "setPageActive", tabId: 1, url: urlA, active: true }, pageInTab, done);
      expect(done.mock.calls[0][0].ok).toBe(true);
      expect(sessionData[TAB_KEY(1)]).toBeDefined();
      expect(sessionData[TAB_KEY(77)]).toBeUndefined();

      const info = vi.fn();
      messageHandler({ type: "getTabInfo", tabId: 1 }, pageInTab, info);
      expect(info.mock.calls[0][0].ok).toBe(true);
    });

    it("refuses extension pages without a tabId and unknown senders", () => {
      const { messageHandler, sessionSet } = loadWorker({});

      const missing = vi.fn();
      messageHandler({ type: "setPageActive", url: urlA, active: true }, PAGE, missing);
      expect(missing).toHaveBeenCalledWith({ ok: false, error: "invalid-input" });

      const foreign = vi.fn();
      messageHandler({ type: "setPageActive", tabId: 1, url: urlA, active: true }, { url: "https://evil.example/x" }, foreign);
      expect(foreign).toHaveBeenCalledWith({ ok: false, error: "invalid-sender" });

      const empty = vi.fn();
      messageHandler({ type: "getPageState", tabId: 1, url: urlA }, {}, empty);
      expect(empty).toHaveBeenCalledWith({ ok: false, error: "invalid-sender" });

      const badTab = vi.fn();
      messageHandler({ type: "getPageState", url: urlA }, { tab: { id: -1, url: urlA } }, badTab);
      expect(badTab).toHaveBeenCalledWith({ ok: false, error: "invalid-sender" });

      expect(sessionSet).not.toHaveBeenCalled();
    });

    it("deletes the record when its tab closes and refuses a late checkpoint afterwards", () => {
      const { messageHandler, emit, sessionData, sessionStore } = loadWorker({});
      sessionData[TAB_KEY(1)] = tabRecord(urlA, { position: makePosition() });
      sessionData[TAB_KEY(2)] = tabRecord(urlB);

      emit.tabs.onRemoved(1);
      expect(sessionStore.remove).toHaveBeenCalledWith(TAB_KEY(1), expect.any(Function));
      expect(sessionData[TAB_KEY(1)]).toBeUndefined();
      expect(sessionData[TAB_KEY(2)]).toBeDefined();

      const late = vi.fn();
      messageHandler(
        { type: "savePagePosition", url: urlA, mode: "following", position: makePosition() },
        senders.content(1, urlA),
        late
      );
      expect(late).toHaveBeenCalledWith({ ok: false, error: "page-inactive" });
      const tabWrites = sessionStore.set.mock.calls.filter(([obj]) => Object.keys(obj).some((k) => k.startsWith("readtrail.tab.v1:")));
      expect(tabWrites).toEqual([]);
    });

    it("runs save-on-close before deleting a replaced tab's record", () => {
      const { emit, sessionData } = loadWorker({});
      sessionData[TAB_KEY(4)] = tabRecord(urlA, { title: "Replaced read", position: makePosition() });
      emit.tabs.onReplaced(9, 4);
      expect(sessionData[TAB_KEY(4)]).toBeUndefined();
      expect(sessionData["readtrail.recent.v1"].items).toEqual([
        expect.objectContaining({ tabId: 4, url: urlA, title: "Replaced read" })
      ]);
    });

    it("reports session storage failures without inventing state", () => {
      const { messageHandler } = loadWorker({}, {}, { sessionGetError: true });
      const done = vi.fn();
      messageHandler({ type: "getPageState", url: urlA }, senders.content(1, urlA), done);
      expect(done).toHaveBeenCalledWith({ ok: false, error: "session-read-error" });

      const failingWrite = loadWorker({}, {}, { sessionSetError: true });
      const write = vi.fn();
      failingWrite.messageHandler({ type: "setPageActive", tabId: 1, url: urlA, active: true }, PAGE, write);
      expect(write).toHaveBeenCalledWith({ ok: false, error: "session-storage-error" });
      expect(failingWrite.sessionData[TAB_KEY(1)]).toBeUndefined();
    });
  });

  describe("recently closed tabs", () => {
    const url = "https://example.com/long-read";
    const RECENT = "readtrail.recent.v1";
    const SAVED = `readtrail.saved.v1:${url}`;

    function closedTab(overrides = {}) {
      return tabRecord(url, { title: "Long read", position: makePosition({ savedAt: 500 }), ...overrides });
    }

    it("serializes simultaneous tab removals so every recent item is retained", () => {
      const h = loadWorker({});
      const urlB = "https://example.com/second-read";
      h.sessionData[TAB_KEY(1)] = closedTab();
      h.sessionData[TAB_KEY(2)] = tabRecord(urlB, { title: "Second read", position: makePosition({ savedAt: 600 }) });

      let releaseFirstRead;
      h.sessionStore.get.mockImplementationOnce((key, callback) => {
        releaseFirstRead = () => callback({ [key]: h.sessionData[key] });
      });

      h.emit.tabs.onRemoved(1);
      h.emit.tabs.onRemoved(2);
      expect(h.sessionStore.get).toHaveBeenCalledTimes(1);

      releaseFirstRead();
      expect(h.sessionData[RECENT].items.map((item) => item.url)).toEqual([urlB, url]);
      expect(h.sessionData[TAB_KEY(1)]).toBeUndefined();
      expect(h.sessionData[TAB_KEY(2)]).toBeUndefined();
    });

    it("asks by default: records the closed tab, sets the badge, and deletes the tab record", () => {
      const h = loadWorker({});
      h.sessionData[TAB_KEY(1)] = closedTab();
      h.emit.tabs.onRemoved(1);

      expect(h.sessionData[TAB_KEY(1)]).toBeUndefined();
      expect(h.sessionData[RECENT].items).toHaveLength(1);
      expect(h.sessionData[RECENT].items[0]).toEqual(expect.objectContaining({
        tabId: 1, url, title: "Long read", position: expect.objectContaining({ savedAt: 500 })
      }));
      expect(h.chrome.action.setBadgeText).toHaveBeenCalledWith({ text: "1" }, expect.any(Function));
      expect(h.localData[SAVED]).toBeUndefined();
    });

    it("always: writes the durable record with a hostname fallback title and no recent item", () => {
      const h = loadWorker({ closeSave: "always" });
      h.sessionData[TAB_KEY(1)] = closedTab({ title: "" });
      h.emit.tabs.onRemoved(1);

      expect(h.localData[SAVED]).toEqual(expect.objectContaining({
        version: 1, title: "example.com", position: expect.objectContaining({ savedAt: 500 })
      }));
      expect(h.sessionData[RECENT]).toBeUndefined();
      expect(h.sessionData[TAB_KEY(1)]).toBeUndefined();
    });

    it("never: writes nothing beyond deleting the tab record", () => {
      const h = loadWorker({ closeSave: "never" });
      h.sessionData[TAB_KEY(1)] = closedTab();
      h.emit.tabs.onRemoved(1);
      expect(h.localData[SAVED]).toBeUndefined();
      expect(h.sessionData[RECENT]).toBeUndefined();
      expect(h.sessionData[TAB_KEY(1)]).toBeUndefined();
    });

    it("skips inactive, positionless, incognito, and already-saved tabs", () => {
      const h = loadWorker({});
      h.sessionData[TAB_KEY(1)] = closedTab({ active: false });
      h.sessionData[TAB_KEY(2)] = closedTab({ position: null });
      h.sessionData[TAB_KEY(3)] = closedTab({ incognito: true });
      h.sessionData[TAB_KEY(4)] = closedTab();
      h.localData[SAVED] = { version: 1, title: "Long read", position: makePosition({ savedAt: 900 }), savedAt: 1 };
      for (const id of [1, 2, 3, 4]) h.emit.tabs.onRemoved(id);
      expect(h.sessionData[RECENT]).toBeUndefined();
      expect(Object.keys(h.sessionData).filter((k) => k.startsWith("readtrail.tab.v1:"))).toEqual([]);
    });

    it("keeps the newest entry per URL, caps the list at 10, and drops expired items on read", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-13T10:00:00Z"));
      const h = loadWorker({});
      for (let i = 0; i < 12; i++) {
        h.sessionData[TAB_KEY(i)] = tabRecord(`https://example.com/p${i}`, { position: makePosition({ savedAt: 500 }) });
        h.emit.tabs.onRemoved(i);
      }
      expect(h.sessionData[RECENT].items).toHaveLength(10);
      expect(h.sessionData[RECENT].items[0].url).toBe("https://example.com/p11");

      // Same URL closed again replaces its earlier entry instead of duplicating.
      h.sessionData[TAB_KEY(50)] = tabRecord("https://example.com/p11", { position: makePosition({ savedAt: 600 }) });
      h.emit.tabs.onRemoved(50);
      expect(h.sessionData[RECENT].items.filter((i) => i.url === "https://example.com/p11")).toHaveLength(1);

      vi.setSystemTime(new Date("2026-09-13T10:31:00Z"));
      const done = vi.fn();
      h.messageHandler({ type: "listRecentlyClosed" }, PAGE, done);
      expect(done).toHaveBeenCalledWith({ ok: true, items: [] });
      expect(h.sessionData[RECENT].items).toEqual([]);
      expect(h.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: "" }, expect.any(Function));
      vi.useRealTimers();
    });

    it("lists only url, title, and closedAt, never the position", () => {
      const h = loadWorker({});
      h.sessionData[TAB_KEY(1)] = closedTab();
      h.emit.tabs.onRemoved(1);
      const done = vi.fn();
      h.messageHandler({ type: "listRecentlyClosed" }, PAGE, done);
      const items = done.mock.calls[0][0].items;
      expect(items).toEqual([{ url, title: "Long read", closedAt: expect.any(Number) }]);
      expect(items[0]).not.toHaveProperty("position");
    });

    it("saves a recent item from the stored position, removes it, and clears the badge", () => {
      const h = loadWorker({});
      h.sessionData[TAB_KEY(1)] = closedTab();
      h.emit.tabs.onRemoved(1);

      const done = vi.fn();
      expect(h.messageHandler({ type: "saveRecentlyClosed", url }, PAGE, done)).toBe(true);
      expect(done).toHaveBeenCalledWith({ ok: true });
      expect(h.localData[SAVED]).toEqual(expect.objectContaining({ title: "Long read" }));
      expect(h.sessionData[RECENT].items).toEqual([]);
      expect(h.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: "" }, expect.any(Function));

      const missing = vi.fn();
      h.messageHandler({ type: "saveRecentlyClosed", url }, PAGE, missing);
      expect(missing).toHaveBeenCalledWith({ ok: false, error: "no-recent-item" });
    });

    it("dismisses a recent item without writing a durable record", () => {
      const h = loadWorker({});
      h.sessionData[TAB_KEY(1)] = closedTab();
      h.emit.tabs.onRemoved(1);
      const done = vi.fn();
      h.messageHandler({ type: "dismissRecentlyClosed", url }, PAGE, done);
      expect(done).toHaveBeenCalledWith({ ok: true });
      expect(h.sessionData[RECENT].items).toEqual([]);
      expect(h.localData[SAVED]).toBeUndefined();
    });

    it("leaves the durable record untouched when the saved write fails", () => {
      const h = loadWorker({}, {}, { localSetError: true });
      h.sessionData[TAB_KEY(1)] = closedTab();
      h.emit.tabs.onRemoved(1);
      const done = vi.fn();
      h.messageHandler({ type: "saveRecentlyClosed", url }, PAGE, done);
      expect(done).toHaveBeenCalledWith({ ok: false, error: "save-storage-error" });
      expect(h.localData[SAVED]).toBeUndefined();
      expect(h.sessionData[RECENT].items).toHaveLength(1);
    });

    it("enables opening the side panel from the toolbar action", () => {
      const h = loadWorker({});
      expect(h.chrome.sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
      h.installedHandler();
      expect(h.chrome.sidePanel.setPanelBehavior).toHaveBeenCalledTimes(2);
    });
  });

  describe("tab info for extension pages", () => {
    const url = "https://example.com/article";

    it("returns url, title, incognito, and support for a visible tab", () => {
      const { messageHandler } = loadWorker({}, {}, { tabs: [{ id: 3, url, title: "Article", incognito: true }] });
      const done = vi.fn();
      expect(messageHandler({ type: "getTabInfo", tabId: 3 }, PAGE, done)).toBe(true);
      expect(done).toHaveBeenCalledWith({ ok: true, url, title: "Article", incognito: true, supported: true, excluded: false });
    });

    it("marks non-http tabs unsupported and unknown tabs unavailable", () => {
      const { messageHandler } = loadWorker({}, {}, { tabs: [{ id: 3, url: "chrome://extensions", title: "Ext" }] });
      const done = vi.fn();
      messageHandler({ type: "getTabInfo", tabId: 3 }, PAGE, done);
      expect(done).toHaveBeenCalledWith({ ok: true, url: null, title: "", incognito: false, supported: false, excluded: false });

      const missing = vi.fn();
      messageHandler({ type: "getTabInfo", tabId: 8 }, PAGE, missing);
      expect(missing).toHaveBeenCalledWith({ ok: false, error: "tab-unavailable" });
    });

    it("falls back to the content script's pageInfo when the tab URL is hidden", () => {
      const h = loadWorker({}, {}, { tabs: [{ id: 3, title: "" }] });
      h.chrome.tabs.sendMessage.mockImplementation((_id, msg, cb) => {
        expect(msg).toEqual({ type: "pageInfo" });
        cb({ url, title: "From page" });
      });
      const done = vi.fn();
      h.messageHandler({ type: "getTabInfo", tabId: 3 }, PAGE, done);
      expect(done).toHaveBeenCalledWith({ ok: true, url, title: "From page", incognito: false, supported: true, excluded: false });
    });

    it("reports excluded sites and refuses to activate them", () => {
      const h = loadWorker({ excludedHosts: ["example.com"] }, {}, { tabs: [{ id: 3, url, title: "Article" }] });
      const info = vi.fn();
      h.messageHandler({ type: "getTabInfo", tabId: 3 }, PAGE, info);
      expect(info.mock.calls[0][0]).toEqual(expect.objectContaining({ supported: true, excluded: true }));

      const activate = vi.fn();
      h.messageHandler({ type: "setPageActive", tabId: 3, url, active: true }, PAGE, activate);
      expect(activate).toHaveBeenCalledWith({ ok: false, error: "site-excluded" });
      expect(h.sessionData["readtrail.tab.v1:3"]).toBeUndefined();
    });

    it("refuses content-script senders", () => {
      const { messageHandler } = loadWorker({}, {}, { tabs: [{ id: 3, url }] });
      const done = vi.fn();
      messageHandler({ type: "getTabInfo", tabId: 3 }, senders.content(3, url), done);
      expect(done).toHaveBeenCalledWith({ ok: false, error: "invalid-sender" });
    });
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

    it("continue: creates the tab first, then seeds that tab's record before replying", () => {
      const storedRecord = { version: 1, title: "A", position: position({ scrollY: 42 }), savedAt: 500 };
      const { messageHandler, localStore, sessionData, tabsCreate } = loadWorker(
        {},
        {},
        {
          onTabsCreate: (_props, callback) => {
            // No tab record may exist before the tab id is known.
            expect(Object.keys(sessionData).filter((k) => k.startsWith("readtrail.tab.v1:"))).toEqual([]);
            callback({ id: 9, url: urlA, incognito: false });
          }
        }
      );
      localStore.data[savedKeyFor(urlA)] = storedRecord;

      const done = vi.fn();
      expect(messageHandler({ type: "continueSavedResumePoint", url: urlA }, PAGE, done)).toBe(true);
      expect(tabsCreate).toHaveBeenCalledWith({ url: urlA }, expect.any(Function));
      expect(sessionData[TAB_KEY(9)]).toEqual(expect.objectContaining({
        url: urlA,
        title: "A",
        active: true,
        mode: "frozen",
        origin: "continue",
        position: expect.objectContaining({ scrollY: 42 })
      }));
      expect(done).toHaveBeenCalledWith({ ok: true, tabId: 9 });
    });

    it("continue: a tab already open on the same URL gains no record", () => {
      const storedRecord = { version: 1, title: "A", position: position({ scrollY: 42 }), savedAt: 500 };
      const { messageHandler, localStore, sessionData } = loadWorker({});
      localStore.data[savedKeyFor(urlA)] = storedRecord;
      sessionData[TAB_KEY(1)] = tabRecord(urlA, { active: false });
      const before = JSON.stringify(sessionData[TAB_KEY(1)]);

      const done = vi.fn();
      messageHandler({ type: "continueSavedResumePoint", url: urlA }, PAGE, done);
      expect(done).toHaveBeenCalledWith({ ok: true, tabId: expect.any(Number) });
      expect(JSON.stringify(sessionData[TAB_KEY(1)])).toBe(before);
    });

    it("continue: takes no valid tab without stored record and never writes persistent data", () => {
      const storedRecord = { version: 1, title: "A", position: position({ scrollY: 7 }), savedAt: 500 };
      const { messageHandler, localData, sessionSet, tabsCreate } = loadWorker({});
      const keyA = savedKeyFor(urlA);
      localData[keyA] = storedRecord;

      const done = vi.fn();
      expect(messageHandler({ type: "continueSavedResumePoint", url: urlB }, PAGE, done)).toBe(true);
      expect(done).toHaveBeenCalledWith({ ok: false, error: "no-saved-record" });
      expect(tabsCreate).not.toHaveBeenCalled();
      expect(sessionSet).not.toHaveBeenCalled();
      expect(localData[keyA]).toEqual(storedRecord);
    });

    it("continue: does not modify the persistent record", () => {
      const storedRecord = { version: 1, title: "A", position: position({ scrollY: 11 }), savedAt: 500 };
      const { messageHandler, localData } = loadWorker({});
      localData[savedKeyFor(urlA)] = storedRecord;

      const done = vi.fn();
      messageHandler({ type: "continueSavedResumePoint", url: urlA }, PAGE, done);
      expect(done).toHaveBeenCalledWith({ ok: true, tabId: expect.any(Number) });
      expect(localData[savedKeyFor(urlA)]).toEqual(storedRecord);
    });

    it("continue: reports a seed failure with the tab id and leaves the tab dormant", () => {
      const storedRecord = { version: 1, title: "A", position: position({ scrollY: 5 }), savedAt: 500 };
      const { messageHandler, localStore, sessionData, tabsCreate } = loadWorker(
        {},
        {},
        { onTabsCreate: (_props, callback) => callback({ id: 9, url: urlA }), sessionSetError: true }
      );
      localStore.data[savedKeyFor(urlA)] = storedRecord;

      const done = vi.fn();
      messageHandler({ type: "continueSavedResumePoint", url: urlA }, PAGE, done);
      expect(tabsCreate).toHaveBeenCalled();
      expect(done).toHaveBeenCalledWith({ ok: false, error: "session-storage-error", tabId: 9 });
      expect(sessionData[TAB_KEY(9)]).toBeUndefined();
      expect(localStore.data[savedKeyFor(urlA)]).toEqual(storedRecord);
    });

    it("persist: a failed storage write does not store the record", () => {
      const msg = { type: "persistResumePoint", url: urlA, title: "A", position: position() };

      const failing = loadWorker({}, {}, { localSetError: true });
      const done = vi.fn();
      expect(failing.messageHandler(msg, senderFor(urlA), done)).toBe(true);
      expect(done).toHaveBeenCalledWith({ ok: false, error: "save-storage-error" });
      expect(failing.localData).not.toHaveProperty(savedKeyFor(urlA));
    });

    it("continue: fails safely when chrome.tabs is unavailable, writing nothing", () => {
      const storedRecord = { version: 1, title: "A", position: position({ scrollY: 13 }), savedAt: 500 };
      const { messageHandler, localStore, sessionSet } = loadWorker({}, {}, { disableTabs: true });
      localStore.data[savedKeyFor(urlA)] = storedRecord;

      const done = vi.fn();
      expect(messageHandler({ type: "continueSavedResumePoint", url: urlA }, PAGE, done)).toBe(true);
      expect(done).toHaveBeenCalledWith({ ok: false, error: "tabs-unavailable" });
      expect(sessionSet).not.toHaveBeenCalled();
    });

    it("continue: reports tab-create lastError as tab-create-failed with no session write", () => {
      const storedRecord = { version: 1, title: "A", position: position({ scrollY: 29 }), savedAt: 500 };
      const { messageHandler, localStore, sessionSet } = loadWorker({}, {}, { tabsCreateError: true });
      localStore.data[savedKeyFor(urlA)] = storedRecord;

      const done = vi.fn();
      expect(messageHandler({ type: "continueSavedResumePoint", url: urlA }, PAGE, done)).toBe(true);
      expect(done).toHaveBeenCalledWith({ ok: false, error: "tab-create-failed" });
      expect(sessionSet).not.toHaveBeenCalled();
    });
  });
});

describe("Return worker trust and completion", () => {
  const urlA = "https://example.com/article-a";
  const urlB = "https://example.com/article-b";

  function savePassage(h) {
    const done = vi.fn();
    h.messageHandler({ type: "savePassage", url: urlA, title: "A", text: "quoted words" }, PAGE, done);
    return done.mock.calls[0][0].passage;
  }

  it("waits for a newly opened tab to report the final reveal quality", () => {
    const h = loadWorker({});
    const passage = savePassage(h);
    const returned = vi.fn();
    h.messageHandler({ type: "revealPassage", id: passage.id }, PAGE, returned);
    expect(returned).not.toHaveBeenCalled();
    expect(h.tabsCreate).toHaveBeenCalledWith({ url: urlA }, expect.any(Function));

    const seeded = vi.fn();
    h.messageHandler({ type: "takeSeededReveal", url: urlA }, senders.content(100, urlA), seeded);
    expect(seeded.mock.calls[0][0]).toEqual(expect.objectContaining({ ok: true, passage: expect.objectContaining({ text: "quoted words" }) }));
    const completed = vi.fn();
    h.messageHandler({ type: "completeSeededReveal", quality: "approximate" }, senders.content(100, urlA), completed);

    expect(completed).toHaveBeenCalledWith({ ok: true });
    expect(returned).toHaveBeenCalledWith({ ok: true, tabId: 100, opened: true, quality: "approximate" });
  });

  it("checks a seen tab's actual page before sending it clip text", () => {
    const h = loadWorker({}, {}, { tabs: [{ id: 7, url: urlB, incognito: false }] });
    const passage = savePassage(h);
    h.sessionData["readtrail.seen.v1:7"] = { version: 1, url: urlA, updatedAt: 10 };
    h.chrome.tabs.sendMessage.mockImplementation((_tabId, message, callback) => {
      expect(message).toEqual({ type: "pageInfo" });
      callback({ url: urlB, title: "B" });
    });
    const returned = vi.fn();
    h.messageHandler({ type: "revealPassage", id: passage.id }, PAGE, returned);

    expect(h.sessionData["readtrail.seen.v1:7"]).toBeUndefined();
    expect(h.tabsCreate).toHaveBeenCalledWith({ url: urlA }, expect.any(Function));
    const seeded = vi.fn();
    h.messageHandler({ type: "takeSeededReveal", url: urlA }, senders.content(100, urlA), seeded);
    h.messageHandler({ type: "completeSeededReveal", quality: "exact" }, senders.content(100, urlA), vi.fn());
    expect(returned).toHaveBeenCalledWith({ ok: true, tabId: 100, opened: true, quality: "exact" });
  });

  it("refuses seeded reveals to the wrong page and to incognito senders", () => {
    const wrong = loadWorker({});
    const passage = savePassage(wrong);
    const returned = vi.fn();
    wrong.messageHandler({ type: "revealPassage", id: passage.id }, PAGE, returned);
    const denied = vi.fn();
    wrong.messageHandler({ type: "takeSeededReveal", url: urlA }, senders.content(100, urlB), denied);
    expect(denied).toHaveBeenCalledWith({ ok: true, passage: null });
    expect(wrong.sessionData["readtrail.tab.v1:100"]).toBeUndefined();
    wrong.emit.tabs.onRemoved(100);
    expect(returned).toHaveBeenCalledWith({ ok: false, error: "reveal-unavailable", tabId: 100 });

    const incognito = loadWorker({});
    const other = savePassage(incognito);
    incognito.messageHandler({ type: "revealPassage", id: other.id }, PAGE, vi.fn());
    const incognitoReply = vi.fn();
    incognito.messageHandler(
      { type: "takeSeededReveal", url: urlA },
      senders.content(100, urlA, { incognito: true }),
      incognitoReply
    );
    expect(incognitoReply).toHaveBeenCalledWith({ ok: false, error: "invalid-sender" });
    expect(incognito.sessionData["readtrail.seen.v1:100"]).toBeUndefined();
  });

  it("guards new saved positions at the storage soft limit", () => {
    const h = loadWorker({});
    h.chrome.storage.local.getBytesInUse = vi.fn((_, callback) => callback(9 * 1024 * 1024));
    const done = vi.fn();
    h.messageHandler(
      { type: "persistResumePoint", url: urlA, title: "A", position: makePosition() },
      senders.content(9, urlA),
      done
    );
    expect(done).toHaveBeenCalledWith({ ok: false, error: "storage-full" });
    expect(h.localData[`readtrail.saved.v1:${urlA}`]).toBeUndefined();
  });
});
