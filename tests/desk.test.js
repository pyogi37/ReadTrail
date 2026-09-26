import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const readSource = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const html = readSource("sidepanel/desk.html");
const strippedHtml = html.replace(/<script[^>]*src="[^"]+"[^>]*><\/script>\s*/g, "");
const sources = [
  "shared/constants.js",
  "shared/validators.js",
  "sidepanel/search-index.js",
  "sidepanel/export-import.js",
  "sidepanel/knowledge-view.js",
  "sidepanel/draft-view.js",
  "sidepanel/desk.js"
].map(readSource);

const passage = (overrides = {}) => ({
  version: 1,
  id: "passage-1",
  url: "https://example.com/source",
  title: "Source page",
  text: "A useful piece of evidence.",
  start: null,
  end: null,
  note: "",
  tags: [],
  createdAt: 100,
  updatedAt: 100,
  ...overrides
});

const draft = (overrides = {}) => ({
  version: 1,
  id: "draft-1",
  title: "Working question",
  tags: [],
  blocks: [{ type: "text", text: "My opening thought." }],
  createdAt: 100,
  updatedAt: 100,
  ...overrides
});

const quoteBlock = (overrides = {}) => ({
  type: "quote",
  passageId: "passage-1",
  text: "A useful piece of evidence.",
  url: "https://example.com/source",
  title: "Source page",
  ...overrides
});

function libraryResponse(passages = [], pagemeta = []) {
  return {
    ok: true,
    saved: [],
    passages,
    notes: [],
    pagemeta,
    counts: { passages: passages.length, notes: 0, saved: 0 },
    limit: 1500
  };
}

function loadDesk({ hash = "#/sources", passages = [], drafts = [], pagemeta = [] } = {}) {
  delete globalThis.ReadTrailShared;
  delete globalThis.ReadTrailSidePanel;
  document.open();
  document.write(strippedHtml);
  document.close();
  window.history.replaceState(null, "", `/sidepanel/desk.html${hash}`);

  const pending = {};
  const messages = [];
  const storageHandlers = [];
  const push = (type, callback) => (pending[type] = pending[type] || []).push(callback);
  globalThis.chrome = {
    runtime: {
      lastError: null,
      sendMessage: vi.fn((message, callback) => {
        messages.push(message);
        push(message.type, callback);
      }),
      getURL: vi.fn((relative) => `chrome-extension://test/${relative}`)
    },
    tabs: { create: vi.fn() },
    storage: { onChanged: { addListener: vi.fn((handler) => storageHandlers.push(handler)) } }
  };

  for (const source of sources) window.eval(source);

  const shift = (type) => {
    const callback = pending[type] && pending[type].shift();
    if (!callback) throw new Error(`no pending ${type} callback`);
    return callback;
  };
  shift("listLibrary")(libraryResponse(passages, pagemeta));
  shift("listDrafts")({ ok: true, drafts });
  const emitStorage = (changes, area = "local") => storageHandlers.forEach((handler) => handler(changes, area));
  return { messages, pending, shift, emitStorage, chrome: globalThis.chrome };
}

describe("ReadTrail Desk", () => {
  it("creates a draft, opens it, and gives it a shareable route", () => {
    const h = loadDesk();
    document.querySelector("#newDraftTitle").value = "How does the evidence connect?";
    document.querySelector("#newDraftForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(h.messages.at(-1)).toEqual({
      type: "saveDraft",
      title: "How does the evidence connect?",
      blocks: [{ type: "text", text: "" }]
    });
    h.shift("saveDraft")({ ok: true, draft: draft({ title: "How does the evidence connect?" }) });

    expect(document.querySelector("#draftEditor").hidden).toBe(false);
    expect(document.querySelector("#draftTitle").value).toBe("How does the evidence connect?");
    expect(window.location.hash).toBe("#/drafts/draft-1");
  });

  it("quotes a source passage into the open draft", () => {
    const source = passage();
    const openDraft = draft();
    const h = loadDesk({ hash: "#/drafts/draft-1", passages: [source], drafts: [openDraft] });

    document.querySelector(".btn-quote").click();
    expect(h.messages.at(-1)).toEqual({ type: "appendQuote", draftId: "draft-1", passageId: "passage-1" });
    h.shift("appendQuote")({ ok: true, draft: draft({ blocks: [...openDraft.blocks, quoteBlock()] }) });

    expect(document.querySelector(".quote-block .passage-text").textContent).toBe(source.text);
    expect(document.querySelector("#draftStatus").textContent).toContain("Quoted into");
    expect(document.querySelector("#deskMain").dataset.activePane).toBe("draft");
  });

  it("queues edits for the next draft while the previous draft is still saving", () => {
    vi.useFakeTimers();
    const first = draft({ id: "draft-a", title: "Draft A" });
    const second = draft({ id: "draft-b", title: "Draft B" });
    const h = loadDesk({ hash: "#/drafts/draft-a", drafts: [first, second] });

    const title = document.querySelector("#draftTitle");
    title.value = "Draft A edited";
    title.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(400);
    expect(h.messages.filter((message) => message.type === "updateDraft")).toHaveLength(1);

    document.querySelector('.draft-row[data-id="draft-b"] .draft-open').click();
    title.value = "Draft B edited";
    title.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(400);
    expect(h.messages.filter((message) => message.type === "updateDraft")).toHaveLength(1);

    h.shift("updateDraft")({ ok: true, draft: { ...first, title: "Draft A edited", updatedAt: 200 } });
    expect(h.messages.filter((message) => message.type === "updateDraft")).toHaveLength(2);
    expect(h.messages.filter((message) => message.type === "updateDraft")[1]).toEqual(expect.objectContaining({
      id: "draft-b",
      title: "Draft B edited"
    }));
    h.shift("updateDraft")({ ok: true, draft: { ...second, title: "Draft B edited", updatedAt: 300 } });
    expect(document.querySelector("#draftSaveState").textContent).toBe("Saved");
    vi.useRealTimers();
  });

  it("waits for an edited draft to save before appending a quote", () => {
    vi.useFakeTimers();
    const h = loadDesk({ hash: "#/drafts/draft-1", passages: [passage()], drafts: [draft()] });
    const title = document.querySelector("#draftTitle");
    title.value = "Edited before quote";
    title.dispatchEvent(new Event("input"));
    document.querySelector(".btn-quote").click();

    expect(h.messages.at(-1).type).toBe("updateDraft");
    expect(h.messages.some((message) => message.type === "appendQuote")).toBe(false);
    h.shift("updateDraft")({ ok: true, draft: draft({ title: "Edited before quote", updatedAt: 200 }) });
    expect(h.messages.at(-1)).toEqual({ type: "appendQuote", draftId: "draft-1", passageId: "passage-1" });
    h.shift("appendQuote")({ ok: true, draft: draft({ title: "Edited before quote", blocks: [draft().blocks[0], quoteBlock()] }) });
    vi.useRealTimers();
  });

  it("moves a block and restores focus to its move control", () => {
    loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [{ type: "text", text: "First" }, quoteBlock()] })]
    });

    document.querySelector('.draft-block[data-index="1"] .btn-move-up').click();

    expect(document.querySelector('.draft-block[data-index="0"]').classList.contains("quote-block")).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('.draft-block[data-index="0"] .btn-move-down'));
    expect(document.querySelector("#draftLive").textContent).toBe("Moved to position 1 of 2.");
  });

  it("removes a quote without removing its source clip", () => {
    const h = loadDesk({
      hash: "#/drafts/draft-1",
      passages: [passage()],
      drafts: [draft({ blocks: [{ type: "text", text: "First" }, quoteBlock()] })]
    });

    document.querySelector(".quote-block .btn-remove-block").click();

    expect(document.querySelector(".quote-block")).toBeNull();
    expect(document.querySelector("#draftLive").textContent).toContain("clip it came from is still in your library");
    expect(h.messages.some((message) => message.type === "removePassage")).toBe(false);
  });

  it("presents # text blocks as editable headings with heading semantics", () => {
    loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: [{ type: "text", text: "# Findings" }] })] });
    const area = document.querySelector(".block-text");
    const heading = document.querySelector(".draft-semantic-heading");
    expect(area.classList.contains("heading-block-text")).toBe(true);
    expect(area.getAttribute("aria-label")).toContain("heading");
    expect(heading.hidden).toBe(false);
    expect(heading.textContent).toBe("Findings");
  });

  // Return answers about one tab. Saying "found it" without saying where is a
  // true sentence about a window the reader is not looking at.
  it.each([
    ["exact", false, "Found exactly, in the tab you already had open.", "status"],
    ["approximate", false, "Found by its wording in the tab you had open. The page has changed since you saved this.", "status"],
    ["missing", false, "Not found in the tab you had open. The page may have changed. This quote keeps the text you saved.", "alert"],
    ["exact", true, "Opened the page in a new tab and found the passage there.", "status"],
    ["approximate", true, "Opened the page in a new tab and found it by its wording. The page has changed since you saved this.", "status"],
    ["missing", true, "Opened the page in a new tab and could not find the passage. The page may have changed. This quote keeps the text you saved.", "alert"]
  ])("names the tab it looked in for the %s outcome (opened=%s)", (quality, opened, message, role) => {
    const h = loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: [quoteBlock()] })] });
    document.querySelector(".btn-return").click();
    expect(h.messages.at(-1)).toEqual({ type: "revealPassage", id: "passage-1" });

    h.shift("revealPassage")({ ok: true, opened, quality });

    // The answer belongs on the quote it is about, not in a line above the
    // whole document where a long draft pushes it off-screen.
    const verdict = document.querySelector(".quote-block .quote-verdict");
    expect(verdict.textContent).toBe(message);
    expect(verdict.hidden).toBe(false);
    expect(verdict.dataset.quality).toBe(quality);
    expect(document.activeElement).toBe(verdict);
    expect(document.querySelector("#draftStatus").textContent).not.toContain("Found");
    void role;
  });

  it("reloads its drafts when another tab writes one, so no Desk holds a stale list", () => {
    const h = loadDesk({ drafts: [draft()] });
    expect(document.querySelectorAll(".draft-row")).toHaveLength(1);

    // Sources refreshed themselves and drafts never did, so a second Desk tab
    // kept a stale list for its whole life and its autosave, which ships the
    // whole document, would overwrite the newer one.
    vi.useFakeTimers();
    h.emitStorage({ "readtrail.draft.v1:draft-2": { newValue: {} } });
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    h.shift("listDrafts")({ ok: true, drafts: [draft(), draft({ id: "draft-2", title: "Written elsewhere" })] });

    const titles = [...document.querySelectorAll(".draft-row .item-title")].map((n) => n.textContent);
    expect(titles).toContain("Written elsewhere");
  });

  it("reads through to storage for a route naming a draft it has not loaded", () => {
    const h = loadDesk({ hash: "#/drafts/draft-9", drafts: [] });

    // The route named a draft made after this tab loaded. Rendering an empty
    // editor and saying nothing is the silent failure this replaces.
    h.shift("listDrafts")({ ok: true, drafts: [draft({ id: "draft-9", title: "Made elsewhere" })] });

    expect(document.querySelector("#draftEditor").hidden).toBe(false);
    expect(document.querySelector("#draftTitle").value).toBe("Made elsewhere");
  });

  it("says so when a routed draft really is gone", () => {
    const h = loadDesk({ hash: "#/drafts/draft-gone", drafts: [] });
    h.shift("listDrafts")({ ok: true, drafts: [] });

    expect(document.querySelector("#draftEditor").hidden).toBe(true);
    expect(document.querySelector("#draftStatus").textContent).toContain("no longer exists");
  });

  it("appends a block at the end, so writing after a quote is one control", () => {
    const h = loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: [quoteBlock()] })] });
    expect(document.querySelectorAll(".draft-block")).toHaveLength(1);

    document.querySelector("#draftAppend").click();

    const blocks = document.querySelectorAll(".draft-block");
    expect(blocks).toHaveLength(2);
    expect(blocks[1].classList.contains("text-block")).toBe(true);
    expect(document.activeElement).toBe(blocks[1].querySelector("textarea"));
    void h;
  });

  it("offers a visible way back after removing a block, and restores it in place", () => {
    const h = loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [{ type: "text", text: "first" }, { type: "text", text: "second" }] })]
    });
    const undo = document.querySelector("#draftUndo");
    expect(undo.hidden).toBe(true);

    document.querySelectorAll(".draft-block")[1].querySelector(".btn-remove-block").click();
    expect(document.querySelectorAll(".draft-block")).toHaveLength(1);
    expect(undo.hidden).toBe(false);
    expect(document.querySelector("#draftStatus").textContent).toContain("Block removed");

    undo.click();
    const texts = [...document.querySelectorAll(".block-text")].map((t) => t.value);
    expect(texts).toEqual(["first", "second"]);
    expect(undo.hidden).toBe(true);
    void h;
  });

  it("never shows a verdict on a quote nobody checked, even of the same clip", () => {
    const h = loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [quoteBlock(), quoteBlock()] })]
    });
    const blocks = () => [...document.querySelectorAll(".quote-block")];
    expect(blocks()).toHaveLength(2);

    blocks()[0].querySelector(".btn-return").click();
    h.shift("revealPassage")({ ok: true, opened: false, quality: "exact" });

    // The same clip can be quoted twice. A verdict is evidence about one
    // press; showing it on a block nobody pressed asserts a fact the product
    // was never told.
    expect(blocks()[1].querySelector(".quote-verdict").hidden).toBe(true);

    // The bleed only appears once the list rebuilds, which any edit does.
    document.querySelector(".btn-insert-below").click();

    const after = blocks().map((b) => b.querySelector(".quote-verdict"));
    expect(after[0].hidden).toBe(false);
    expect(after[1].hidden).toBe(true);
    expect(after[1].textContent).toBe("");
  });

  it("moves a block with Alt and an arrow, keeping the caret in it", () => {
    loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [{ type: "text", text: "first" }, { type: "text", text: "second" }] })]
    });
    const second = document.querySelectorAll(".block-text")[1];
    second.focus();
    // Placing a block used to mean one mouse press per position.
    second.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }));

    const order = [...document.querySelectorAll(".block-text")].map((t) => t.value);
    expect(order).toEqual(["second", "first"]);
    expect(document.activeElement.value).toBe("second");
  });

  it("adds a block below with Control and Enter", () => {
    loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: [{ type: "text", text: "only" }] })] });
    const area = document.querySelector(".block-text");
    area.focus();
    area.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));

    expect(document.querySelectorAll(".draft-block")).toHaveLength(2);
    expect(document.activeElement).toBe(document.querySelectorAll(".block-text")[1]);
  });

  it("announces only the heading line, not the prose beneath it", () => {
    loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [{ type: "text", text: "# Findings\n\nSome body text." }] })]
    });
    // A screen reader's heading list is the way through a long draft. Taking
    // everything after "# " put the whole block into every entry.
    expect(document.querySelector(".draft-semantic-heading").textContent).toBe("Findings");
  });

  it("does not take the caret when a route restores a draft", () => {
    loadDesk({ hash: "#/drafts/draft-1", drafts: [draft()] });
    // Focusing the title on a restore strands the Sources pane behind the
    // landing point: a forward-tab reader can never reach it.
    expect(document.activeElement).not.toBe(document.querySelector("#draftTitle"));
  });

  it("moves a verdict with its block rather than leaving it at a position", () => {
    const h = loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [{ type: "text", text: "intro" }, quoteBlock()] })]
    });
    document.querySelector(".btn-return").click();
    h.shift("revealPassage")({ ok: true, opened: false, quality: "approximate" });
    expect(document.querySelector(".quote-block .quote-verdict").dataset.quality).toBe("approximate");

    // The quote moves to the top. Its answer is about the quote, not about
    // the second slot in the list.
    document.querySelector(".quote-block .btn-move-up").click();

    const blocks = [...document.querySelectorAll(".draft-block")];
    expect(blocks[0].classList.contains("quote-block")).toBe(true);
    expect(blocks[0].querySelector(".quote-verdict").dataset.quality).toBe("approximate");
    expect(blocks[0].querySelector(".quote-verdict").hidden).toBe(false);
  });

  it("keeps each quote's verdict through the rebuild that follows a save", () => {
    const h = loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: [quoteBlock()] })] });
    document.querySelector(".btn-return").click();
    h.shift("revealPassage")({ ok: true, opened: false, quality: "missing" });
    expect(document.querySelector(".quote-verdict").dataset.quality).toBe("missing");

    // Any edit rebuilds the block list; a reader must not lose the answer they
    // just asked for, and must still see which quotes no longer resolve.
    document.querySelector(".btn-insert-below").click();
    expect(document.querySelector(".quote-verdict").dataset.quality).toBe("missing");
    expect(document.querySelector(".quote-verdict").hidden).toBe(false);
  });

  it("routes topics and searches into Sources and supports the narrow pane switcher", () => {
    loadDesk({
      hash: "#/topics/research",
      passages: [passage()],
      pagemeta: [{ version: 1, url: "https://example.com/source", tags: ["research"], updatedAt: 100 }]
    });

    expect(document.querySelector("#tagsViewButton").getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector(".tag-filter").classList.contains("is-active")).toBe(true);
    document.querySelector("#draftTab").click();
    expect(document.querySelector("#deskMain").dataset.activePane).toBe("draft");
    expect(document.querySelector("#draftTab").getAttribute("aria-selected")).toBe("true");

    window.history.replaceState(null, "", "/sidepanel/desk.html#/search?q=evidence");
    globalThis.ReadTrailSidePanel.desk.applyRoute();
    expect(document.querySelector("#librarySearch").value).toBe("evidence");
    expect(document.querySelector("#deskMain").dataset.activePane).toBe("sources");
    expect(document.querySelector("#sourcesPane").getAttribute("role")).toBe("tabpanel");
    expect(document.querySelector("#sourcesPane").getAttribute("aria-labelledby")).toBe("sourcesTab");
    expect(document.querySelector("#draftPane").getAttribute("role")).toBe("tabpanel");
    expect(document.querySelector("#draftPane").getAttribute("aria-labelledby")).toBe("draftTab");
  });
});
