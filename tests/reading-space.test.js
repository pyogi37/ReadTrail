import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const html = fs.readFileSync(path.join(root, "reading-space/reading-space.html"), "utf8");
const script = fs.readFileSync(path.join(root, "reading-space/reading-space.js"), "utf8");

const URL_A = "https://example.com/article-a";
const URL_B = "https://example.com/article-b";

// A valid saved item matching the service-worker list contract subset the
// Reading Space renders (url, title, savedAt).
const makeItem = (url, title, savedAt) => ({
  url,
  version: 1,
  title,
  position: {},
  savedAt
});

function loadSpace() {
  document.open();
  document.write(html.replace('<script src="reading-space.js"></script>', ""));
  document.close();

  const pending = [];
  const runtimeMsgs = [];

  globalThis.chrome = {
    runtime: {
      lastError: null,
      sendMessage: (msg, cb) => {
        runtimeMsgs.push(msg);
        pending.push(cb);
      }
    }
  };

  window.eval(script);
  return { pending, runtimeMsgs };
}

// Resolves the initial listSavedResumePoints load with the given items response.
function initSpace(h, itemsResponse) {
  h.pending[0](itemsResponse);
}

const loadingStateEl = () => document.querySelector("#loadingState");
const emptyStateEl = () => document.querySelector("#emptyState");
const loadErrorStateEl = () => document.querySelector("#loadErrorState");
const savedListEl = () => document.querySelector("#savedList");
const clearAllButtonEl = () => document.querySelector("#clearAllButton");
const clearConfirmEl = () => document.querySelector("#clearConfirm");
const clearConfirmYesEl = () => document.querySelector("#clearConfirmYes");
const clearConfirmCancelEl = () => document.querySelector("#clearConfirmCancel");
const statusMessageEl = () => document.querySelector("#statusMessage");
const errorMessageEl = () => document.querySelector("#errorMessage");

function listItems() {
  return [...document.querySelectorAll(".saved-item")];
}

function findItem(url) {
  return listItems().find((li) => li.dataset.url === url);
}

function buttonsFor(url) {
  const li = findItem(url);
  return {
    li,
    continue: li.querySelector(".btn-continue"),
    remove: li.querySelector(".btn-remove"),
    confirmYes: li.querySelector(".item-confirm .btn-danger-solid"),
    confirmRow: li.querySelector(".item-confirm"),
    status: li.querySelector(".item-status")
  };
}

const okList = (items = []) => ({ ok: true, items });

describe("ReadTrail Reading Space (RT-205)", () => {
  it("shows a loading state before the saved pages are read and disables Clear all", () => {
    const h = loadSpace();
    expect(loadingStateEl().hidden).toBe(false);
    expect(savedListEl().hidden).toBe(true);
    expect(emptyStateEl().hidden).toBe(true);
    expect(clearAllButtonEl().disabled).toBe(true);
    expect(h.runtimeMsgs).toEqual([{ type: "listSavedResumePoints" }]);
  });

  it("loads and renders saved pages with the enforced empty state when there are none", () => {
    const h = loadSpace();
    initSpace(h, okList([]));

    expect(emptyStateEl().hidden).toBe(false);
    expect(savedListEl().hidden).toBe(true);
    expect(loadingStateEl().hidden).toBe(true);
    expect(clearAllButtonEl().disabled).toBe(true);
    expect(listItems()).toEqual([]);
  });

  it("renders each item with title, derived domain, saved time, Continue and Remove", () => {
    const h = loadSpace();
    const savedAt = Date.UTC(2026, 0, 5, 12, 30);
    initSpace(h, okList([makeItem(URL_A, "An article", savedAt)]));

    const b = buttonsFor(URL_A);
    expect(b.li).toBeTruthy();
    expect(b.li.textContent).toContain("An article");
    expect(b.li.textContent).toContain("example.com");
    expect(b.li.textContent).toContain("2026");
    expect(b.continue.textContent).toBe("Continue reading");
    expect(b.remove.textContent).toBe("Remove");
    expect(clearAllButtonEl().disabled).toBe(false);
  });

  it("renders titles and domains safely without injecting URLs as HTML", () => {
    const h = loadSpace();
    const evil = '<img src=x onerror="globalThis.__pwned = true">';
    initSpace(h, okList([makeItem(URL_A, evil + " Title", 1000)]));

    const li = findItem(URL_A);
    // Title must appear as literal text, not as a rendered element.
    expect(li.querySelector("img")).toBeNull();
    expect(li.textContent).toContain(evil);
    expect(globalThis.__pwned).toBeUndefined();
  });

  it("sorts newest saved first even when the response is unordered", () => {
    const h = loadSpace();
    initSpace(h, okList([
      makeItem(URL_B, "Older B", 100),
      makeItem(URL_A, "Newer A", 999)
    ]));

    const urls = listItems().map((li) => li.dataset.url);
    expect(urls).toEqual([URL_A, URL_B]);
  });

  it("ignores malformed items safely while keeping valid ones", () => {
    const h = loadSpace();
    initSpace(h, okList([
      makeItem(URL_A, "Valid A", 100),
      { url: URL_B }, // missing title/savedAt
      "not-an-object",
      null,
      { url: "https://[broken", title: "Bad", savedAt: 200 },
      { url: "https://example.com/c", title: "  Padded Title  ", savedAt: 300 }
    ]));

    const urls = listItems().map((li) => li.dataset.url);
    // The valid item and the padded-title item (trimmed) are kept; malformed
    // and bad-URL entries are dropped. Newest (higher savedAt) is listed first.
    expect(urls).toEqual(["https://example.com/c", URL_A]);
    expect(findItem("https://example.com/c").textContent).toContain("Padded Title");
  });

  it("shows a clear error state when listing fails", () => {
    const h = loadSpace();
    initSpace(h, null); // messaging/receiver failure
    expect(loadErrorStateEl().hidden).toBe(false);
    expect(savedListEl().hidden).toBe(true);
    expect(emptyStateEl().hidden).toBe(true);
  });

  it("continues reading by asking the service worker and never navigates itself", () => {
    const h = loadSpace();
    initSpace(h, okList([makeItem(URL_A, "An article", 100)]));

    expect(globalThis.chrome.tabs).toBeUndefined();

    buttonsFor(URL_A).continue.click();
    expect(h.runtimeMsgs[1]).toEqual({ type: "continueSavedResumePoint", url: URL_A });

    h.pending[1]({ ok: true, tabId: 5 });
    expect(buttonsFor(URL_A).status.textContent).toContain("Opened in a new tab");
    expect(findItem(URL_A)).toBeTruthy(); // item retained
  });

  it("guards the continue request while it is in flight", () => {
    const h = loadSpace();
    initSpace(h, okList([makeItem(URL_A, "An article", 100)]));

    buttonsFor(URL_A).continue.click();
    buttonsFor(URL_A).continue.click();

    expect(h.runtimeMsgs.filter((m) => m.type === "continueSavedResumePoint")).toHaveLength(1);
    const inFlight = buttonsFor(URL_A);
    expect(inFlight.continue.disabled).toBe(true);
    expect(inFlight.remove.disabled).toBe(true);
    expect(inFlight.continue.textContent).toBe("Opening…");

    h.pending[1]({ ok: true, tabId: 5 });
    expect(buttonsFor(URL_A).continue.disabled).toBe(false);
    expect(buttonsFor(URL_A).remove.disabled).toBe(false);
  });

  it("reflects continue failures visibly without deleting the saved item", () => {
    const h = loadSpace();
    initSpace(h, okList([makeItem(URL_A, "An article", 100)]));

    buttonsFor(URL_A).continue.click();
    h.pending[1]({ ok: false, error: "no-saved-record" });

    expect(buttonsFor(URL_A).status.getAttribute("role")).toBe("alert");
    expect(buttonsFor(URL_A).status.textContent).toContain("Could not open");
    expect(findItem(URL_A)).toBeTruthy();
  });

  it("requires a deliberate confirmation before it removes an item", () => {
    const h = loadSpace();
    initSpace(h, okList([makeItem(URL_A, "An article", 100)]));

    buttonsFor(URL_A).remove.click();
    // No removal message until the inline confirmation is confirmed.
    expect(h.runtimeMsgs.filter((m) => m.type === "removeSavedResumePoint")).toHaveLength(0);
    expect(buttonsFor(URL_A).confirmRow.hidden).toBe(false);

    buttonsFor(URL_A).confirmYes.click();
    expect(h.runtimeMsgs[1]).toEqual({ type: "removeSavedResumePoint", url: URL_A });
  });

  it("removes an item and reloads from the service worker only after success", () => {
    const h = loadSpace();
    initSpace(h, okList([
      makeItem(URL_A, "An article", 100),
      makeItem(URL_B, "Another", 200)
    ]));

    buttonsFor(URL_A).remove.click();
    buttonsFor(URL_A).confirmYes.click();

    // Success triggers a silent reload (a fresh listSavedResumePoints).
    h.pending[1]({ ok: true });
    expect(h.runtimeMsgs[2]).toEqual({ type: "listSavedResumePoints" });
    h.pending[2](okList([makeItem(URL_B, "Another", 200)]));

    expect(findItem(URL_A)).toBeUndefined();
    expect(findItem(URL_B)).toBeTruthy();
  });

  it("cancels item removal without sending a message", () => {
    const h = loadSpace();
    initSpace(h, okList([makeItem(URL_A, "An article", 100)]));

    buttonsFor(URL_A).remove.click();
    buttonsFor(URL_A).confirmRow.querySelector(".btn-ghost").click();

    expect(buttonsFor(URL_A).confirmRow.hidden).toBe(true);
    expect(h.runtimeMsgs.filter((m) => m.type === "removeSavedResumePoint")).toHaveLength(0);
    expect(findItem(URL_A)).toBeTruthy();
  });

  it("keeps the item and shows an error when removal fails", () => {
    const h = loadSpace();
    initSpace(h, okList([makeItem(URL_A, "An article", 100)]));

    buttonsFor(URL_A).remove.click();
    buttonsFor(URL_A).confirmYes.click();
    h.pending[1]({ ok: false, error: "remove-storage-error" });

    const b = buttonsFor(URL_A);
    expect(findItem(URL_A)).toBeTruthy();
    expect(b.status.getAttribute("role")).toBe("alert");
    expect(b.status.textContent).toContain("Could not remove");
  });

  it("requires explicit confirmation before clearing all", () => {
    const h = loadSpace();
    initSpace(h, okList([makeItem(URL_A, "An article", 100)]));

    clearAllButtonEl().click();
    expect(clearConfirmEl().hidden).toBe(false);
    expect(h.runtimeMsgs.filter((m) => m.type === "clearSavedResumePoints")).toHaveLength(0);
  });

  it("cancels clear-all without sending a message", () => {
    const h = loadSpace();
    initSpace(h, okList([makeItem(URL_A, "An article", 100)]));

    clearAllButtonEl().click();
    clearConfirmCancelEl().click();

    expect(clearConfirmEl().hidden).toBe(true);
    expect(h.runtimeMsgs.filter((m) => m.type === "clearSavedResumePoints")).toHaveLength(0);
    expect(findItem(URL_A)).toBeTruthy();
  });

  it("clears all and reloads only after success", () => {
    const h = loadSpace();
    initSpace(h, okList([makeItem(URL_A, "An article", 100)]));

    clearAllButtonEl().click();
    clearConfirmYesEl().click();
    expect(h.runtimeMsgs[1]).toEqual({ type: "clearSavedResumePoints" });

    h.pending[1]({ ok: true });
    // Confirmed success triggers a silent reload and an announcement.
    expect(h.runtimeMsgs[2]).toEqual({ type: "listSavedResumePoints" });
    expect(statusMessageEl().textContent).toContain("removed");
    h.pending[2](okList([]));

    expect(emptyStateEl().hidden).toBe(false);
    expect(listItems()).toEqual([]);
  });

  it("shows an error and keeps items when clear-all fails", () => {
    const h = loadSpace();
    initSpace(h, okList([makeItem(URL_A, "An article", 100)]));

    clearAllButtonEl().click();
    clearConfirmYesEl().click();
    h.pending[1]({ ok: false, error: "clear-storage-error" });

    expect(errorMessageEl().textContent).toContain("Could not clear");
    expect(clearConfirmEl().hidden).toBe(true);
    expect(findItem(URL_A)).toBeTruthy();
  });
});
