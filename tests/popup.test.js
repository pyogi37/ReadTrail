import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const html = fs.readFileSync(path.join(root, "popup/popup.html"), "utf8");
const script = fs.readFileSync(path.join(root, "popup/popup.js"), "utf8");

const makeState = (active) => ({ version: 1, active, mode: "following", position: null });
const HTTP_TAB = { id: 7, url: "https://example.com/article" };

// Loads popup.html and evaluates popup.js with a deferring chrome mock. Every
// async callback (tabs.query, runtime.sendMessage, tabs.sendMessage) is captured
// into `pending` so tests can drive and order the conversations exactly.
function loadPopup() {
  document.open();
  document.write(html.replace('<script src="popup.js"></script>', ""));
  document.close();

  const pending = { query: [], runtime: [], tab: [] };
  const runtimeMsgs = [];
  const tabMsgs = [];

  globalThis.chrome = {
    runtime: {
      lastError: null,
      sendMessage: vi.fn((msg, cb) => {
        runtimeMsgs.push(msg);
        pending.runtime.push(cb);
      }),
      openOptionsPage: vi.fn()
    },
    tabs: {
      query: vi.fn((_query, cb) => {
        pending.query.push(cb);
      }),
      sendMessage: vi.fn((id, msg, cb) => {
        tabMsgs.push(msg);
        pending.tab.push(cb);
      })
    }
  };

  window.eval(script);
  return { pending, runtimeMsgs, tabMsgs, openOptions: globalThis.chrome.runtime.openOptionsPage };
}

// Resolves the initial tab query and the getPageState read so the popup settles
// into its real (inactive/active) state.
function initPopup(h, tabs, stateResponse) {
  h.pending.query[0](Array.isArray(tabs) ? tabs : [tabs]);
  h.pending.runtime[0](stateResponse);
}

const toggleEl = () => document.querySelector("#toggleSwitch");
const statusEl = () => document.querySelector("#statusLabel");
const errorEl = () => document.querySelector("#error");
const readingLockNoticeEl = () => document.querySelector("#readingLockNotice");

function clickToggle(checked) {
  const toggle = toggleEl();
  toggle.checked = checked;
  toggle.dispatchEvent(new Event("change"));
}

describe("ReadTrail popup current-page activation (RT-005A)", () => {
  it("initializes an inactive page with no forced toggle", () => {
    const h = loadPopup();
    initPopup(h, HTTP_TAB, { ok: true, state: makeState(false) });

    expect(statusEl().textContent).toBe("Use on this page");
    expect(toggleEl().checked).toBe(false);
    expect(toggleEl().disabled).toBe(false);
    expect(readingLockNoticeEl().hidden).toBe(false);
    expect(readingLockNoticeEl().textContent).toContain("reserves primary clicks");
    expect(h.runtimeMsgs).toEqual([{ type: "getPageState", url: HTTP_TAB.url }]);
    // Never touches settings.enabled or chrome.storage.local.
    expect(globalThis.chrome.storage).toBeUndefined();
    expect(h.runtimeMsgs.some((m) => m.type === "getSettings" || m.type === "toggleEnabled")).toBe(false);
  });

  it("initializes an active page with the toggle on", () => {
    const h = loadPopup();
    initPopup(h, HTTP_TAB, { ok: true, state: makeState(true) });

    expect(statusEl().textContent).toBe("Active on this page");
    expect(toggleEl().checked).toBe(true);
    expect(toggleEl().disabled).toBe(false);
    expect(readingLockNoticeEl().hidden).toBe(true);
    expect(document.querySelector("#description").textContent).toContain("Reading lock is on");
  });

  it("reports unsupported pages and never reads page state", () => {
    const badTabs = [
      [HTTP_TAB.id, "about:blank"],
      [HTTP_TAB.id, "chrome://extensions"],
      [HTTP_TAB.id, undefined],
      [NaN, "https://example.com/x"]
    ];
    for (const [id, url] of badTabs) {
      const h = loadPopup();
      h.pending.query[0]([{ id, url }]);
      expect(h.runtimeMsgs).toEqual([]);
      expect(statusEl().textContent).toBe("Not supported on this page");
      expect(toggleEl().disabled).toBe(true);
    }

    // No tab at all.
    const none = loadPopup();
    none.pending.query[0]([]);
    expect(none.runtimeMsgs).toEqual([]);
    expect(statusEl().textContent).toBe("Not supported on this page");
  });

  it("disables and disables the toggle while loading", () => {
    const h = loadPopup();
    expect(statusEl().textContent).toBe("Loading…");
    expect(toggleEl().disabled).toBe(true);
    expect(h.pending.query).toHaveLength(1);
  });

  it("uses the exact tab URL and tab id for activation messaging", () => {
    const h = loadPopup();
    initPopup(h, HTTP_TAB, { ok: true, state: makeState(false) });

    clickToggle(true);
    expect(h.runtimeMsgs[1]).toEqual({ type: "setPageActive", url: HTTP_TAB.url, active: true });

    h.pending.runtime[1]({ ok: true, state: makeState(true) });
    expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      HTTP_TAB.id,
      expect.any(Object),
      expect.any(Function)
    );
    expect(h.tabMsgs[0]).toEqual({ type: "setPageActive", active: true, state: makeState(true) });

    h.pending.tab[0]({ ok: true });
    expect(statusEl().textContent).toBe("Active on this page");
    expect(toggleEl().checked).toBe(true);
  });

  it("keeps the toggle disabled while an enable transition is in flight", () => {
    const h = loadPopup();
    initPopup(h, HTTP_TAB, { ok: true, state: makeState(false) });

    clickToggle(true);
    expect(toggleEl().disabled).toBe(true);

    h.pending.runtime[1]({ ok: true, state: makeState(true) });
    expect(toggleEl().disabled).toBe(true);

    h.pending.tab[0]({ ok: true });
    expect(toggleEl().disabled).toBe(false);
  });

  it("rolls the service state back and shows an error when content delivery fails", () => {
    const h = loadPopup();
    initPopup(h, HTTP_TAB, { ok: true, state: makeState(false) });

    clickToggle(true);
    h.pending.runtime[1]({ ok: true, state: makeState(true) });
    // Content script is unavailable on delivery.
    h.pending.tab[0](null);

    // Service state is rolled back to inactive.
    expect(h.runtimeMsgs.some((m) => m.type === "setPageActive" && m.url === HTTP_TAB.url && m.active === false)).toBe(true);
    h.pending.runtime[2]({ ok: true, state: makeState(false) });

    expect(statusEl().textContent).toBe("Use on this page");
    expect(errorEl().hidden).toBe(false);
    expect(errorEl().textContent.length).toBeGreaterThan(0);
  });

  it("rolls back on an explicit content delivery failure too", () => {
    const h = loadPopup();
    initPopup(h, HTTP_TAB, { ok: true, state: makeState(false) });

    clickToggle(true);
    h.pending.runtime[1]({ ok: true, state: makeState(true) });
    h.pending.tab[0]({ ok: false, error: "no-receiver" });

    expect(h.runtimeMsgs.some((m) => m.type === "setPageActive" && m.active === false)).toBe(true);
    h.pending.runtime[2]({ ok: true, state: makeState(false) });
    expect(statusEl().textContent).toBe("Use on this page");
    expect(errorEl().hidden).toBe(false);
  });

  it("does not claim inactivity when activation rollback fails", () => {
    const h = loadPopup();
    initPopup(h, HTTP_TAB, { ok: true, state: makeState(false) });

    clickToggle(true);
    h.pending.runtime[1]({ ok: true, state: makeState(true) });
    h.pending.tab[0](null);
    h.pending.runtime[2]({ ok: false, error: "session-storage-error" });

    expect(statusEl().textContent).toBe("Something went wrong");
    expect(toggleEl().disabled).toBe(true);
    expect(errorEl().textContent).toContain("check the page state");
  });

  it("waits for the save-before-off acknowledgement before deactivating in the service", () => {
    const h = loadPopup();
    initPopup(h, HTTP_TAB, { ok: true, state: makeState(true) });

    clickToggle(false);
    // The content script is asked to save-and-acknowledge first.
    expect(h.tabMsgs[0]).toEqual({ type: "setPageActive", active: false });
    // The service worker deactivation must not have been sent yet.
    expect(h.runtimeMsgs.filter((m) => m.type === "setPageActive")).toEqual([]);

    h.pending.tab[0]({ ok: true });
    expect(h.runtimeMsgs.filter((m) => m.type === "setPageActive")).
      toEqual([{ type: "setPageActive", url: HTTP_TAB.url, active: false }]);

    h.pending.runtime[1]({ ok: true, state: makeState(false) });
    expect(statusEl().textContent).toBe("Use on this page");
    expect(toggleEl().checked).toBe(false);
    expect(toggleEl().disabled).toBe(false);
  });

  it("continues deactivating when the content script is unavailable", () => {
    const h = loadPopup();
    initPopup(h, HTTP_TAB, { ok: true, state: makeState(true) });

    clickToggle(false);
    // No content script: null response is safe to continue from.
    h.pending.tab[0](null);

    expect(h.runtimeMsgs.filter((m) => m.type === "setPageActive")).
      toEqual([{ type: "setPageActive", url: HTTP_TAB.url, active: false }]);
    h.pending.runtime[1]({ ok: true, state: makeState(false) });
    expect(statusEl().textContent).toBe("Use on this page");
    expect(errorEl().hidden).toBe(true);
  });

  it("keeps the page active and shows an error on an explicit content save failure", () => {
    const h = loadPopup();
    initPopup(h, HTTP_TAB, { ok: true, state: makeState(true) });

    clickToggle(false);
    h.pending.tab[0]({ ok: false, error: "save-failed" });

    // The page stays active and the service worker is never asked to deactivate.
    expect(h.runtimeMsgs.filter((m) => m.type === "setPageActive")).toEqual([]);
    expect(statusEl().textContent).toBe("Active on this page");
    expect(toggleEl().checked).toBe(true);
    expect(toggleEl().disabled).toBe(false);
    expect(errorEl().hidden).toBe(false);
  });

  it("reactivates the content when the service worker deactivation fails", () => {
    const h = loadPopup();
    initPopup(h, HTTP_TAB, { ok: true, state: makeState(true) });

    clickToggle(false);
    h.pending.tab[0]({ ok: true });
    h.pending.runtime[1]({ ok: false, error: "session-storage-error" });

    // It tries to reactivate the content with the previous state.
    expect(h.tabMsgs[1]).toEqual({ type: "setPageActive", active: true, state: makeState(true) });
    h.pending.tab[1]({ ok: true });

    expect(statusEl().textContent).toBe("Active on this page");
    expect(toggleEl().checked).toBe(true);
    expect(errorEl().hidden).toBe(false);
  });

  it("still reports the page active when reactivation delivery is unavailable", () => {
    const h = loadPopup();
    initPopup(h, HTTP_TAB, { ok: true, state: makeState(true) });

    clickToggle(false);
    h.pending.tab[0]({ ok: true });
    h.pending.runtime[1]({ ok: false, error: "session-storage-error" });
    h.pending.tab[1](null);

    expect(statusEl().textContent).toBe("Active on this page");
    expect(toggleEl().checked).toBe(true);
    expect(errorEl().textContent).toContain("Reload the page");
  });

  it("rejects malformed service-worker page state", () => {
    const h = loadPopup();
    initPopup(h, HTTP_TAB, { ok: true, state: { active: false, mode: "following", position: null } });

    expect(statusEl().textContent).toBe("Something went wrong");
    expect(toggleEl().disabled).toBe(true);
    expect(errorEl().hidden).toBe(false);
  });

  it("exposes accessible loading and error states", () => {
    const h = loadPopup();
    expect(document.querySelector("#activation").getAttribute("aria-live")).toBe("polite");
    expect(statusEl().textContent).toBe("Loading…");
    expect(toggleEl().disabled).toBe(true);

    // A failed state read resolves into an accessible error state.
    const h2 = loadPopup();
    h2.pending.query[0]([HTTP_TAB]);
    h2.pending.runtime[0]({ ok: false, error: "session-storage-unavailable" });
    expect(errorEl().getAttribute("role")).toBe("alert");
    expect(statusEl().textContent).toBe("Something went wrong");
    expect(toggleEl().disabled).toBe(true);
  });

  it("preserves the Open settings action", () => {
    const h = loadPopup();
    document.querySelector("#openOptions").click();
    expect(h.openOptions).toHaveBeenCalled();
  });
});
