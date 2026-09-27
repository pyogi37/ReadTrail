import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadServiceWorker, senders } from "./helpers/chrome-mock.js";

const PAGE = senders.page("sidepanel/sidepanel.html");
// The panel names the tab a save came from so the worker can refuse an
// incognito one. Tests that are not about that guard get this tab by default.
const PAGE_TAB = 11;
const MISSING_ID = "11111111-2222-4333-8444-555555555555";
const URL_A = "https://example.com/article-a";
const URL_B = "https://news.example.org/story";
const ID = /^[0-9a-f-]{36}$/;

function anchor(path = [0, 1], offset = 2) {
  return { version: 1, path, offset };
}

function load(options = {}) {
  return loadServiceWorker({ tabs: [{ id: PAGE_TAB, url: URL_A, incognito: false }], ...options });
}

const NEEDS_TAB = ["savePassage", "saveNote"];

function call(h, msg, sender = PAGE) {
  // Supply the default tab unless the test is exercising the guard itself.
  if (sender === PAGE && NEEDS_TAB.includes(msg.type) && !("tabId" in msg)) {
    msg = { ...msg, tabId: PAGE_TAB };
  }
  const done = vi.fn();
  expect(h.messageHandler(msg, sender, done)).toBe(true);
  expect(done).toHaveBeenCalledTimes(1);
  return done.mock.calls[0][0];
}

describe("knowledge layer: passages", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("saves a passage from the side panel with normalized tags and returns the record", () => {
    const h = load();
    const res = call(h, {
      type: "savePassage", url: URL_A, title: "  Article A ", text: "  A key sentence.  ",
      start: anchor(), end: anchor([0, 1], 10), tags: ["Ideas", " ideas", "Reading "]
    });
    expect(res.ok).toBe(true);
    expect(res.passage).toEqual(expect.objectContaining({
      version: 1, url: URL_A, title: "Article A", text: "A key sentence.", note: "", tags: ["ideas", "reading"]
    }));
    expect(res.passage.id).toMatch(ID);
    expect(h.localData[`readtrail.passage.v1:${res.passage.id}`]).toEqual(res.passage);
  });

  it("uses the content script's tab URL, refuses incognito, and rejects bad input", () => {
    const h = load();
    const fromContent = call(h, { type: "savePassage", url: "https://evil.example/", text: "hello" }, senders.content(3, URL_B));
    expect(fromContent.ok).toBe(true);
    expect(fromContent.passage.url).toBe(URL_B);

    const incognito = call(h, { type: "savePassage", text: "hello" }, senders.content(3, URL_B, { incognito: true }));
    expect(incognito).toEqual({ ok: false, error: "invalid-sender" });

    for (const bad of [
      { type: "savePassage", url: URL_A, text: "   " },
      { type: "savePassage", url: "chrome://x", text: "hi" },
      { type: "savePassage", url: URL_A, text: "x".repeat(4001) },
      { type: "savePassage", url: URL_A, text: "hi", tags: ["a".repeat(41)] },
      { type: "savePassage", url: URL_A, text: "hi", tags: "ideas" },
      { type: "savePassage", url: URL_A, text: "hi", start: { version: 9 } },
      { type: "savePassage", url: URL_A, text: "hi", start: anchor(new Array(65).fill(0)) },
      { type: "savePassage", url: URL_A, text: "hi", end: anchor([0], 1000001) }
    ]) {
      expect(call(h, bad)).toEqual({ ok: false, error: "invalid-input" });
    }
    expect(Object.keys(h.localData).filter((k) => k.startsWith("readtrail.passage"))).toHaveLength(1);
  });

  it("takes the URL from the message when the extension page is itself open in a tab", () => {
    const h = load();
    // An extension page open in a tab has a sender.tab, but it is the panel's
    // own tab, not the page being saved, so it still names the content tab.
    const pageInTab = { ...PAGE, tab: { id: 9, url: "chrome-extension://test/sidepanel/sidepanel.html?mode=page", incognito: false } };
    const res = call(h, { type: "savePassage", url: URL_A, text: "from page mode", tabId: PAGE_TAB }, pageInTab);
    expect(res.ok).toBe(true);
    expect(res.passage.url).toBe(URL_A);
  });

  // The incognito guard inside the handler only ever saw a content script's
  // sender. The panel's Save selection sends from an extension page, so the
  // primary way to clip was never checked at all, and a page read in an
  // incognito window could leave a durable record of its text.
  it("refuses a save from a panel that names an incognito tab, a dead tab, or no tab", () => {
    const h = load({ tabs: [
      { id: PAGE_TAB, url: URL_A, incognito: false },
      { id: 12, url: URL_A, incognito: true }
    ] });

    const secret = { type: "savePassage", url: URL_A, text: "Read in a private window." };
    expect(call(h, { ...secret, tabId: 12 })).toEqual({ ok: false, error: "invalid-sender" });
    expect(call(h, { ...secret, tabId: 999 })).toEqual({ ok: false, error: "invalid-sender" });
    expect(call(h, { ...secret, tabId: undefined })).toEqual({ ok: false, error: "invalid-sender" });
    expect(call(h, { ...secret, tabId: "11" })).toEqual({ ok: false, error: "invalid-sender" });
    // Nothing reached storage on any of those paths.
    expect(Object.keys(h.localData).filter((key) => key.startsWith("readtrail.passage.v1"))).toHaveLength(0);

    // The same clip from the same panel naming a normal tab is kept.
    expect(call(h, { ...secret, tabId: PAGE_TAB }).ok).toBe(true);

    // Notes carry the reader's own words about a page and are guarded alike.
    const note = { type: "saveNote", url: URL_A, title: "A", text: "A private thought." };
    expect(call(h, { ...note, tabId: 12 })).toEqual({ ok: false, error: "invalid-sender" });
    expect(call(h, { ...note, tabId: undefined })).toEqual({ ok: false, error: "invalid-sender" });
    expect(call(h, { ...note, tabId: PAGE_TAB }).ok).toBe(true);
  });

  it("lets the library tag a page that is open in no tab, but not an incognito one", () => {
    const h = load({ tabs: [
      { id: PAGE_TAB, url: URL_A, incognito: false },
      { id: 12, url: URL_A, incognito: true }
    ] });

    // Tagging from the library names no tab: the page need not be open at all.
    expect(call(h, { type: "setPageTags", url: URL_B, tags: ["later"] }).ok).toBe(true);
    expect(h.localData[`readtrail.pagemeta.v1:${URL_B}`].tags).toEqual(["later"]);

    // Tagging the tab the reader is on does name it, and an incognito tab is
    // refused even though tags carry no page text.
    expect(call(h, { type: "setPageTags", tabId: PAGE_TAB, url: URL_A, tags: ["reading"] }).ok).toBe(true);
    expect(call(h, { type: "setPageTags", tabId: 12, url: URL_A, tags: ["private"] }))
      .toEqual({ ok: false, error: "invalid-sender" });
    expect(h.localData[`readtrail.pagemeta.v1:${URL_A}`].tags).toEqual(["reading"]);
  });

  it("updates note and tags, rejects unknown ids, and removes", () => {
    const h = load();
    const { passage } = call(h, { type: "savePassage", url: URL_A, text: "Sentence" });
    const updated = call(h, { type: "updatePassage", id: passage.id, note: " Why it matters ", tags: ["Later"] });
    expect(updated.ok).toBe(true);
    expect(updated.passage.note).toBe("Why it matters");
    expect(updated.passage.tags).toEqual(["later"]);
    expect(updated.passage.updatedAt).toBeGreaterThanOrEqual(passage.updatedAt);

    expect(call(h, { type: "updatePassage", id: "00000000-0000-4000-8000-000000000000", note: "x" }))
      .toEqual({ ok: false, error: "not-found" });
    expect(call(h, { type: "updatePassage", id: "nope", note: "x" })).toEqual({ ok: false, error: "invalid-input" });

    expect(call(h, { type: "removePassage", id: passage.id })).toEqual({ ok: true });
    expect(h.localData[`readtrail.passage.v1:${passage.id}`]).toBeUndefined();
  });

  it("lists passages newest first, optionally filtered by page, ignoring malformed records", () => {
    const h = load();
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const first = call(h, { type: "savePassage", url: URL_A, text: "first" }).passage;
    vi.setSystemTime(2000);
    const second = call(h, { type: "savePassage", url: URL_B, text: "second" }).passage;
    h.localData["readtrail.passage.v1:bogus"] = { version: 1, id: "bogus", text: "x" };
    h.localData[`readtrail.passage.v1:${first.id}`].extra = "dropped";

    const all = call(h, { type: "listPassages" });
    expect(all.passages.map((p) => p.id)).toEqual([second.id, first.id]);
    expect(all.passages[1]).not.toHaveProperty("extra");
    expect(call(h, { type: "listPassages", url: URL_A }).passages.map((p) => p.id)).toEqual([first.id]);
    vi.useRealTimers();
  });

  it("refuses new entries once the library is full", () => {
    const h = load();
    for (let i = 0; i < 1500; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      h.localData[`readtrail.passage.v1:${id}`] = {
        version: 1, id, url: URL_A, title: "", text: `p${i}`, start: null, end: null, note: "", tags: [], createdAt: 1, updatedAt: 1
      };
    }
    expect(call(h, { type: "savePassage", url: URL_A, text: "one more" })).toEqual({ ok: false, error: "library-full" });
    expect(call(h, { type: "saveNote", url: URL_A, text: "one more" })).toEqual({ ok: false, error: "library-full" });
  });
});

describe("knowledge layer: notes and page tags", () => {
  it("saves, updates, lists, and removes notes", () => {
    const h = load();
    const { note } = call(h, { type: "saveNote", url: URL_A, title: "A", text: "Remember this", tags: ["X"] });
    expect(note).toEqual(expect.objectContaining({ url: URL_A, text: "Remember this", tags: ["x"] }));
    expect(note).not.toHaveProperty("source");

    const ai = call(h, { type: "saveNote", url: URL_A, text: "Summary", source: "ai" }).note;
    expect(ai.source).toBe("ai");

    const updated = call(h, { type: "updateNote", id: note.id, text: "Changed", tags: [] });
    expect(updated.note).toEqual(expect.objectContaining({ text: "Changed", tags: [] }));
    expect(call(h, { type: "updateNote", id: note.id, text: "" })).toEqual({ ok: false, error: "invalid-input" });

    expect(call(h, { type: "listNotes", url: URL_A }).notes).toHaveLength(2);
    expect(call(h, { type: "removeNote", id: note.id })).toEqual({ ok: true });
    expect(call(h, { type: "listNotes" }).notes.map((n) => n.id)).toEqual([ai.id]);
  });

  it("stores page tags per URL and removes the record when emptied", () => {
    const h = load();
    expect(call(h, { type: "setPageTags", url: URL_A, tags: ["Deep Work", "focus"] })).toEqual({ ok: true, tags: ["deep work", "focus"] });
    expect(h.localData[`readtrail.pagemeta.v1:${URL_A}`].tags).toEqual(["deep work", "focus"]);
    expect(call(h, { type: "setPageTags", url: URL_A, tags: [] })).toEqual({ ok: true, tags: [] });
    expect(h.localData[`readtrail.pagemeta.v1:${URL_A}`]).toBeUndefined();
    expect(call(h, { type: "setPageTags", url: URL_A, tags: [1] })).toEqual({ ok: false, error: "invalid-input" });
  });
});

describe("knowledge layer: library, clear, export, import", () => {
  function seed(h) {
    h.localData.settings = { style: "dots" };
    h.localData[`readtrail.saved.v1:${URL_A}`] = {
      version: 1, title: "A", savedAt: 5,
      position: { anchor: anchor(), viewportOffset: 1, scrollY: 0, scrollRatio: 0, savedAt: 4 }
    };
    call(h, { type: "savePassage", url: URL_A, text: "passage a", tags: ["t"] });
    call(h, { type: "saveNote", url: URL_B, text: "note b" });
    call(h, { type: "setPageTags", url: URL_A, tags: ["t"] });
  }

  it("lists the whole library with counts and never touches settings on clear", () => {
    const h = load();
    seed(h);
    const lib = call(h, { type: "listLibrary" });
    expect(lib.counts).toEqual({ passages: 1, notes: 1, saved: 1, drafts: 0 });
    expect(lib.limit).toBe(1500);
    expect(lib.saved[0].url).toBe(URL_A);
    expect(lib.pagemeta).toEqual([{ url: URL_A, version: 1, tags: ["t"], updatedAt: expect.any(Number) }]);

    expect(call(h, { type: "clearLibrary", kinds: ["passages"] })).toEqual({ ok: true, removed: 1 });
    expect(call(h, { type: "listLibrary" }).counts).toEqual({ passages: 0, notes: 1, saved: 1, drafts: 0 });
    expect(call(h, { type: "clearLibrary" })).toEqual({ ok: true, removed: 3 });
    expect(call(h, { type: "listLibrary" }).counts).toEqual({ passages: 0, notes: 0, saved: 0, drafts: 0 });
    expect(h.localData.settings).toEqual({ style: "dots" });
    expect(call(h, { type: "clearLibrary", kinds: ["settings"] })).toEqual({ ok: false, error: "invalid-input" });
  });

  it("removes only one page's passages, notes, and tags", () => {
    const h = load();
    seed(h);
    call(h, { type: "savePassage", url: URL_B, text: "passage b" });
    expect(call(h, { type: "removePageData", url: URL_A })).toEqual({ ok: true, removed: 2 });
    const lib = call(h, { type: "listLibrary" });
    expect(lib.passages.map((p) => p.url)).toEqual([URL_B]);
    expect(lib.notes.map((n) => n.url)).toEqual([URL_B]);
    expect(lib.pagemeta).toEqual([]);
    expect(lib.saved).toHaveLength(1); // saved pages are removed separately
  });

  it("round-trips export then import in replace mode and skips duplicates in merge mode", () => {
    const h = load();
    seed(h);
    const { payload } = call(h, { type: "exportLibrary" });
    expect(payload.format).toBe("readtrail-export");
    expect(payload.passages[0].text).toBe("passage a");

    const replaced = call(h, { type: "importLibrary", payload, mode: "replace" });
    expect(replaced).toEqual({ ok: true, imported: 4, skipped: 0, rejected: 0, mode: "replace" });
    const after = call(h, { type: "exportLibrary" }).payload;
    expect({ ...after, exportedAt: 0 }).toEqual({ ...payload, exportedAt: 0 });

    const merged = call(h, { type: "importLibrary", payload, mode: "merge" });
    expect(merged).toEqual({ ok: true, imported: 0, skipped: 4, rejected: 0, mode: "merge" });

    const dirty = { ...payload, passages: [...payload.passages, { version: 1, id: "bad" }], notes: [] };
    const partial = call(h, { type: "importLibrary", payload: dirty, mode: "merge" });
    expect(partial).toEqual({ ok: true, imported: 0, skipped: 3, rejected: 1, mode: "merge" });
    expect(call(h, { type: "importLibrary", payload: { format: "other" } })).toEqual({ ok: false, error: "invalid-input" });
    expect(h.localData.settings).toEqual({ style: "dots" });
  });
});

describe("knowledge layer: context menu", () => {
  it("registers one selection menu item on install and saves the captured selection", () => {
    const h = load({ tabs: [{ id: 4, url: URL_A, incognito: false }] });
    h.installedHandler();
    expect(h.chrome.contextMenus.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: "readtrail-save-selection", contexts: ["selection"] }),
      expect.any(Function)
    );

    h.chrome.tabs.sendMessage.mockImplementation((_id, msg, cb) => {
      expect(msg).toEqual({ type: "capturePassage" });
      cb({ ok: true, text: "Selected words", start: anchor(), end: anchor([0, 1], 8), url: URL_A, title: "A" });
    });
    h.emit.contextMenus.onClicked({ menuItemId: "readtrail-save-selection" }, { id: 4, url: URL_A, incognito: false });
    const passages = call(h, { type: "listPassages" }).passages;
    expect(passages).toHaveLength(1);
    expect(passages[0]).toEqual(expect.objectContaining({ url: URL_A, title: "A", text: "Selected words" }));

    // Incognito clicks and other menu ids are ignored.
    h.emit.contextMenus.onClicked({ menuItemId: "readtrail-save-selection" }, { id: 4, url: URL_A, incognito: true });
    h.emit.contextMenus.onClicked({ menuItemId: "other" }, { id: 4, url: URL_A });
    expect(call(h, { type: "listPassages" }).passages).toHaveLength(1);
  });
});

describe("drafts", () => {
  const draftOf = (h, overrides = {}) => {
    const res = call(h, { type: "saveDraft", title: "Do passkeys work?", ...overrides });
    expect(res.ok).toBe(true);
    return res.draft;
  };

  it("creates a draft with a title, tags, and an empty text block", () => {
    const h = load();
    const draft = draftOf(h, { tags: ["Passkeys", "passkeys"], blocks: [{ type: "text", text: "hello" }] });
    expect(draft).toEqual(expect.objectContaining({
      version: 1,
      title: "Do passkeys work?",
      tags: ["passkeys"],
      blocks: [{ type: "text", text: "hello" }]
    }));
    expect(call(h, { type: "listDrafts" }).drafts).toHaveLength(1);
  });

  it("refuses a draft with no title", () => {
    const h = load();
    expect(call(h, { type: "saveDraft", title: "   " })).toEqual({ ok: false, error: "invalid-input" });
  });

  it("copies the quote snapshot from the stored passage, never from the caller", () => {
    const h = load();
    const passage = call(h, { type: "savePassage", url: URL_A, title: "Real Title", text: "the real words" }, PAGE).passage;
    const draft = draftOf(h);
    const res = call(h, { type: "appendQuote", draftId: draft.id, passageId: passage.id });
    expect(res.ok).toBe(true);
    expect(res.draft.blocks[0]).toEqual({
      type: "quote",
      passageId: passage.id,
      text: "the real words",
      url: URL_A,
      title: "Real Title"
    });
  });

  it("still saves a draft after Return records what it found", () => {
    const h = load();
    const passage = call(h, { type: "savePassage", url: URL_A, text: "the real words" }, PAGE).passage;
    const draft = draftOf(h);
    const quoted = call(h, { type: "appendQuote", draftId: draft.id, passageId: passage.id }).draft;

    // Return writes its outcome onto the quote. The provenance guard must not
    // read that as the caller tampering with the snapshot, or every autosave
    // after a Return is rejected and the reader silently loses their writing.
    const blocks = quoted.blocks.map((block) => (block.type === "quote"
      ? { ...block, checked: { quality: "missing", at: 1234 } }
      : block));
    const res = call(h, { type: "updateDraft", id: draft.id, blocks });

    expect(res.ok).toBe(true);
    expect(res.draft.blocks[0].checked).toEqual({ quality: "missing", at: 1234 });
    expect(res.draft.blocks[0].text).toBe("the real words");
  });

  it("still refuses a quote whose snapshot the caller rewrote, checked or not", () => {
    const h = load();
    const passage = call(h, { type: "savePassage", url: URL_A, text: "the real words" }, PAGE).passage;
    const draft = draftOf(h);
    const quoted = call(h, { type: "appendQuote", draftId: draft.id, passageId: passage.id }).draft;

    const tampered = quoted.blocks.map((block) => (block.type === "quote"
      ? { ...block, text: "words I made up", checked: { quality: "exact", at: 1 } }
      : block));
    expect(call(h, { type: "updateDraft", id: draft.id, blocks: tampered }))
      .toEqual({ ok: false, error: "invalid-input" });
  });

  it("refuses to quote a passage that does not exist", () => {
    const h = load();
    const draft = draftOf(h);
    expect(call(h, { type: "appendQuote", draftId: draft.id, passageId: MISSING_ID }))
      .toEqual({ ok: false, error: "not-found" });
  });

  it("rejects a quote block whose snapshot the caller invented", () => {
    const h = load();
    const draft = draftOf(h);
    const forged = {
      type: "quote",
      passageId: MISSING_ID,
      text: "made up",
      url: "https://forged.example/source",
      title: "Invented source"
    };
    expect(call(h, { type: "saveDraft", title: "Forged", blocks: [forged] }))
      .toEqual({ ok: false, error: "invalid-input" });
    const res = call(h, {
      type: "updateDraft",
      id: draft.id,
      blocks: [forged]
    });
    expect(res).toEqual({ ok: false, error: "invalid-input" });
  });

  it("allows an update to retain or reorder authorized quote snapshots but not rewrite them", () => {
    const h = load();
    const passage = call(h, { type: "savePassage", url: URL_A, title: "Real", text: "source words" }).passage;
    const created = draftOf(h, { blocks: [{ type: "text", text: "intro" }] });
    const quoted = call(h, { type: "appendQuote", draftId: created.id, passageId: passage.id }).draft;
    const reordered = call(h, { type: "updateDraft", id: created.id, blocks: [quoted.blocks[1], quoted.blocks[0]] });
    expect(reordered.ok).toBe(true);
    expect(reordered.draft.blocks[0]).toEqual(quoted.blocks[1]);
    const rewritten = { ...quoted.blocks[1], text: "rewritten by caller" };
    expect(call(h, { type: "updateDraft", id: created.id, blocks: [rewritten] }))
      .toEqual({ ok: false, error: "invalid-input" });
  });

  it("updates title, tags, and blocks, and reports a missing draft", () => {
    const h = load();
    const draft = draftOf(h);
    const res = call(h, { type: "updateDraft", id: draft.id, title: "Renamed", blocks: [{ type: "text", text: "a" }, { type: "text", text: "b" }] });
    expect(res.draft.title).toBe("Renamed");
    expect(res.draft.blocks).toHaveLength(2);
    expect(call(h, { type: "updateDraft", id: MISSING_ID, title: "x" })).toEqual({ ok: false, error: "not-found" });
  });

  it("removes a draft and leaves its quoted passages alone", () => {
    const h = load();
    const passage = call(h, { type: "savePassage", url: URL_A, text: "kept" }, PAGE).passage;
    const draft = draftOf(h);
    call(h, { type: "appendQuote", draftId: draft.id, passageId: passage.id });
    expect(call(h, { type: "removeDraft", id: draft.id })).toEqual({ ok: true });
    expect(call(h, { type: "listDrafts" }).drafts).toEqual([]);
    expect(call(h, { type: "listPassages" }).passages).toHaveLength(1);
  });

  it("round-trips drafts through export and import, and still imports a file without them", () => {
    const h = load();
    const passage = call(h, { type: "savePassage", url: URL_A, text: "quoted words" }, PAGE).passage;
    const draft = draftOf(h);
    call(h, { type: "appendQuote", draftId: draft.id, passageId: passage.id });

    const payload = call(h, { type: "exportLibrary" }).payload;
    expect(payload.drafts).toHaveLength(1);
    expect(call(h, { type: "clearLibrary" }).ok).toBe(true);
    expect(call(h, { type: "listDrafts" }).drafts).toEqual([]);

    const imported = call(h, { type: "importLibrary", payload, mode: "replace" });
    expect(imported).toEqual(expect.objectContaining({ ok: true, rejected: 0 }));
    const back = call(h, { type: "listDrafts" }).drafts;
    expect(back).toHaveLength(1);
    expect(back[0].blocks[0].text).toBe("quoted words");

    const legacy = { format: "readtrail-export", version: 1, exportedAt: 1, saved: [], passages: [], notes: [], pagemeta: [] };
    expect(call(h, { type: "importLibrary", payload: legacy, mode: "replace" }).ok).toBe(true);
  });

  it("rejects a malformed replace import before clearing existing data", () => {
    const h = load();
    const existing = draftOf(h);
    const payload = {
      format: "readtrail-export",
      version: 1,
      exportedAt: 1,
      saved: [],
      passages: [],
      notes: [],
      pagemeta: [],
      drafts: [{ version: 1, id: "bad" }]
    };
    expect(call(h, { type: "importLibrary", payload, mode: "replace" }))
      .toEqual({ ok: false, error: "invalid-input" });
    expect(call(h, { type: "listDrafts" }).drafts.map((item) => item.id)).toEqual([existing.id]);
  });

  // Replace used to clear the library and then write. A failed write left the
  // reader with nothing at all, reported as a storage error.
  it("keeps the existing library when a replace import cannot be written", () => {
    let armed = false;
    const h = load({
      errors: { local: { set: (obj) => armed && Object.keys(obj).some((key) => key.startsWith("readtrail.passage.v1")) } }
    });
    const keep = call(h, { type: "savePassage", url: URL_A, text: "the only copy of this" });
    expect(keep.ok).toBe(true);
    const existingDraft = draftOf(h);

    armed = true;
    const payload = {
      format: "readtrail-export", version: 1, exportedAt: 1,
      saved: [], notes: [], pagemeta: [], drafts: [],
      passages: [{
        version: 1, id: MISSING_ID, url: URL_B, title: "B", text: "replacement",
        start: null, end: null, note: "", tags: [], createdAt: 1, updatedAt: 1
      }]
    };
    expect(call(h, { type: "importLibrary", payload, mode: "replace" }))
      .toEqual({ ok: false, error: "save-storage-error" });

    // Nothing was lost: the failure happened before anything was retired.
    expect(call(h, { type: "listPassages" }).passages.map((item) => item.id)).toEqual([keep.passage.id]);
    expect(call(h, { type: "listDrafts" }).drafts.map((item) => item.id)).toEqual([existingDraft.id]);
  });

  it("replaces the library only once the replacement is stored", () => {
    const h = load();
    const old = call(h, { type: "savePassage", url: URL_A, text: "the old clip" });
    draftOf(h);
    const payload = {
      format: "readtrail-export", version: 1, exportedAt: 1,
      saved: [], notes: [], pagemeta: [], drafts: [],
      passages: [{
        version: 1, id: MISSING_ID, url: URL_B, title: "B", text: "the new clip",
        start: null, end: null, note: "", tags: [], createdAt: 1, updatedAt: 1
      }]
    };
    expect(call(h, { type: "importLibrary", payload, mode: "replace" }).ok).toBe(true);
    const ids = call(h, { type: "listPassages" }).passages.map((item) => item.id);
    expect(ids).toEqual([MISSING_ID]);
    expect(ids).not.toContain(old.passage.id);
    expect(call(h, { type: "listDrafts" }).drafts).toHaveLength(0);
  });

  // isValidDraft says a quote is well formed, not that it is true. A payload
  // could pair a real passage id with fabricated text, and Return would resolve
  // the id and report the fabrication as found exactly.
  it("refuses an imported quote whose snapshot contradicts its passage", () => {
    const h = load();
    const passage = {
      version: 1, id: MISSING_ID, url: URL_B, title: "Real title", text: "what the page really said",
      start: null, end: null, note: "", tags: [], createdAt: 1, updatedAt: 1
    };
    const fabricated = {
      version: 1, id: "22222222-3333-4444-8555-666666666666", title: "Imported", tags: [],
      blocks: [{ type: "quote", passageId: MISSING_ID, text: "what someone wishes it said", url: URL_B, title: "Real title" }],
      createdAt: 1, updatedAt: 1
    };
    const payload = {
      format: "readtrail-export", version: 1, exportedAt: 1,
      saved: [], notes: [], pagemeta: [], passages: [passage], drafts: [fabricated]
    };
    const res = call(h, { type: "importLibrary", payload, mode: "merge" });
    expect(res.ok).toBe(true);
    expect(res.rejected).toBe(1);
    expect(call(h, { type: "listDrafts" }).drafts).toHaveLength(0);
    // The passage itself was fine and is kept.
    expect(call(h, { type: "listPassages" }).passages).toHaveLength(1);
  });

  it("imports a quote whose clip is genuinely gone, marked as having no way back", () => {
    const h = load();
    const orphan = {
      version: 1, id: "33333333-4444-4555-8666-777777777777", title: "Imported", tags: [],
      blocks: [{ type: "quote", passageId: MISSING_ID, text: "a line I kept", url: URL_B, title: "B" }],
      createdAt: 1, updatedAt: 1
    };
    const payload = {
      format: "readtrail-export", version: 1, exportedAt: 1,
      saved: [], notes: [], pagemeta: [], passages: [], drafts: [orphan]
    };
    expect(call(h, { type: "importLibrary", payload, mode: "merge" }).ok).toBe(true);
    const [imported] = call(h, { type: "listDrafts" }).drafts;
    // The reader keeps their text, and nothing can later claim it resolved.
    expect(imported.blocks[0].text).toBe("a line I kept");
    expect(imported.blocks[0].checked).toEqual({ quality: "missing", at: expect.any(Number), reason: "clip-gone" });
  });

  it("clears drafts only when asked", () => {
    const h = load();
    draftOf(h);
    call(h, { type: "savePassage", url: URL_A, text: "a clip" }, PAGE);
    expect(call(h, { type: "clearLibrary", kinds: ["passages"] }).ok).toBe(true);
    expect(call(h, { type: "listDrafts" }).drafts).toHaveLength(1);
    expect(call(h, { type: "clearLibrary", kinds: ["drafts"] })).toEqual({ ok: true, removed: 1 });
    expect(call(h, { type: "listDrafts" }).drafts).toEqual([]);
  });

  it("counts drafts in listLibrary without counting them against the clip limit", () => {
    const h = load();
    draftOf(h);
    const lib = call(h, { type: "listLibrary" });
    expect(lib.counts).toEqual({ passages: 0, notes: 0, saved: 0, drafts: 1 });
    expect(lib.drafts).toHaveLength(1);
  });

  it("guards every size-increasing library write while allowing reductions", () => {
    const h = load();
    const note = call(h, { type: "saveNote", url: URL_A, text: "a longer note" }).note;
    h.chrome.storage.local.getBytesInUse = vi.fn((_, callback) => callback(9 * 1024 * 1024));

    expect(call(h, { type: "savePassage", url: URL_A, text: "clip" })).toEqual({ ok: false, error: "storage-full" });
    expect(call(h, { type: "saveNote", url: URL_A, text: "note" })).toEqual({ ok: false, error: "storage-full" });
    expect(call(h, { type: "setPageTags", url: URL_A, tags: ["full"] })).toEqual({ ok: false, error: "storage-full" });
    expect(call(h, { type: "saveDraft", title: "Full" })).toEqual({ ok: false, error: "storage-full" });

    expect(call(h, { type: "updateNote", id: note.id, text: "short" }).ok).toBe(true);
    const empty = { format: "readtrail-export", version: 1, exportedAt: 1, saved: [], passages: [], notes: [], pagemeta: [], drafts: [] };
    const mergePayload = { ...empty, notes: [{ ...note, id: MISSING_ID }] };
    expect(call(h, { type: "importLibrary", payload: mergePayload, mode: "merge" }))
      .toEqual({ ok: false, error: "storage-full" });
    expect(call(h, { type: "importLibrary", payload: empty, mode: "replace" }).ok).toBe(true);
  });
});
