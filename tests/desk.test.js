import { afterEach, describe, expect, it, vi } from "vitest";
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
  "sidepanel/draft-markdown.js",
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

    // The way back belongs where the block was, not at the top of a document
    // the reader may be a thousand pixels down.
    expect(undo.parentElement.tagName).toBe("LI");
    expect(undo.parentElement.parentElement.id).toBe("draftBlocks");
    expect(document.activeElement).toBe(undo);

    undo.click();
    const texts = [...document.querySelectorAll(".block-text")].map((t) => t.value);
    expect(texts).toEqual(["first", "second"]);
    expect(undo.hidden).toBe(true);
    expect(undo.parentElement.id).not.toBe("draftBlocks");
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

  it("keeps what Return found, so a reopened draft still knows which quotes held", () => {
    const h = loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: [quoteBlock()] })] });
    document.querySelector(".btn-return").click();
    h.shift("revealPassage")({ ok: true, opened: false, quality: "missing" });

    // The outcome is written onto the quote and saved with the draft, not
    // held in a map that dies with the tab. The save is debounced.
    globalThis.ReadTrailSidePanel.draftView.flushSave();
    const saved = h.messages.filter((m) => m.type === "updateDraft").at(-1);
    expect(saved.blocks[0].checked).toEqual({ quality: "missing", at: expect.any(Number) });
  });

  // The fix that persisted outcomes only persisted the good ones, so deleting
  // a clip left "found exactly" on the quote and the next render read it back.
  it("writes down a gone clip, so no later render can claim the quote still holds", () => {
    const h = loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [quoteBlock({ checked: { quality: "exact", at: Date.now() - 60 * 1000 } })] })]
    });
    document.querySelector(".btn-return").click();
    h.shift("revealPassage")({ ok: false, error: "not-found" });

    const verdict = document.querySelector(".quote-block .quote-verdict");
    expect(verdict.textContent).toContain("no longer in your library");
    expect(verdict.dataset.quality).toBe("missing");

    // The stored value is the thing that outlives this render, so that is what
    // the guard asserts.
    globalThis.ReadTrailSidePanel.draftView.flushSave();
    const saved = h.messages.filter((m) => m.type === "updateDraft").at(-1);
    expect(saved.blocks[0].checked).toEqual({ quality: "missing", at: expect.any(Number), reason: "clip-gone" });

    // And the summary must not go on counting it as held.
    const summary = document.querySelector("#draftSummary");
    expect(summary.textContent).toBe("1 of 1 quote checked: 1 no longer linked to a clip.");
    expect(summary.dataset.state).toBe("mixed");

    // The defect only appeared on the next rebuild, so the shallow assertion
    // above is not enough: force one the way a reader does.
    document.querySelector(".quote-block .btn-insert-below").click();
    const after = document.querySelector(".quote-block .quote-verdict");
    expect(after.textContent).toContain("no longer in your library");
    expect(after.textContent).not.toContain("Found exactly");
    expect(after.dataset.quality).toBe("missing");
    // Nothing should offer a Return that is now certain to fail.
    expect(document.querySelector(".quote-block .btn-return")).toBeNull();
  });

  it("leaves the last real outcome standing when it is the page that would not open", () => {
    const h = loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [quoteBlock({ checked: { quality: "exact", at: Date.now() - 90 * 60 * 1000 } })] })]
    });
    document.querySelector(".btn-return").click();
    h.shift("revealPassage")({ ok: false, error: "reveal-unavailable" });

    expect(document.querySelector(".quote-verdict").textContent).toContain("could not open that page");

    // Failing to open a page says nothing about whether the quote holds, so
    // nothing is written and the earlier true observation survives.
    globalThis.ReadTrailSidePanel.draftView.flushSave();
    expect(h.messages.filter((m) => m.type === "updateDraft")).toHaveLength(0);

    document.querySelector(".quote-block .btn-insert-below").click();
    const after = document.querySelector(".quote-block .quote-verdict");
    expect(after.textContent).toContain("Found exactly when you last checked");
    expect(document.querySelector(".quote-block .btn-return")).not.toBeNull();
  });

  it("reads a remembered outcome back without repeating the tab clause", () => {
    loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({
        blocks: [
          quoteBlock({ checked: { quality: "exact", at: Date.now() - 90 * 60 * 1000 } }),
          quoteBlock({ passageId: "passage-2", checked: { quality: "missing", at: Date.now() - 60 * 1000 } })
        ]
      })]
    });

    const verdicts = [...document.querySelectorAll(".quote-verdict")];
    expect(verdicts[0].hidden).toBe(false);
    expect(verdicts[0].textContent).toContain("Found exactly when you last checked");
    expect(verdicts[0].textContent).toContain("hour");
    expect(verdicts[0].textContent).not.toContain("tab");
    expect(verdicts[1].dataset.quality).toBe("missing");

    // And the draft can say how much of the argument still stands.
    const summary = document.querySelector("#draftSummary");
    expect(summary.hidden).toBe(false);
    expect(summary.textContent).toBe("2 of 2 quotes checked: 1 found exactly, 1 not found.");
    // Gold means what the reader kept, so a result with anything missing
    // must not wear it.
    expect(summary.dataset.state).toBe("mixed");
  });

  it("counts only the quotes it actually checked, and says how many it did not", () => {
    const h = loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [quoteBlock(), quoteBlock({ passageId: "passage-2" }), quoteBlock({ passageId: "passage-3" })] })]
    });
    document.querySelectorAll(".btn-return")[0].click();
    h.shift("revealPassage")({ ok: true, opened: false, quality: "approximate" });

    // Reporting one checked quote against all three claimed something about
    // two the product never looked at.
    const summary = document.querySelector("#draftSummary");
    expect(summary.textContent).toBe("1 of 3 quotes checked: 1 found by wording. 2 not checked yet.");
    expect(summary.dataset.state).toBe("mixed");
  });

  // A quote block carried six equal chips; Return, the reason a quote exists,
  // was the smallest of them. At rest it now offers its source, its way back,
  // and one control for everything else.
  it("offers only the source, Return, and one options control on a quote at rest", () => {
    loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: [quoteBlock(), { type: "text", text: "mine" }] })] });
    const quote = document.querySelector(".quote-block");
    const offered = [...quote.querySelectorAll("a[href], button")].filter((el) => !el.closest("[hidden]"));
    expect(offered.map((el) => el.className)).toEqual([
      "quote-source-link btn-open-source",
      "btn-return",
      "block-options-toggle"
    ]);

    // The source title is a real link to the page, so it behaves like one.
    const link = quote.querySelector(".quote-source-link");
    expect(link.getAttribute("href")).toBe(quoteBlock().url);
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    expect(link.textContent).toContain("opens the page in a new tab");

    // Two quotes of one page were two buttons both named "Return".
    expect(quote.querySelector(".btn-return").getAttribute("aria-label"))
      .toBe("Return to the passage quoted in block 1 of 2");
  });

  it("opens one block's options at a time, and Escape hands focus back", () => {
    loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: [quoteBlock(), { type: "text", text: "mine" }] })] });
    const [firstToggle, secondToggle] = document.querySelectorAll(".block-options-toggle");
    const rowOf = (toggle) => document.getElementById(toggle.getAttribute("aria-controls"));
    expect(firstToggle.getAttribute("aria-expanded")).toBe("false");
    expect(rowOf(firstToggle).hidden).toBe(true);

    firstToggle.click();
    expect(firstToggle.getAttribute("aria-expanded")).toBe("true");
    expect(rowOf(firstToggle).hidden).toBe(false);
    // Each action says its shortcut where it is used, and exposes it to
    // assistive technology too.
    expect(rowOf(firstToggle).querySelector(".btn-move-down").getAttribute("aria-keyshortcuts")).toBe("Alt+ArrowDown");
    expect(rowOf(firstToggle).querySelector(".btn-move-down kbd").textContent).toBe("Alt ↓");
    // Each visible label begins its accessible name, so voice control can
    // match what the reader sees.
    expect(rowOf(firstToggle).querySelector(".btn-move-down").getAttribute("aria-label").startsWith("Move down")).toBe(true);

    secondToggle.click();
    expect(firstToggle.getAttribute("aria-expanded")).toBe("false");
    expect(rowOf(firstToggle).hidden).toBe(true);
    expect(rowOf(secondToggle).hidden).toBe(false);

    const inside = rowOf(secondToggle).querySelector(".btn-insert-below");
    inside.focus();
    inside.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(rowOf(secondToggle).hidden).toBe(true);
    expect(document.activeElement).toBe(secondToggle);
  });

  it("keeps the options open on a moved block so the same move can be pressed again", () => {
    loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [{ type: "text", text: "a" }, { type: "text", text: "b" }, { type: "text", text: "c" }] })]
    });
    const third = document.querySelectorAll(".draft-block")[2];
    third.querySelector(".block-options-toggle").click();
    third.querySelector(".btn-move-up").click();

    const moved = document.querySelectorAll(".draft-block")[1];
    expect(moved.querySelector(".block-text").value).toBe("c");
    expect(moved.querySelector(".block-options").hidden).toBe(false);
    expect(document.activeElement).toBe(moved.querySelector(".btn-move-up"));
  });

  // A quote has no textarea, so a keyboard move asked for one, found nothing,
  // and left focus on the page.
  it("keeps focus on Return when a quote is moved from the keyboard", () => {
    loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: [{ type: "text", text: "intro" }, quoteBlock()] })] });
    const back = document.querySelector(".btn-return");
    back.focus();
    back.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true, cancelable: true }));

    const first = document.querySelectorAll(".draft-block")[0];
    expect(first.classList.contains("quote-block")).toBe(true);
    expect(document.activeElement).toBe(first.querySelector(".btn-return"));
  });

  it("adds text below a quote from the keyboard, once", () => {
    loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: [quoteBlock()] })] });
    const back = document.querySelector(".btn-return");
    back.focus();
    back.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    const blocks = document.querySelectorAll(".draft-block");
    expect(blocks).toHaveLength(2);
    expect(blocks[1].classList.contains("text-block")).toBe(true);
    expect(document.activeElement).toBe(blocks[1].querySelector(".block-text"));
  });

  it("puts Remove last in the row and marks it as the destructive one", () => {
    loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: [quoteBlock()] })] });
    const row = document.querySelector(".block-options");
    const buttons = [...row.querySelectorAll("button")];
    expect(buttons.at(-1).classList.contains("btn-remove-block")).toBe(true);
    expect(buttons.at(-1).classList.contains("btn-danger")).toBe(true);
    expect(buttons.slice(0, -1).every((button) => button.classList.contains("btn-ghost"))).toBe(true);
    expect(buttons.at(-1).getAttribute("aria-label")).toBe("Remove quote in block 1 of 1");
  });

  // When the offer expired while it held focus, the reader was dropped to the
  // top of the page with nothing said.
  it("lands focus beside the gap when the undo offer expires", () => {
    vi.useFakeTimers();
    try {
      loadDesk({
        hash: "#/drafts/draft-1",
        drafts: [draft({ blocks: [{ type: "text", text: "a" }, { type: "text", text: "b" }, { type: "text", text: "c" }] })]
      });
      document.querySelectorAll(".draft-block")[1].querySelector(".btn-remove-block").click();
      const undo = document.querySelector("#draftUndo");
      expect(document.activeElement).toBe(undo);

      vi.advanceTimersByTime(13000);
      expect(undo.hidden).toBe(true);
      expect(document.querySelector(".draft-undo-slot")).toBeNull();
      expect(document.activeElement).toBe(document.querySelectorAll(".draft-block")[1].querySelector(".block-options-toggle"));
    } finally {
      vi.useRealTimers();
    }
  });

  // The offer belonged to no draft in particular, so leaving the draft carried
  // it into the next one, where pressing it restored the old draft's block.
  it("withdraws the undo offer when the reader opens another draft", () => {
    const h = loadDesk({
      hash: "#/drafts/draft-a",
      drafts: [
        draft({ id: "draft-a", title: "Draft A", blocks: [{ type: "text", text: "a1" }, quoteBlock()] }),
        draft({ id: "draft-b", title: "Draft B", blocks: [{ type: "text", text: "b1" }] })
      ]
    });
    document.querySelector(".quote-block .btn-remove-block").click();
    const undo = document.querySelector("#draftUndo");
    expect(undo.hidden).toBe(false);

    document.querySelector('.draft-row[data-id="draft-b"] .draft-open').click();
    expect(undo.hidden).toBe(true);
    expect(document.querySelector(".draft-undo-slot")).toBeNull();

    // Even a press that somehow reached it must not write A's quote into B.
    undo.click();
    expect(document.querySelectorAll(".quote-block")).toHaveLength(0);
    globalThis.ReadTrailSidePanel.draftView.flushSave();
    const writesToB = h.messages.filter((m) => m.type === "updateDraft" && m.id === "draft-b");
    expect(writesToB.every((m) => m.blocks.every((b) => b.type !== "quote"))).toBe(true);
  });

  // On a link, Ctrl or Command with Enter opens it in a background tab. The
  // source title became a link, so the block must leave that gesture alone.
  it("leaves Ctrl and Enter on the source link to the browser", () => {
    loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: [quoteBlock()] })] });
    const link = document.querySelector(".quote-source-link");
    link.focus();
    const event = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(document.querySelectorAll(".draft-block")).toHaveLength(1);
  });

  // A disclosure animates when it is opened, never when a render recreates it
  // already open, or every Move press drops the row in again.
  it("animates the options row on opening only, not on the rebuild a move causes", () => {
    loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [{ type: "text", text: "a" }, { type: "text", text: "b" }] })]
    });
    const second = document.querySelectorAll(".draft-block")[1];
    second.querySelector(".block-options-toggle").click();
    expect(second.querySelector(".block-options").classList.contains("just-opened")).toBe(true);

    second.querySelector(".btn-move-up").click();
    const moved = document.querySelectorAll(".draft-block")[0];
    expect(moved.querySelector(".block-options").hidden).toBe(false);
    expect(moved.querySelector(".block-options").classList.contains("just-opened")).toBe(false);
  });

  it("keeps focus in the open row when a keyboard move reaches an edge", () => {
    loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [{ type: "text", text: "a" }, { type: "text", text: "b" }] })]
    });
    const second = document.querySelectorAll(".draft-block")[1];
    second.querySelector(".block-options-toggle").click();
    const up = second.querySelector(".btn-move-up");
    up.focus();
    up.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true, cancelable: true }));

    // Now first, so Move up is disabled; focus takes the inverse rather than
    // falling out of the row to the writing area.
    const moved = document.querySelectorAll(".draft-block")[0];
    expect(moved.querySelector(".block-text").value).toBe("b");
    expect(document.activeElement).toBe(moved.querySelector(".btn-move-down"));
  });

  it("returns focus to Return, not the citation link, when a quote is restored", () => {
    loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: [{ type: "text", text: "a" }, quoteBlock()] })] });
    document.querySelector(".quote-block .btn-remove-block").click();
    document.querySelector("#draftUndo").click();
    expect(document.activeElement).toBe(document.querySelector(".quote-block .btn-return"));
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

  it("restores the last block of a draft in place of the placeholder, not beside it", () => {
    const h = loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [{ type: "text", text: "" }, quoteBlock()] })]
    });
    document.querySelectorAll(".draft-block")[1].querySelector(".btn-remove-block").click();
    document.querySelector("#draftUndo").click();

    // The index was clamped before the empty placeholder was dropped, so the
    // restored block landed past the end of an empty list and one of the two
    // blocks was lost for good.
    const kinds = [...document.querySelectorAll(".draft-block")].map((b) => (b.classList.contains("quote-block") ? "quote" : "text"));
    expect(kinds).toEqual(["text", "quote"]);
    void h;
  });

  it("keeps the caret and the undo offer when its own save comes back", () => {
    const h = loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [{ type: "text", text: "one" }, { type: "text", text: "two" }] })]
    });
    document.querySelectorAll(".draft-block")[1].querySelector(".btn-remove-block").click();
    // It sits in the gap the block left, inside a list item: a bare button
    // in an <ol> is a list child a screen reader cannot count as an item.
    expect(document.querySelector("#draftUndo").parentElement.tagName).toBe("LI");
    expect(document.querySelector("#draftUndo").parentElement.parentElement.id).toBe("draftBlocks");

    // A storage change fires in the page that caused it, so the Desk reloads
    // after its own save. Rebuilding then took the caret out of the block the
    // reader was typing in and wiped the undo offer out of the DOM.
    const area = document.querySelector(".block-text");
    area.focus();
    vi.useFakeTimers();
    h.emitStorage({ "readtrail.draft.v1:draft-1": { newValue: {} } });
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    h.shift("listDrafts")({ ok: true, drafts: [draft({ blocks: [{ type: "text", text: "one" }] })] });

    expect(document.activeElement).toBe(area);
    expect(document.querySelector("#draftUndo")).not.toBeNull();
  });

  it("focuses the way out of a draft removal, and closes it on Escape", () => {
    const h = loadDesk({ drafts: [draft({ blocks: [quoteBlock()] })] });
    document.querySelector(".btn-remove-draft").click();
    const box = document.querySelector(".draft-row .item-confirm");
    expect(document.activeElement).toBe(box.querySelector(".btn-ghost"));

    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".draft-row .item-confirm")).toBeNull();
    expect(h.messages).not.toContainEqual({ type: "removeDraft", id: "draft-1" });
  });

  it("moves a quote block from its own controls, which have no textarea", () => {
    loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [{ type: "text", text: "intro" }, quoteBlock()] })]
    });
    const quote = document.querySelector(".quote-block");
    quote.querySelector(".btn-return").focus();
    quote.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }));

    const blocks = [...document.querySelectorAll(".draft-block")];
    expect(blocks[0].classList.contains("quote-block")).toBe(true);
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

  // The guard above resolves Return before moving the block, so it never saw
  // the race: the callback kept a numeric index, and by the time the answer
  // arrived that index belonged to a different quote.
  it("gives a delayed Return answer to the quote that asked, not the one now in its place", () => {
    const h = loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [quoteBlock(), quoteBlock({ passageId: "passage-2", text: "A different clip." })] })]
    });

    // Ask on the first quote, then move it below the second before the worker
    // answers.
    document.querySelectorAll(".btn-return")[0].click();
    document.querySelectorAll(".quote-block .btn-move-down")[0].click();
    h.shift("revealPassage")({ ok: true, opened: false, quality: "exact" });

    const blocks = [...document.querySelectorAll(".quote-block")];
    const moved = blocks.find((block) => block.querySelector(".passage-text").textContent === quoteBlock().text);
    const other = blocks.find((block) => block.querySelector(".passage-text").textContent === "A different clip.");
    expect(moved.querySelector(".quote-verdict").hidden).toBe(false);
    expect(moved.querySelector(".quote-verdict").dataset.quality).toBe("exact");
    expect(other.querySelector(".quote-verdict").hidden).toBe(true);

    // And the stored outcome is on the quote that was checked.
    globalThis.ReadTrailSidePanel.draftView.flushSave();
    const saved = h.messages.filter((m) => m.type === "updateDraft").at(-1);
    const byId = Object.fromEntries(saved.blocks.map((b) => [b.passageId, b.checked]));
    expect(byId["passage-1"]).toEqual({ quality: "exact", at: expect.any(Number) });
    expect(byId["passage-2"]).toBeUndefined();
  });

  it("drops a Return answer that arrives after the reader opened another draft", () => {
    const h = loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [quoteBlock()] }), draft({ id: "draft-2", title: "Other", blocks: [quoteBlock({ passageId: "passage-9" })] })]
    });
    document.querySelector(".btn-return").click();
    document.querySelector('.draft-row[data-id="draft-2"] .draft-open').click();
    h.shift("revealPassage")({ ok: true, opened: false, quality: "exact" });

    // Nothing in the draft now on screen was checked, so nothing may claim it.
    expect(document.querySelector(".quote-block .quote-verdict").hidden).toBe(true);
    expect(document.querySelector("#draftSummary").hidden).toBe(true);
  });

  // A failure used to be recorded only while its draft was still on screen, so
  // editing A, switching to B and watching A's save fail lost everything A held.
  it("keeps a failed save for a draft the reader has navigated away from", () => {
    vi.useFakeTimers();
    try {
      const h = loadDesk({
        hash: "#/drafts/draft-a",
        drafts: [draft({ id: "draft-a", title: "Draft A" }), draft({ id: "draft-b", title: "Draft B" })]
      });
      const title = document.querySelector("#draftTitle");
      title.value = "Draft A edited";
      title.dispatchEvent(new Event("input"));
      vi.advanceTimersByTime(400);

      // Away to B, and only then does A's save come back a failure.
      document.querySelector('.draft-row[data-id="draft-b"] .draft-open').click();
      h.shift("updateDraft")({ ok: false, error: "storage-full" });

      // The reader is told which draft, because they are looking at another one.
      expect(document.querySelector("#draftStatus").textContent).toContain("Draft A edited");
      // And the index says that draft is not saved.
      const rowA = document.querySelector('.draft-row[data-id="draft-a"]');
      expect(rowA.dataset.unsaved).toBe("true");
      expect(rowA.textContent).toContain("not saved");

      // Reopening A retries it instead of resetting the state and stranding it.
      const before = h.messages.filter((m) => m.type === "updateDraft").length;
      document.querySelector('.draft-row[data-id="draft-a"] .draft-open').click();
      const retried = h.messages.filter((m) => m.type === "updateDraft");
      expect(retried).toHaveLength(before + 1);
      expect(retried.at(-1).title).toBe("Draft A edited");

      h.shift("updateDraft")({ ok: true, draft: { ...draft({ id: "draft-a", title: "Draft A edited" }), updatedAt: 2 } });
      expect(document.querySelector('.draft-row[data-id="draft-a"]').dataset.unsaved).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
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

  // --- Taking the draft out (Sprint 009) ---

  // Microtasks only: a timer here lets the hashchange listeners of earlier
  // Desk instances in this file fire first and re-open the draft, which
  // clears the status line that the assertion is about.
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };
  const withClipboard = (impl) => {
    const writeText = vi.fn(impl);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    return writeText;
  };
  const withoutClipboard = () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  };
  // A failed assertion must not leave a stub clipboard for the tests after it.
  afterEach(withoutClipboard);

  it("copies the draft on screen as Markdown, unsaved edits included, and says so", async () => {
    const h = loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: [quoteBlock(), { type: "text", text: "mine" }] })] });
    const writeText = withClipboard(() => Promise.resolve());
    const area = document.querySelector(".block-text");
    area.value = "Edited, not yet saved.";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    const sent = h.messages.length;

    document.querySelector("#draftCopyMarkdown").click();
    await settle();

    expect(writeText).toHaveBeenCalledTimes(1);
    const markdown = writeText.mock.calls[0][0];
    expect(markdown.startsWith("# Working question\n\n> A useful piece of evidence.\n>\n> — Source page [1]\n\nEdited, not yet saved.\n\n## Sources\n")).toBe(true);
    const status = document.querySelector("#draftStatus");
    expect(status.textContent).toBe("Copied the draft as Markdown.");
    expect(status.getAttribute("role")).toBe("status");
    // Nothing is read from a page or written anywhere to produce the text.
    expect(h.messages.length).toBe(sent);
    withoutClipboard();
  });

  it("says so with an alert, and names the download, when the clipboard is missing or refuses", async () => {
    loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: [quoteBlock()] })] });
    const status = document.querySelector("#draftStatus");

    withoutClipboard();
    document.querySelector("#draftCopyMarkdown").click();
    await settle();
    expect(status.getAttribute("role")).toBe("alert");
    expect(status.textContent).toContain("Download .md");

    withClipboard(() => Promise.reject(new Error("denied")));
    document.querySelector("#draftCopyMarkdown").click();
    await settle();
    expect(status.getAttribute("role")).toBe("alert");
    expect(status.textContent).toContain("Could not copy");
    expect(status.textContent).toContain("Download .md");
    withoutClipboard();
  });

  it("downloads the draft as a Markdown file named from its title", () => {
    loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ title: "Do passkeys work across ecosystems?", blocks: [quoteBlock()] })] });
    if (typeof URL.createObjectURL !== "function") URL.createObjectURL = () => "blob:stub";
    if (typeof URL.revokeObjectURL !== "function") URL.revokeObjectURL = () => {};
    const blobs = [];
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob);
      return "blob:mock-url";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const downloads = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      downloads.push({ download: this.download, href: this.href });
    });

    document.querySelector("#draftDownloadMarkdown").click();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(blobs[0].type).toBe("text/markdown");
    expect(downloads).toEqual([{ download: "do-passkeys-work-across-ecosystems.md", href: "blob:mock-url" }]);
    expect(document.querySelector("#draftStatus").textContent).toBe("Asked Chrome to save do-passkeys-work-across-ecosystems.md to your downloads.");
    click.mockRestore();
    vi.restoreAllMocks();
  });

  it("offers Copy with source in a quote's options, before Remove, and not in a text block's", async () => {
    loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: [quoteBlock(), { type: "text", text: "mine" }] })] });
    const writeText = withClipboard(() => Promise.resolve());
    const [quoteRow, textRow] = document.querySelectorAll(".block-options");
    const classes = (row) => [...row.querySelectorAll("button")].map((b) => b.className.split(" ").at(-1));
    expect(classes(quoteRow)).toEqual(["btn-move-up", "btn-move-down", "btn-insert-below", "btn-copy-quote", "btn-remove-block"]);
    expect(classes(textRow)).toEqual(["btn-move-up", "btn-move-down", "btn-insert-below", "btn-remove-block"]);
    const copy = quoteRow.querySelector(".btn-copy-quote");
    expect(copy.getAttribute("aria-label")).toBe("Copy the quote in block 1 of 2 with its source");

    copy.click();
    await settle();

    expect(writeText).toHaveBeenCalledWith("> A useful piece of evidence.\n>\n> — Source page. https://example.com/source\n");
    expect(document.querySelector("#draftStatus").textContent).toBe("Copied the quote with its source.");
    withoutClipboard();
  });

  // --- The Desk as one document (Sprint 010) ---

  const key = (target, init) => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };
  const areas = () => [...document.querySelectorAll(".block-text")];
  const caretAt = (area, start, end = start) => {
    area.focus();
    area.setSelectionRange(start, end);
  };
  const savedDrafts = (h) => {
    globalThis.ReadTrailSidePanel.draftView.flushSave();
    return h.messages.filter((m) => m.type === "updateDraft");
  };

  it("adds one empty block below with Enter at the end, and leaves the block it came from as it was", () => {
    const h = loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [{ type: "text", text: "# Findings\nFirst line" }, { type: "text", text: "Last" }] })]
    });
    // A key the textarea handles must not reach the block's handler too.
    const reached = vi.fn();
    document.querySelector("#draftBlocks").addEventListener("keydown", reached);
    const first = areas()[0];
    caretAt(first, first.value.length);

    const event = key(first, { key: "Enter" });

    expect(event.defaultPrevented).toBe(true);
    expect(reached).not.toHaveBeenCalled();
    expect(areas().map((a) => a.value)).toEqual(["# Findings\nFirst line", "", "Last"]);
    expect(document.activeElement).toBe(areas()[1]);
    const saved = savedDrafts(h);
    expect(saved).toHaveLength(1);
    expect(saved[0].blocks).toEqual([
      { type: "text", text: "# Findings\nFirst line" },
      { type: "text", text: "" },
      { type: "text", text: "Last" }
    ]);
  });

  it.each([
    ["Shift with Enter", { key: "Enter", shiftKey: true }, 11],
    ["Enter mid-text", { key: "Enter" }, 5],
    ["Enter during composition", { key: "Enter", isComposing: true }, 11]
  ])("leaves %s to the browser as a line break", (_, init, caret) => {
    loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: [{ type: "text", text: "Hello world" }] })] });
    const area = areas()[0];
    caretAt(area, caret);
    expect(key(area, init).defaultPrevented).toBe(false);
    expect(document.querySelectorAll(".draft-block")).toHaveLength(1);
  });

  it("leaves Enter over a selection to the browser", () => {
    loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: [{ type: "text", text: "Hello world" }] })] });
    const area = areas()[0];
    caretAt(area, 6, 11);
    expect(key(area, { key: "Enter" }).defaultPrevented).toBe(false);
    expect(document.querySelectorAll(".draft-block")).toHaveLength(1);
  });

  it("says so with an alert at the block limit, and changes nothing", () => {
    loadDesk();
    const max = globalThis.ReadTrailShared.LIMITS.DRAFT_BLOCKS_MAX;
    const blocks = Array.from({ length: max }, (_, i) => ({ type: "text", text: `Block ${i}` }));
    const h = loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks })] });
    const last = areas().at(-1);
    caretAt(last, last.value.length);

    // Prevented all the same: a line break would change the block.
    expect(key(last, { key: "Enter" }).defaultPrevented).toBe(true);

    const status = document.querySelector("#draftStatus");
    expect(status.textContent).toBe("This draft has as many blocks as it can hold.");
    expect(status.getAttribute("role")).toBe("alert");
    expect(document.querySelectorAll(".draft-block")).toHaveLength(max);
    expect(last.value).toBe(`Block ${max - 1}`);
    expect(savedDrafts(h)).toHaveLength(0);
  });

  it("removes an empty block quietly with Backspace, with the caret at the end of the text above", () => {
    const h = loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [{ type: "text", text: "Above" }, quoteBlock(), { type: "text", text: "" }, { type: "text", text: "" }] })]
    });
    // Something already in the status line, which the removal must not touch.
    withoutClipboard();
    document.querySelector("#draftCopyMarkdown").click();
    const status = document.querySelector("#draftStatus");
    const before = { text: status.textContent, role: status.getAttribute("role"), hidden: status.hidden };
    const reached = vi.fn();
    document.querySelector("#draftBlocks").addEventListener("keydown", reached);

    const event = key(areas()[1], { key: "Backspace" });

    expect(event.defaultPrevented).toBe(true);
    expect(reached).not.toHaveBeenCalled();
    // One press, one block, and the quote between is stepped over.
    expect(areas().map((a) => a.value)).toEqual(["Above", ""]);
    expect(document.querySelectorAll(".quote-block")).toHaveLength(1);
    expect(document.querySelector("#draftLive").textContent).toBe("Empty block removed.");
    const above = areas()[0];
    expect(document.activeElement).toBe(above);
    expect([above.selectionStart, above.selectionEnd]).toEqual([5, 5]);
    // No undo offer, nothing pulled away from the writing.
    expect(document.querySelector("#draftUndo").hidden).toBe(true);
    expect(document.querySelector(".draft-undo-slot")).toBeNull();
    expect({ text: status.textContent, role: status.getAttribute("role"), hidden: status.hidden }).toEqual(before);
    expect(above.closest(".draft-block").classList.contains("just-changed")).toBe(false);
    const saved = savedDrafts(h);
    expect(saved).toHaveLength(1);
    expect(saved[0].blocks.map((b) => b.type)).toEqual(["text", "quote", "text"]);
  });

  it("lands on the quote's Return, or its options without one, when only quotes are above", () => {
    loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: [quoteBlock(), { type: "text", text: "" }] })] });
    key(areas()[0], { key: "Backspace" });
    expect(document.querySelectorAll(".draft-block")).toHaveLength(1);
    expect(document.activeElement).toBe(document.querySelector(".quote-block .btn-return"));

    // A quote whose clip is gone has no Return, and the citation link would
    // turn the next Enter into a new tab.
    loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [quoteBlock({ checked: { quality: "missing", at: 1, reason: "clip-gone" } }), { type: "text", text: "" }] })]
    });
    key(areas()[0], { key: "Backspace" });
    expect(document.activeElement).toBe(document.querySelector(".quote-block .block-options-toggle"));
    expect(document.activeElement.closest(".passage-text")).toBeNull();
  });

  it("leaves Backspace to the browser in a block with text or in the first block", () => {
    loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: [{ type: "text", text: "" }, { type: "text", text: "x" }] })] });
    expect(key(areas()[0], { key: "Backspace" }).defaultPrevented).toBe(false);
    caretAt(areas()[1], 1);
    expect(key(areas()[1], { key: "Backspace" }).defaultPrevented).toBe(false);
    caretAt(areas()[1], 0, 1);
    expect(key(areas()[1], { key: "Backspace" }).defaultPrevented).toBe(false);
    expect(document.querySelectorAll(".draft-block")).toHaveLength(2);
    expect(document.querySelector("#draftLive").textContent).toBe("");
  });

  it("crosses into the nearest text block with Up at the start and Down at the end, over quotes", () => {
    const h = loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [{ type: "text", text: "One" }, quoteBlock(), quoteBlock({ passageId: "passage-2" }), { type: "text", text: "Two" }] })]
    });
    const reached = vi.fn();
    document.querySelector("#draftBlocks").addEventListener("keydown", reached);
    const [one, two] = areas();

    caretAt(two, 0);
    expect(key(two, { key: "ArrowUp" }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(one);
    expect([one.selectionStart, one.selectionEnd]).toEqual([3, 3]);

    expect(key(one, { key: "ArrowDown" }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(two);
    expect([two.selectionStart, two.selectionEnd]).toEqual([0, 0]);

    // Crossing changes nothing in the draft and never lands in a quote.
    expect(reached).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".draft-block")).toHaveLength(4);
    expect(savedDrafts(h)).toHaveLength(0);
  });

  it("leaves Up and Down alone away from the edge, with Shift, over a selection, or with no text block that way", () => {
    loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [{ type: "text", text: "abc" }, { type: "text", text: "def" }] })]
    });
    const [first, second] = areas();
    const stays = (area, init, start, end) => {
      caretAt(area, start, end);
      expect(key(area, init).defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(area);
    };
    stays(second, { key: "ArrowUp" }, 1);
    stays(second, { key: "ArrowUp", shiftKey: true }, 0);
    stays(second, { key: "ArrowUp" }, 0, 2);
    stays(first, { key: "ArrowDown" }, 2);
    stays(first, { key: "ArrowDown", shiftKey: true }, 3);
    // The first and last blocks have nothing to cross to.
    stays(first, { key: "ArrowUp" }, 0);
    stays(second, { key: "ArrowDown" }, 3);

    loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: [quoteBlock(), { type: "text", text: "mid" }, quoteBlock()] })] });
    const middle = areas()[0];
    stays(middle, { key: "ArrowUp" }, 0);
    stays(middle, { key: "ArrowDown" }, 3);
  });

  // JSDOM does no layout, so each block is given a 80px box every 100px.
  const stubRects = () => document.querySelectorAll(".draft-block").forEach((node, i) => {
    node.getBoundingClientRect = () => ({ top: i * 100, bottom: i * 100 + 80, height: 80, left: 0, right: 300, width: 300, x: 0, y: i * 100 });
  });
  const pointer = (target, type, y, init = {}) => {
    const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, isPrimary: true, button: 0, clientX: 20, clientY: y, ...init });
    target.dispatchEvent(event);
    return event;
  };
  const handleOf = (index) => document.querySelectorAll(".draft-block")[index].querySelector(".block-handle");
  const order = () => [...document.querySelectorAll(".draft-block")]
    .map((b) => (b.classList.contains("quote-block") ? "quote" : b.querySelector(".block-text").value));
  const marks = () => document.querySelectorAll(".is-lifted, .drop-before, .drop-after").length;

  it("drags a block by its handle to the line, through the same move as the options row", () => {
    const h = loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [{ type: "text", text: "a" }, { type: "text", text: "b" }, quoteBlock()] })]
    });
    stubRects();
    const handle = handleOf(2);
    expect(pointer(handle, "pointerdown", 210).defaultPrevented).toBe(true);
    // Under four pixels it is still a press.
    pointer(handle, "pointermove", 213);
    expect(marks()).toBe(0);

    pointer(handle, "pointermove", 30);
    const blocks = document.querySelectorAll(".draft-block");
    expect(blocks[2].classList.contains("is-lifted")).toBe(true);
    expect(blocks[0].classList.contains("drop-before")).toBe(true);
    pointer(handle, "pointerup", 30);

    expect(order()).toEqual(["quote", "a", "b"]);
    expect(marks()).toBe(0);
    expect(document.querySelector("#draftLive").textContent).toBe("Moved to position 1 of 3.");
    // Focus keeps the reader on the moved block without opening its options,
    // and not in a textarea, which would raise a touch keyboard.
    expect(document.querySelector('.block-options-toggle[aria-expanded="true"]')).toBeNull();
    expect(document.activeElement).toBe(document.querySelector(".quote-block .block-options-toggle"));
    const saved = savedDrafts(h);
    expect(saved).toHaveLength(1);
    expect(saved[0].blocks.map((b) => b.type)).toEqual(["quote", "text", "text"]);

    // To the end of the list, past the last block's middle.
    stubRects();
    const first = handleOf(0);
    pointer(first, "pointerdown", 10);
    pointer(first, "pointermove", 260);
    expect(document.querySelectorAll(".draft-block")[2].classList.contains("drop-after")).toBe(true);
    pointer(first, "pointerup", 260);
    expect(order()).toEqual(["a", "b", "quote"]);
    expect(document.activeElement).toBe(document.querySelector(".quote-block .block-options-toggle"));
  });

  it("puts the block back on a drop where it started, on Escape, and on pointercancel, and saves nothing", () => {
    const h = loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [{ type: "text", text: "a" }, { type: "text", text: "b" }, { type: "text", text: "c" }] })]
    });
    stubRects();
    const handle = handleOf(1);
    // Either gap beside the block leaves it where it is, so no line shows.
    pointer(handle, "pointerdown", 110);
    pointer(handle, "pointermove", 160);
    expect(document.querySelectorAll(".draft-block")[1].classList.contains("is-lifted")).toBe(true);
    expect(document.querySelectorAll(".drop-before, .drop-after")).toHaveLength(0);
    pointer(handle, "pointerup", 160);
    expect(order()).toEqual(["a", "b", "c"]);
    expect(marks()).toBe(0);

    // Escape during a drag belongs to the drag: an open options row keeps
    // its place.
    const toggle = document.querySelectorAll(".block-options-toggle")[1];
    toggle.click();
    const inRow = document.querySelectorAll(".block-options")[1].querySelector(".btn-insert-below");
    inRow.focus();
    pointer(handle, "pointerdown", 110);
    pointer(handle, "pointermove", 10);
    expect(marks()).toBe(2);
    expect(key(inRow, { key: "Escape" }).defaultPrevented).toBe(true);
    expect(marks()).toBe(0);
    expect(document.querySelectorAll(".block-options")[1].hidden).toBe(false);
    pointer(handle, "pointerup", 10);
    expect(order()).toEqual(["a", "b", "c"]);

    pointer(handle, "pointerdown", 110);
    pointer(handle, "pointermove", 290);
    expect(marks()).toBe(2);
    pointer(handle, "pointercancel", 290);
    expect(marks()).toBe(0);
    pointer(handle, "pointerup", 290);
    expect(order()).toEqual(["a", "b", "c"]);

    // A window that loses focus mid-drag may never see the release, and the
    // next click anywhere must not finish the drag.
    pointer(handle, "pointerdown", 110);
    pointer(handle, "pointermove", 10);
    window.dispatchEvent(new Event("blur"));
    expect(marks()).toBe(0);
    pointer(document.body, "pointerup", 10);
    expect(order()).toEqual(["a", "b", "c"]);
    // So may a handle that loses its pointer capture.
    pointer(handle, "pointerdown", 110);
    pointer(handle, "pointermove", 10);
    pointer(handle, "lostpointercapture", 10);
    expect(marks()).toBe(0);
    pointer(document.body, "pointerup", 10);
    expect(order()).toEqual(["a", "b", "c"]);

    expect(document.querySelector("#draftLive").textContent).toBe("");
    expect(savedDrafts(h)).toHaveLength(0);
  });

  it("drags only from the handle, so a press in the text still belongs to the text", () => {
    const h = loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [{ type: "text", text: "a" }, { type: "text", text: "b" }] })]
    });
    stubRects();
    const area = areas()[1];
    expect(pointer(area, "pointerdown", 110).defaultPrevented).toBe(false);
    pointer(area, "pointermove", 10);
    pointer(area, "pointerup", 10);
    expect(marks()).toBe(0);
    expect(order()).toEqual(["a", "b"]);
    // Only the primary button lifts a block.
    pointer(handleOf(1), "pointerdown", 110, { button: 2 });
    pointer(handleOf(1), "pointermove", 10);
    pointer(handleOf(1), "pointerup", 10);
    expect(order()).toEqual(["a", "b"]);
    expect(savedDrafts(h)).toHaveLength(0);
  });

  it("keeps the handle out of the tab order and away from assistive technology", () => {
    loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: [quoteBlock(), { type: "text", text: "mine" }] })] });
    for (const block of document.querySelectorAll(".draft-block")) {
      const handles = block.querySelectorAll(".block-handle");
      expect(handles).toHaveLength(1);
      expect(handles[0].tagName).toBe("SPAN");
      expect(handles[0].getAttribute("aria-hidden")).toBe("true");
      expect(handles[0].hasAttribute("tabindex")).toBe(false);
      expect(handles[0].hasAttribute("role")).toBe(false);
    }
    // A quote at rest still has exactly three tab stops (decision 81).
    const quote = document.querySelector(".quote-block");
    const stops = [...quote.querySelectorAll("a[href], button, textarea, [tabindex]:not([tabindex='-1'])")]
      .filter((el) => !el.closest("[hidden]"));
    expect(stops).toHaveLength(3);

    // A draft of one block has nowhere to drag it, so it offers no handle.
    loadDesk({ hash: "#/drafts/draft-1", drafts: [draft()] });
    expect(document.querySelector(".block-handle")).toBeNull();
  });

  it("keeps a standing undo offer in its gap when Backspace removes an empty block above it", () => {
    loadDesk({
      hash: "#/drafts/draft-1",
      drafts: [draft({ blocks: [{ type: "text", text: "A" }, { type: "text", text: "" }, { type: "text", text: "X" }, { type: "text", text: "B" }] })]
    });
    document.querySelectorAll(".draft-block")[2].querySelector(".btn-remove-block").click();
    key(areas()[1], { key: "Backspace" });
    expect(areas().map((a) => a.value)).toEqual(["A", "B"]);
    // The offer still sits between A and B, and restores X there.
    const slot = document.querySelector(".draft-undo-slot");
    expect(slot.previousElementSibling.querySelector(".block-text").value).toBe("A");
    document.querySelector("#draftUndo").click();
    expect(areas().map((a) => a.value)).toEqual(["A", "X", "B"]);
  });

  it("keeps a standing undo offer in its gap when Enter adds a block or a block moves across it", () => {
    const blocks = (texts) => texts.map((text) => ({ type: "text", text }));
    loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: blocks(["A", "X", "B"]) })] });
    document.querySelectorAll(".draft-block")[1].querySelector(".btn-remove-block").click();
    areas()[0].setSelectionRange(1, 1);
    key(areas()[0], { key: "Enter" });
    // The new block sits under A, where the caret was, and X still goes back before B.
    document.querySelector("#draftUndo").click();
    expect(areas().map((a) => a.value)).toEqual(["A", "", "X", "B"]);

    loadDesk({ hash: "#/drafts/draft-1", drafts: [draft({ blocks: blocks(["A", "B", "X", "C"]) })] });
    document.querySelectorAll(".draft-block")[2].querySelector(".btn-remove-block").click();
    key(areas()[1], { key: "ArrowDown", altKey: true });
    expect(areas().map((a) => a.value)).toEqual(["A", "C", "B"]);
    // B moved past the gap, so X goes back before C, the block it came before.
    document.querySelector("#draftUndo").click();
    expect(areas().map((a) => a.value)).toEqual(["A", "X", "C", "B"]);
  });

  // Round five's P0: the worker refuses a quote the stored draft no longer has,
  // so a removal saved before its Undo made that Undo, and every save after
  // it, fail.
  it("keeps a removed quote in storage while its undo is on offer, and lets it go when the offer ends", () => {
    vi.useFakeTimers();
    try {
      const blocks = [{ type: "text", text: "Before" }, quoteBlock(), { type: "text", text: "After" }];
      const h = loadDesk({ hash: "#/drafts/draft-1", passages: [passage()], drafts: [draft({ blocks })] });
      document.querySelectorAll(".draft-block")[1].querySelector(".btn-remove-block").click();
      expect(document.querySelectorAll(".quote-block")).toHaveLength(0);
      vi.advanceTimersByTime(400);
      const saves = () => h.messages.filter((m) => m.type === "updateDraft");
      expect(saves()).toHaveLength(1);
      expect(saves()[0].blocks.map((b) => b.type)).toEqual(["text", "quote", "text"]);
      h.shift("updateDraft")({ ok: true, draft: draft({ blocks: saves()[0].blocks, updatedAt: 200 }) });

      // The drafts list counts what the reader sees, not the copy kept for Undo.
      expect(document.querySelector('.draft-row[data-id="draft-1"] .item-meta').textContent).toBe("0 quotes");

      vi.advanceTimersByTime(12000 + 400);
      expect(saves()).toHaveLength(2);
      expect(saves()[1].blocks.map((b) => b.type)).toEqual(["text", "text"]);
    } finally {
      vi.useRealTimers();
    }
  });

  // Round six's P0: the stored copy holds the quote kept for Undo, so the
  // page took its own save for someone else's and rebuilt the editor,
  // dropping keystrokes and the focus on Undo.
  it("does not rebuild the editor when its own save, holding a quote kept for Undo, comes back", () => {
    vi.useFakeTimers();
    try {
      const blocks = [{ type: "text", text: "Before" }, quoteBlock(), { type: "text", text: "After" }];
      const h = loadDesk({ hash: "#/drafts/draft-1", passages: [passage()], drafts: [draft({ blocks })] });
      document.querySelectorAll(".draft-block")[1].querySelector(".btn-remove-block").click();
      expect(document.activeElement).toBe(document.querySelector("#draftUndo"));
      vi.advanceTimersByTime(400);
      const saved = h.messages.filter((m) => m.type === "updateDraft")[0];
      const stored = draft({ blocks: saved.blocks, updatedAt: 200 });
      h.shift("updateDraft")({ ok: true, draft: stored });
      const area = areas()[0];

      h.emitStorage({ "readtrail.draft.v1:draft-1": { newValue: stored } });
      vi.advanceTimersByTime(150);
      h.shift("listDrafts")({ ok: true, drafts: [stored] });

      expect(areas()[0]).toBe(area);
      expect(document.activeElement).toBe(document.querySelector("#draftUndo"));
      expect(document.querySelectorAll(".quote-block")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves a quote's removal when the reader leaves the draft while its undo is on offer", () => {
    vi.useFakeTimers();
    try {
      const first = draft({ id: "draft-a", title: "Draft A", blocks: [{ type: "text", text: "Before" }, quoteBlock()] });
      const second = draft({ id: "draft-b", title: "Draft B" });
      const h = loadDesk({ hash: "#/drafts/draft-a", passages: [passage()], drafts: [first, second] });
      document.querySelectorAll(".draft-block")[1].querySelector(".btn-remove-block").click();
      vi.advanceTimersByTime(400);
      const saves = () => h.messages.filter((m) => m.type === "updateDraft");
      h.shift("updateDraft")({ ok: true, draft: { ...first, updatedAt: 200 } });

      document.querySelector('.draft-row[data-id="draft-b"] .draft-open').click();
      expect(saves()).toHaveLength(2);
      expect(saves()[1]).toEqual(expect.objectContaining({ id: "draft-a" }));
      expect(saves()[1].blocks.map((b) => b.type)).toEqual(["text"]);
      expect(document.querySelector("#draftUndo").hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("styles the handle with a 24px target, no touch scrolling, hidden from hit testing at rest, and no motion of its own", () => {
    const css = readSource("sidepanel/desk.css").replace(/\r\n/g, "\n");
    const rule = (selector) => {
      const at = css.indexOf(`${selector} {`);
      expect(at).toBeGreaterThanOrEqual(0);
      return css.slice(at, css.indexOf("}", at));
    };
    const handle = rule(".block-handle");
    expect(Number(handle.match(/\bwidth: (\d+)px/)[1])).toBeGreaterThanOrEqual(24);
    expect(Number(handle.match(/\bheight: (\d+)px/)[1])).toBeGreaterThanOrEqual(24);
    expect(handle).toContain("touch-action: none");
    expect(handle).toContain("visibility: hidden");
    // Always there where nothing can hover to reveal it.
    const touch = css.slice(css.indexOf("@media (hover: none) {\n  .block-handle {"));
    expect(touch.slice(0, touch.indexOf("}\n}"))).toContain("visibility: visible");
    // The global reduced-motion rule switches transitions off; nothing here
    // may escape it.
    const own = css.slice(css.indexOf(".block-handle {"), css.indexOf(".draft-block.drop-after::after {") + 60);
    expect(own).not.toContain("animation");
    expect(own).not.toContain("!important");
  });
});
