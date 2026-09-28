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
});
