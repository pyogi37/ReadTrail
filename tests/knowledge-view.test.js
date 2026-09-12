import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const readSource = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const html = readSource("sidepanel/sidepanel.html");
const constantsSrc = readSource("shared/constants.js");
const validatorsSrc = readSource("shared/validators.js");
const pageControlsSrc = readSource("shared/page-controls.js");
const searchIndexSrc = readSource("sidepanel/search-index.js");
const connectionsSrc = readSource("sidepanel/connections.js");
const exportImportSrc = readSource("sidepanel/export-import.js");
const knowledgeViewSrc = readSource("sidepanel/knowledge-view.js");
const pageViewSrc = readSource("sidepanel/page-view.js");
const libraryViewSrc = readSource("sidepanel/library-view.js");
const recentViewSrc = readSource("sidepanel/recent-view.js");
const sidepanelSrc = readSource("sidepanel/sidepanel.js");

// Every external <script src="..."></script> is stripped so the harness can
// eval the same sources itself, in the same order the manifest/HTML loads
// them (11 tags), against a mock chrome instead of the packaged files.
const strippedHtml = html.replace(/<script[^>]*src="[^"]+"[^>]*><\/script>\s*/g, "");

const makeState = (active, extra = {}) => ({ version: 1, active, mode: "following", position: null, ...extra });
const HTTP_TAB = { id: 7, url: "https://example.com/article", title: "An Article" };

// Loads sidepanel.html and evaluates the shell plus every view module with a
// deferring chrome mock. Every async callback (tabs.query, runtime.sendMessage,
// tabs.sendMessage) is captured so tests can drive and order the conversations
// exactly, keyed by message `type` (FIFO per type) since several views talk to
// chrome.runtime.sendMessage concurrently during init.
function loadSidePanel({ mode = "panel" } = {}) {
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
  window.eval(searchIndexSrc);
  window.eval(connectionsSrc);
  window.eval(exportImportSrc);
  window.eval(knowledgeViewSrc);
  window.eval(pageViewSrc);
  window.eval(libraryViewSrc);
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
    emitChanged: (...args) => registered.onChanged.forEach((handler) => handler(...args))
  };
}

// Resolves the active-tab query, the getTabInfo lookup, and (unless excluded)
// the getPageState + getSavedResumePoint reads, settling the page-view into a
// real state for a supported http(s) tab.
function initTab(h, tab, opts = {}) {
  const { excluded = false, stateResponse = { ok: true, state: makeState(false) }, savedResponse = { ok: true, record: null } } = opts;
  h.shiftQuery()([tab]);
  h.shiftType("getTabInfo")({ ok: true, supported: true, url: tab.url, title: tab.title || "", excluded });
  if (excluded) return;
  h.shiftType("getPageState")(stateResponse);
  if (h.pendingCount("getSavedResumePoint") > 0) {
    h.shiftType("getSavedResumePoint")(savedResponse);
  }
}

function clickToggle(checked) {
  const toggle = document.querySelector("#toggleSwitch");
  toggle.checked = checked;
  toggle.dispatchEvent(new Event("change"));
}

function libraryResponse({ saved = [], passages = [], notes = [], pagemeta = [] } = {}) {
  return {
    ok: true,
    saved,
    passages,
    notes,
    pagemeta,
    counts: { passages: passages.length, notes: notes.length, saved: saved.length },
    limit: 1500
  };
}
function setupLibrary(h, opts) {
  h.shiftType("listLibrary")(libraryResponse(opts));
}

const makePassage = (overrides = {}) => ({
  version: 1,
  id: "p1",
  url: "https://example.com/article-a",
  title: "An Article",
  text: "Some passage text",
  start: {},
  end: {},
  note: "",
  tags: [],
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides
});
const makeNote = (overrides = {}) => ({
  version: 1,
  id: "n1",
  url: "https://example.com/article-a",
  title: "An Article",
  text: "Some note text",
  tags: [],
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides
});

// --- Element getters ---
const statusEl = () => document.querySelector("#statusLabel");
const toggleEl = () => document.querySelector("#toggleSwitch");
const errorEl = () => document.querySelector("#error");
const pageActionsEl = () => document.querySelector("#pageActions");
const savePassageButtonEl = () => document.querySelector("#savePassageButton");
const addNoteButtonEl = () => document.querySelector("#addNoteButton");
const excludeSiteButtonEl = () => document.querySelector("#excludeSiteButton");
const noteFormEl = () => document.querySelector("#noteForm");
const noteInputEl = () => document.querySelector("#noteInput");
const pageStatusEl = () => document.querySelector("#pageStatus");

const knowledgeEmptyEl = () => document.querySelector("#knowledgeEmpty");
const libraryUsageEl = () => document.querySelector("#libraryUsage");
const librarySearchWrapEl = () => document.querySelector("#librarySearchWrap");
const librarySearchEl = () => document.querySelector("#librarySearch");
const knowledgeStatusEl = () => document.querySelector("#knowledgeStatus");
const searchResultsEl = () => document.querySelector("#searchResults");
const passageListEl = () => document.querySelector("#passageList");
const noteListEl = () => document.querySelector("#noteList");
const exportButtonEl = () => document.querySelector("#exportButton");
const clearKnowledgeButtonEl = () => document.querySelector("#clearKnowledgeButton");
const importInputEl = () => document.querySelector("#importInput");
const importReplaceEl = () => document.querySelector("#importReplace");
const pageTagsInputEl = () => document.querySelector("#pageTagsInput");
const pageTagsFormEl = () => document.querySelector("#pageTagsForm");

function findPassage(id) {
  return [...document.querySelectorAll(".passage-item")].find((li) => li.dataset.id === id);
}
function findNote(id) {
  return [...document.querySelectorAll(".note-item")].find((li) => li.dataset.id === id);
}
function findSavedItem(url) {
  return [...document.querySelectorAll(".saved-item")].find((li) => li.dataset.url === url);
}

async function flushAsync() {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

if (typeof globalThis.URL.createObjectURL !== "function") {
  globalThis.URL.createObjectURL = () => "blob:stub";
}
if (typeof globalThis.URL.revokeObjectURL !== "function") {
  globalThis.URL.revokeObjectURL = () => {};
}

describe("knowledge view rendering", () => {
  it("shows the empty state and hides the search box when the library has nothing", () => {
    const h = loadSidePanel();
    setupLibrary(h, {});
    expect(knowledgeEmptyEl().hidden).toBe(false);
    expect(librarySearchWrapEl().hidden).toBe(true);
  });

  it("shows the search box once the library has any content", () => {
    const h = loadSidePanel();
    setupLibrary(h, { passages: [makePassage()] });
    expect(librarySearchWrapEl().hidden).toBe(false);
  });

  it("shows usage as N of limit passages and notes used", () => {
    const h = loadSidePanel();
    setupLibrary(h, {
      passages: [makePassage({ id: "p1" }), makePassage({ id: "p2", url: "https://example.com/b" })],
      notes: [makeNote({ id: "n1" })]
    });
    expect(libraryUsageEl().textContent).toBe("3 of 1500 passages and notes used");
  });

  it("renders passage text as text, never as HTML", () => {
    const h = loadSidePanel();
    const evil = "<img src=x onerror=alert(1)>";
    setupLibrary(h, { passages: [makePassage({ id: "p1", text: evil })] });
    const li = findPassage("p1");
    expect(li.querySelector("img")).toBeNull();
    expect(li.querySelector(".passage-text").textContent).toBe(evil);
  });

  it("renders meta, note, own and page tag chips, and Open page/Remove buttons", () => {
    const h = loadSidePanel();
    const url = "https://example.com/article-a";
    setupLibrary(h, {
      passages: [makePassage({ id: "p1", url, title: "An Article", tags: ["own-tag"], note: "My note" })],
      pagemeta: [{ url, tags: ["own-tag", "page-tag"], updatedAt: 1 }]
    });
    const li = findPassage("p1");
    expect(li.querySelector(".item-meta").textContent).toBe("An Article · example.com");
    expect(li.querySelector(".passage-note").textContent).toBe("My note");
    const chips = [...li.querySelectorAll(".tag-chip")];
    expect(chips.some((c) => c.textContent === "own-tag" && !c.classList.contains("tag-chip-page"))).toBe(true);
    expect(chips.some((c) => c.textContent === "page-tag" && c.classList.contains("tag-chip-page"))).toBe(true);
    expect(li.querySelector(".btn-open-page").textContent).toBe("Open page");
    expect(li.querySelector(".btn-remove-item").textContent).toBe("Remove");
  });

  it("notes render their text and mark AI-drafted notes", () => {
    const h = loadSidePanel();
    setupLibrary(h, {
      notes: [
        makeNote({ id: "n1", text: "Human note" }),
        makeNote({ id: "n2", url: "https://example.com/b", title: "B", text: "Drafted", source: "ai" })
      ]
    });
    const n1 = findNote("n1");
    expect(n1.querySelector(".note-text").textContent).toBe("Human note");
    expect(n1.querySelector(".item-meta").textContent).not.toContain("AI draft");
    const n2 = findNote("n2");
    expect(n2.querySelector(".item-meta").textContent).toContain("AI draft");
  });
});

describe("knowledge view editing", () => {
  it("loads and saves tags for the current page", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB);
    setupLibrary(h, {
      pagemeta: [{ version: 1, url: HTTP_TAB.url, tags: ["research", "favorite"], updatedAt: 1 }]
    });
    expect(pageTagsInputEl().value).toBe("research, favorite");

    pageTagsInputEl().value = "later, reference";
    pageTagsFormEl().dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    expect(h.runtimeMsgs).toContainEqual({
      type: "setPageTags", url: HTTP_TAB.url, tags: ["later", "reference"]
    });

    h.shiftType("setPageTags")({ ok: true, tags: ["later", "reference"] });
    expect(h.pendingCount("listLibrary")).toBeGreaterThan(0);
  });

  it("clicking Add tags reveals the editor for a passage; submitting sends updatePassage and closes after reload", () => {
    const h = loadSidePanel();
    setupLibrary(h, { passages: [makePassage({ id: "p1", tags: [], note: "" })] });
    const before = findPassage("p1");
    const editBtn = before.querySelector(".btn-edit-tags");
    expect(editBtn.textContent).toBe("Add tags");
    expect(before.querySelector(".item-editor").hidden).toBe(true);
    editBtn.click();

    const li = findPassage("p1");
    expect(li.querySelector(".item-editor").hidden).toBe(false);
    li.querySelector(".tags-input").value = "alpha, beta ,gamma";
    li.querySelector(".note-input").value = "updated note";
    li.querySelector(".item-editor").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

    expect(h.runtimeMsgs).toContainEqual({
      type: "updatePassage",
      id: "p1",
      tags: ["alpha", "beta", "gamma"],
      note: "updated note"
    });

    h.shiftType("updatePassage")({ ok: true });
    expect(h.pendingCount("listLibrary")).toBeGreaterThan(0);
    setupLibrary(h, { passages: [makePassage({ id: "p1", tags: ["alpha", "beta", "gamma"], note: "updated note" })] });
    expect(findPassage("p1").querySelector(".item-editor").hidden).toBe(true);
  });

  it("clicking Edit tags reveals the editor for a note; submitting sends updateNote", () => {
    const h = loadSidePanel();
    setupLibrary(h, { notes: [makeNote({ id: "n1", tags: ["x"] })] });
    const before = findNote("n1");
    const editBtn = before.querySelector(".btn-edit-tags");
    expect(editBtn.textContent).toBe("Edit tags");
    editBtn.click();

    const li = findNote("n1");
    expect(li.querySelector(".item-editor").hidden).toBe(false);
    li.querySelector(".tags-input").value = "y, z";
    li.querySelector(".note-input").value = "Updated note text";
    li.querySelector(".item-editor").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

    expect(h.runtimeMsgs).toContainEqual({ type: "updateNote", id: "n1", tags: ["y", "z"], text: "Updated note text" });
  });

  it("Cancel closes the editor without sending a message", () => {
    const h = loadSidePanel();
    setupLibrary(h, { passages: [makePassage({ id: "p1" })] });
    findPassage("p1").querySelector(".btn-edit-tags").click();
    const li = findPassage("p1");
    li.querySelector(".item-editor .btn-ghost").click();

    expect(findPassage("p1").querySelector(".item-editor").hidden).toBe(true);
    expect(h.runtimeMsgs.some((m) => m.type === "updatePassage")).toBe(false);
  });

  it("shows an alert mentioning 4,000 characters when the update is rejected as invalid input", () => {
    const h = loadSidePanel();
    setupLibrary(h, { passages: [makePassage({ id: "p1" })] });
    findPassage("p1").querySelector(".btn-edit-tags").click();
    findPassage("p1").querySelector(".item-editor").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    h.shiftType("updatePassage")({ ok: false, error: "invalid-input" });

    expect(knowledgeStatusEl().hidden).toBe(false);
    expect(knowledgeStatusEl().getAttribute("role")).toBe("alert");
    expect(knowledgeStatusEl().textContent).toContain("4,000 characters");
  });
});

describe("knowledge view remove", () => {
  it("confirms and clears passages, notes, and page tags without clearing saved pages", () => {
    const h = loadSidePanel();
    setupLibrary(h, {
      saved: [{ url: HTTP_TAB.url, title: HTTP_TAB.title }],
      passages: [makePassage()],
      notes: [makeNote()],
      pagemeta: [{ version: 1, url: HTTP_TAB.url, tags: ["research"], updatedAt: 1 }]
    });
    vi.spyOn(globalThis, "confirm").mockReturnValue(true);

    clearKnowledgeButtonEl().click();
    expect(h.runtimeMsgs).toContainEqual({
      type: "clearLibrary", kinds: ["passages", "notes", "pagemeta"]
    });
    h.shiftType("clearLibrary")({ ok: true, removed: 3 });
    setupLibrary(h, { saved: [{ url: HTTP_TAB.url, title: HTTP_TAB.title }] });

    expect(knowledgeStatusEl().textContent).toContain("cleared");
    expect(clearKnowledgeButtonEl().disabled).toBe(true);
  });

  it("Remove sends removePassage and reloads the list on success", () => {
    const h = loadSidePanel();
    setupLibrary(h, { passages: [makePassage({ id: "p1" })] });
    findPassage("p1").querySelector(".btn-remove-item").click();
    expect(h.runtimeMsgs).toContainEqual({ type: "removePassage", id: "p1" });

    h.shiftType("removePassage")({ ok: true });
    expect(h.pendingCount("listLibrary")).toBeGreaterThan(0);
    setupLibrary(h, { passages: [] });
    expect(findPassage("p1")).toBeUndefined();
  });

  it("shows an alert status when removing a note fails", () => {
    const h = loadSidePanel();
    setupLibrary(h, { notes: [makeNote({ id: "n1" })] });
    findNote("n1").querySelector(".btn-remove-item").click();
    expect(h.runtimeMsgs).toContainEqual({ type: "removeNote", id: "n1" });

    h.shiftType("removeNote")({ ok: false });
    expect(knowledgeStatusEl().getAttribute("role")).toBe("alert");
    expect(knowledgeStatusEl().textContent).toContain("Could not remove");
    expect(findNote("n1")).toBeTruthy();
  });
});

describe("knowledge view search", () => {
  it("typing renders matches and hides the lists; a miss shows the empty message; clearing restores the lists", () => {
    const h = loadSidePanel();
    setupLibrary(h, {
      passages: [makePassage({ id: "p1", text: "Deep learning notes", tags: [] })],
      notes: [makeNote({ id: "n1", url: "https://example.com/b", title: "Other", text: "unrelated content" })]
    });

    librarySearchEl().value = "learning";
    librarySearchEl().dispatchEvent(new Event("input"));
    expect(searchResultsEl().hidden).toBe(false);
    expect(passageListEl().hidden).toBe(true);
    expect(noteListEl().hidden).toBe(true);
    expect(searchResultsEl().querySelector(".passage-item")).toBeTruthy();

    librarySearchEl().value = "zzzznomatch";
    librarySearchEl().dispatchEvent(new Event("input"));
    expect(searchResultsEl().textContent).toContain("No matches in your library.");

    librarySearchEl().value = "";
    librarySearchEl().dispatchEvent(new Event("input"));
    expect(searchResultsEl().hidden).toBe(true);
    expect(passageListEl().hidden).toBe(false);
  });

  it("search also matches saved pages", () => {
    const h = loadSidePanel();
    setupLibrary(h, { saved: [{ url: "https://example.com/zeta", title: "Zeta Guide", version: 1, position: {}, savedAt: 500 }] });

    librarySearchEl().value = "zeta";
    librarySearchEl().dispatchEvent(new Event("input"));
    const node = searchResultsEl().querySelector(".saved-result");
    expect(node).toBeTruthy();
    expect(node.textContent).toContain("Zeta Guide");
  });
});

describe("knowledge view connections", () => {
  it("two passages sharing a tag each show Related (1)", () => {
    const h = loadSidePanel();
    setupLibrary(h, {
      passages: [
        makePassage({ id: "p1", url: "https://a.example.com/1", tags: ["ai"] }),
        makePassage({ id: "p2", url: "https://b.example.com/2", tags: ["ai"] })
      ]
    });
    const details1 = findPassage("p1").querySelector("details.connections");
    expect(details1.querySelector("summary").textContent).toBe("Related (1)");
    const details2 = findPassage("p2").querySelector("details.connections");
    expect(details2.querySelector("summary").textContent).toBe("Related (1)");
  });

  it("an item with no relations has no connections block", () => {
    const h = loadSidePanel();
    setupLibrary(h, { passages: [makePassage({ id: "p1", tags: ["solo"] })] });
    expect(findPassage("p1").querySelector("details.connections")).toBeNull();
  });
});

describe("knowledge view export", () => {
  it("Export sends exportLibrary and downloads the payload on success", () => {
    const h = loadSidePanel();
    setupLibrary(h, {});
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    exportButtonEl().click();
    expect(h.runtimeMsgs).toContainEqual({ type: "exportLibrary" });
    h.shiftType("exportLibrary")({
      ok: true,
      payload: { format: "readtrail-export", version: 1, exportedAt: Date.now(), saved: [], passages: [], notes: [], pagemeta: [] }
    });

    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(knowledgeStatusEl().textContent).toContain("Exported");
    void revokeObjectURL;
  });

  it("shows an alert status when export fails", () => {
    const h = loadSidePanel();
    setupLibrary(h, {});
    exportButtonEl().click();
    h.shiftType("exportLibrary")({ ok: false });
    expect(knowledgeStatusEl().getAttribute("role")).toBe("alert");
    expect(knowledgeStatusEl().textContent).toContain("Export failed");
  });
});

describe("knowledge view import", () => {
  it("choosing a valid export file imports it (merge by default, replace when checked) and reports the result", async () => {
    const h = loadSidePanel();
    setupLibrary(h, {});
    const payload = { format: "readtrail-export", version: 1, exportedAt: 1, saved: [], passages: [], notes: [], pagemeta: [] };
    const file = new File([JSON.stringify(payload)], "export.json", { type: "application/json" });
    Object.defineProperty(importInputEl(), "files", { value: [file], configurable: true });
    importInputEl().dispatchEvent(new Event("change"));
    await flushAsync();

    expect(h.runtimeMsgs).toContainEqual({ type: "importLibrary", payload, mode: "merge" });
    h.shiftType("importLibrary")({ ok: true, imported: 2, skipped: 0, rejected: 1, mode: "merge" });
    expect(knowledgeStatusEl().textContent).toBe("Imported 2, skipped 0, rejected 1.");

    // Second file, with "Replace instead of merge" checked.
    importReplaceEl().checked = true;
    const file2 = new File([JSON.stringify(payload)], "export2.json", { type: "application/json" });
    Object.defineProperty(importInputEl(), "files", { value: [file2], configurable: true });
    importInputEl().dispatchEvent(new Event("change"));
    await flushAsync();
    expect(h.runtimeMsgs).toContainEqual({ type: "importLibrary", payload, mode: "replace" });
  });

  it("a non-JSON file shows an alert status and sends nothing", async () => {
    const h = loadSidePanel();
    setupLibrary(h, {});
    const file = new File(["not json {"], "bad.json", { type: "application/json" });
    Object.defineProperty(importInputEl(), "files", { value: [file], configurable: true });
    importInputEl().dispatchEvent(new Event("change"));
    await flushAsync();

    expect(h.runtimeMsgs.some((m) => m.type === "importLibrary")).toBe(false);
    expect(knowledgeStatusEl().getAttribute("role")).toBe("alert");
    expect(knowledgeStatusEl().textContent).toContain("could not be read as JSON");
  });
});

describe("page view: excluded sites and page actions", () => {
  it("shows Off for this site, disables the toggle, and hides page actions when getTabInfo reports excluded, without reading page state", () => {
    const h = loadSidePanel();
    h.shiftQuery()([HTTP_TAB]);
    h.shiftType("getTabInfo")({ ok: true, supported: true, excluded: true, url: HTTP_TAB.url, title: HTTP_TAB.title });

    expect(statusEl().textContent).toBe("Off for this site");
    expect(toggleEl().disabled).toBe(true);
    expect(pageActionsEl().hidden).toBe(true);
    expect(h.pendingCount("getPageState")).toBe(0);
  });

  it("becomes excluded when the worker rejects setPageActive with site-excluded", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { stateResponse: { ok: true, state: makeState(false) } });
    clickToggle(true);
    h.shiftType("setPageActive")({ ok: false, error: "site-excluded" });
    expect(statusEl().textContent).toBe("Off for this site");
  });

  it("shows page actions for both inactive and active supported pages", () => {
    const h1 = loadSidePanel();
    initTab(h1, HTTP_TAB, { stateResponse: { ok: true, state: makeState(false) } });
    expect(pageActionsEl().hidden).toBe(false);

    const h2 = loadSidePanel();
    initTab(h2, HTTP_TAB, { stateResponse: { ok: true, state: makeState(true) } });
    expect(pageActionsEl().hidden).toBe(false);
  });
});

describe("page view: passages, notes, exclusion", () => {
  it("Save selection captures the passage then saves it, showing a success status", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { stateResponse: { ok: true, state: makeState(true) } });
    savePassageButtonEl().click();

    expect(h.tabMsgs[h.tabMsgs.length - 1]).toEqual({ type: "capturePassage" });
    h.shiftTab()({ ok: true, text: "Selected text", start: { a: 1 }, end: { b: 2 }, url: HTTP_TAB.url, title: HTTP_TAB.title });

    expect(h.runtimeMsgs).toContainEqual({
      type: "savePassage",
      url: HTTP_TAB.url,
      title: HTTP_TAB.title,
      text: "Selected text",
      start: { a: 1 },
      end: { b: 2 }
    });
    h.shiftType("savePassage")({ ok: true, passage: {} });
    expect(pageStatusEl().hidden).toBe(false);
    expect(pageStatusEl().textContent).toBe("Passage saved to your library.");
  });

  it("shows the no-selection error when nothing is selected on the page", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { stateResponse: { ok: true, state: makeState(true) } });
    savePassageButtonEl().click();
    h.shiftTab()({ ok: false, error: "no-selection" });

    expect(errorEl().hidden).toBe(false);
    expect(errorEl().textContent).toBe("Select some text on the page first.");
  });

  it("Add a note reveals the form; submitting empty text shows a validation error", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { stateResponse: { ok: true, state: makeState(true) } });
    expect(noteFormEl().hidden).toBe(true);
    addNoteButtonEl().click();
    expect(noteFormEl().hidden).toBe(false);

    noteFormEl().dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    expect(errorEl().textContent).toBe("Write something first.");
    expect(h.runtimeMsgs.some((m) => m.type === "saveNote")).toBe(false);
  });

  it("submitting note text sends saveNote and clears/hides the form on success", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { stateResponse: { ok: true, state: makeState(true) } });
    addNoteButtonEl().click();
    noteInputEl().value = "What I learned";
    noteFormEl().dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

    expect(h.runtimeMsgs).toContainEqual({ type: "saveNote", url: HTTP_TAB.url, title: HTTP_TAB.title, text: "What I learned" });
    h.shiftType("saveNote")({ ok: true, note: {} });

    expect(noteFormEl().hidden).toBe(true);
    expect(noteInputEl().value).toBe("");
    expect(pageStatusEl().textContent).toBe("Note saved to your library.");
  });

  it("Exclude this site fetches settings then updates excludedHosts and shows the excluded state", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { stateResponse: { ok: true, state: makeState(false) } });
    excludeSiteButtonEl().click();

    expect(h.runtimeMsgs).toContainEqual({ type: "getSettings" });
    h.shiftType("getSettings")({ excludedHosts: [] });
    expect(h.runtimeMsgs).toContainEqual({ type: "setSettings", settings: { excludedHosts: ["example.com"] } });
    h.shiftType("setSettings")({ ok: true });

    expect(statusEl().textContent).toBe("Off for this site");
    expect(h.pendingCount("getPageState")).toBe(0);
  });

  it("Exclude this site turns the page off first when it was active", () => {
    const h = loadSidePanel();
    initTab(h, HTTP_TAB, { stateResponse: { ok: true, state: makeState(true) } });
    excludeSiteButtonEl().click();
    h.shiftType("getSettings")({ excludedHosts: [] });
    h.shiftType("setSettings")({ ok: true });

    expect(h.tabMsgs[h.tabMsgs.length - 1]).toEqual({ type: "setPageActive", active: false });
    h.shiftTab()({ ok: true });
    expect(h.runtimeMsgs[h.runtimeMsgs.length - 1]).toEqual({
      type: "setPageActive",
      tabId: HTTP_TAB.id,
      url: HTTP_TAB.url,
      active: false
    });
    h.shiftType("setPageActive")({ ok: true, state: makeState(false) });

    expect(statusEl().textContent).toBe("Off for this site");
  });
});

describe("library view: remove with knowledge counts", () => {
  it("shows the passage/note count and a Remove-page-and-N-notes button when the page has library data", () => {
    const h = loadSidePanel();
    const url = "https://example.com/article-a";
    setupLibrary(h, {
      passages: [makePassage({ id: "p1", url })],
      notes: [makeNote({ id: "n1", url }), makeNote({ id: "n2", url })]
    });
    h.shiftType("listSavedResumePoints")({ ok: true, items: [{ url, version: 1, title: "An article", position: {}, savedAt: 100 }] });

    findSavedItem(url).querySelector(".btn-remove").click();
    const li = findSavedItem(url);
    expect(li.querySelector(".confirm-text").textContent).toContain("3");
    expect(li.querySelector(".btn-remove-all").textContent).toBe("Remove page and 3 notes");
  });

  it("Remove page and N notes removes the saved point then the page's passages and notes", () => {
    const h = loadSidePanel();
    const url = "https://example.com/article-a";
    setupLibrary(h, { passages: [makePassage({ id: "p1", url })], notes: [makeNote({ id: "n1", url })] });
    h.shiftType("listSavedResumePoints")({ ok: true, items: [{ url, version: 1, title: "An article", position: {}, savedAt: 100 }] });

    findSavedItem(url).querySelector(".btn-remove").click();
    findSavedItem(url).querySelector(".btn-remove-all").click();

    expect(h.runtimeMsgs).toContainEqual({ type: "removeSavedResumePoint", url });
    expect(h.runtimeMsgs.some((m) => m.type === "removePageData")).toBe(false);
    h.shiftType("removeSavedResumePoint")({ ok: true });
    expect(h.runtimeMsgs).toContainEqual({ type: "removePageData", url });
  });

  it("the plain Remove button sends only removeSavedResumePoint, never removePageData", () => {
    const h = loadSidePanel();
    const url = "https://example.com/article-b";
    setupLibrary(h, {});
    h.shiftType("listSavedResumePoints")({ ok: true, items: [{ url, version: 1, title: "B", position: {}, savedAt: 50 }] });

    findSavedItem(url).querySelector(".btn-remove").click();
    const li = findSavedItem(url);
    expect(li.querySelector(".btn-remove-all")).toBeNull();
    li.querySelector(".item-confirm .btn-danger-solid").click();

    expect(h.runtimeMsgs).toContainEqual({ type: "removeSavedResumePoint", url });
    h.shiftType("removeSavedResumePoint")({ ok: true });
    expect(h.runtimeMsgs.some((m) => m.type === "removePageData")).toBe(false);
  });
});

describe("side panel shell: knowledge debounce and settings resync", () => {
  it("debounces storage changes into a single listLibrary reload after 150ms, coalescing bursts", () => {
    vi.useFakeTimers();
    try {
      const h = loadSidePanel();
      h.shiftType("listLibrary")(libraryResponse({}));
      const before = h.pendingCount("listLibrary");

      h.emitChanged({ [h.KEYS.PASSAGE_PREFIX + "a"]: { newValue: {} } }, "local");
      expect(h.pendingCount("listLibrary")).toBe(before);
      vi.advanceTimersByTime(100);
      // A second change within the window resets the debounce timer.
      h.emitChanged({ [h.KEYS.NOTE_PREFIX + "b"]: { newValue: {} } }, "local");
      vi.advanceTimersByTime(100);
      expect(h.pendingCount("listLibrary")).toBe(before);
      vi.advanceTimersByTime(50);
      expect(h.pendingCount("listLibrary")).toBe(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a settings change triggers a new tabs.query to re-sync the tracked tab", () => {
    const h = loadSidePanel();
    const before = h.pending.query.length;
    h.emitChanged({ settings: { newValue: {} } }, "local");
    expect(h.pending.query.length).toBe(before + 1);
  });
});
