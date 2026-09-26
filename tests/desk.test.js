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
    storage: { onChanged: { addListener: vi.fn() } }
  };

  for (const source of sources) window.eval(source);

  const shift = (type) => {
    const callback = pending[type] && pending[type].shift();
    if (!callback) throw new Error(`no pending ${type} callback`);
    return callback;
  };
  shift("listLibrary")(libraryResponse(passages, pagemeta));
  shift("listDrafts")({ ok: true, drafts });
  return { messages, pending, shift, chrome: globalThis.chrome };
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

    const status = document.querySelector("#draftStatus");
    expect(status.textContent).toBe(message);
    expect(status.getAttribute("role")).toBe(role);
    expect(document.activeElement).toBe(status);
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
