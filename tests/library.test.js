import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadServiceWorker, senders } from "./helpers/chrome-mock.js";

const PAGE = senders.page("sidepanel/sidepanel.html");
const URL_A = "https://example.com/article-a";
const URL_B = "https://news.example.org/story";
const ID = /^[0-9a-f-]{36}$/;

function anchor(path = [0, 1], offset = 2) {
  return { version: 1, path, offset };
}

function load(options = {}) {
  return loadServiceWorker(options);
}

function call(h, msg, sender = PAGE) {
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
    const pageInTab = { ...PAGE, tab: { id: 9, url: "chrome-extension://test/sidepanel/sidepanel.html?mode=page", incognito: false } };
    const res = call(h, { type: "savePassage", url: URL_A, text: "from page mode" }, pageInTab);
    expect(res.ok).toBe(true);
    expect(res.passage.url).toBe(URL_A);
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
    expect(lib.counts).toEqual({ passages: 1, notes: 1, saved: 1 });
    expect(lib.limit).toBe(1500);
    expect(lib.saved[0].url).toBe(URL_A);
    expect(lib.pagemeta).toEqual([{ url: URL_A, version: 1, tags: ["t"], updatedAt: expect.any(Number) }]);

    expect(call(h, { type: "clearLibrary", kinds: ["passages"] })).toEqual({ ok: true, removed: 1 });
    expect(call(h, { type: "listLibrary" }).counts).toEqual({ passages: 0, notes: 1, saved: 1 });
    expect(call(h, { type: "clearLibrary" })).toEqual({ ok: true, removed: 3 });
    expect(call(h, { type: "listLibrary" }).counts).toEqual({ passages: 0, notes: 0, saved: 0 });
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
