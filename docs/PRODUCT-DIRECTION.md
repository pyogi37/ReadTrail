# ReadTrail Product Direction (2.0)

Written 2026-09-18 by the lead after a product reset: four competing concepts, three independent judging lenses, and a synthesis. This document is the recommendation the roadmap follows. `docs/PRODUCT-VISION.md` remains the owner's compass. Where this changes a prior decision, `docs/DECISIONS.md` records it.

## 1. The primary user and their hardest problem

The primary user reads to answer a question: a graduate student working through twenty papers, an engineer reading specifications before a design decision, a writer researching an essay, an analyst comparing sources. They read in a browser with many tabs open around one question, and the question lasts days or weeks.

Their hardest problem is not storing excerpts. Every read-later tool stores excerpts. The problem is that **what they gathered loses its connection to where it came from and what it was for.** A highlight in a read-later app is an orphan a month later: no argument around it, no neighbours, and no reliable way back to the exact paragraph. In the moment, collecting competes with reading: every capture demands a filing decision that pulls the reader out of the page.

The problem ReadTrail must solve: let a reader gather evidence across many pages without filing anything, then think with that evidence in one place, with every excerpt still pointing at its exact paragraph in its source.

## 2. The product model

**Two objects, two verbs: mark a source, write a draft.**

The **source** is a page the reader has deliberately marked, identified by its exact URL. It holds everything gathered there: the saved reading place, the clips, the notes, the page's tags. This is the library committed at `a732d4c` and it does not change.

The **draft** is new and is the only cross-source object: a reader-written document made of text blocks and quote blocks. A quote block is a live reference to a clip. The draft is where the reader's question, argument, and conclusions live.

| Object | What it holds | Where it lives |
|---|---|---|
| Source | Saved place, clips, notes, tags, keyed by exact URL | Panel margin and the Desk's Sources pane |
| Clip | Text the reader selected, with two DOM anchors | Under its source |
| Draft | Title, tags, ordered blocks of text and quotes | The Desk |
| Quote | A reference to a clip, with a text snapshot | Inside a draft |

**Capture files itself.** A clip belongs to the page it came from. The reader makes no filing decision at capture time, ever. Tagging a page is optional, done once per source, and can happen later or never.

**Thinking is writing.** There is no project, collection, trail, or thread record. When the reader wants to relate sources, they write a draft and pull clips into it as quotes. Two sources are related because the reader quoted both in one draft. That relation is authored, explainable, and visible.

### Why not a trail, a canvas, or a claim

I drafted a **trail-centric** model first: a named inquiry that accumulates clips chronologically, with a current trail the reader switches. Three judging lenses rejected it on one argument I accept: *a current trail is a mode, and modes are where clips go wrong.* Forget to switch, and a week of clips lands in the wrong inquiry with no signal. Every clip carries a filing decision by proxy. That violates "capturing should be intentional" by making it consequential, and "support thought without demanding constant management" by adding a thing to manage. Chronology survives as a derived sort, which costs nothing.

A **spatial canvas** was rejected for 2.0: it taxes every capture with a placement decision, is hard to keep keyboard-accessible in plain JavaScript, and is where a LiquidText resemblance would be strongest.

A **claim-first** model (evidence tagged supports or contradicts) was rejected because it front-loads a judgment at capture time. Claims appear in ReadTrail the way they appear in real work: as sentences the reader writes in a draft.

## 3. The north-star journey

1. The reader opens a long article. ReadTrail is dormant: no listener, no canvas, no read.
2. They open the side panel: the reading-guide toggle and a capture row. Nothing else.
3. They select two sentences and choose "Save selection to ReadTrail" from the context menu. The clip is filed under this page with exact anchors and its text. No dialog.
4. Over a week they clip from five more pages. They file nothing.
5. They return to one of those pages. The panel shows what this page already contributed: two clips, each with a Return button.
6. They choose **Open desk**. A full tab opens with sources on the left and drafts on the right.
7. They press **New draft** and title it with their question: "Do passkeys work across ecosystems?"
8. On a clip they press **Quote**. A quote block appears in the draft with the text and its source. They write beneath it: "Apple-only as of 2024." They quote a contradicting clip from another page and write the contradiction.
9. They press **Return** on that quote. The source tab is still open, so it is focused and scrolled to the passage, which flashes. The status line says "Found exactly."
10. A month later the site has been edited. Return says "Found by text. The page has changed." If the passage is gone entirely: "Not found. The page may have changed. Your saved text is below." Never a silent scroll to the top.

## 4. Reading, capture, organization, synthesis

- **Reading** is untouched. The reading guide and its reading lock, the saved place, and Recently closed stay exactly as they are. They are optional aids, never prerequisites.
- **Capture** is one gesture with no filing decision. Select, then Save selection.
- **Organization** is emergent: clips sit under their page in page order, pages carry optional tags, and headings inside a draft group its quotes.
- **Synthesis** is writing a draft with the evidence beside it and every quote one click from its source.

## 5. The side panel: the margin of this page

The panel is small and is about the page in front of the reader:

1. **This page.** Guide toggle with the reading-lock notice, saved place with Continue, the clips and notes made here each with **Return**, the page tags field, exclude site.
2. **Capture.** Save selection, Add a note.
3. **Recently closed.** Unchanged.
4. **Library.** The committed Pages, Tags, and search module, collapsed. It is the fallback for a reader who never opens a full tab.
5. **Footer.** Open desk, Settings.

The panel never renders a draft body and never shows hundreds of items expanded.

## 6. The full tab: the Desk

The Desk becomes **its own document** (`sidepanel/desk.html`), not a mode of the panel. Serving a 280-pixel margin and a two-pane workspace from one file is the "two products in one file" failure, and the panel test harness would have to evaluate desk code. `sidepanel/` is already allow-listed, so packaging does not change.

At 960 pixels and wider the Desk is two panes: **Sources** on the left (the committed page cards, with a Quote button on every clip) and **Draft** on the right (the block editor). Below 960 pixels the panes stack behind a two-tab switcher. A hash router serves `#/drafts/<id>`, `#/topics/<tag>`, and `#/search?q=`.

The block editor is a form of textareas and buttons. No `contenteditable`, no rich text. A text block beginning with `# ` renders as a heading, so grouping is writing. Autosave is debounced with a visible "Saved" state.

## 7. Information architecture

```
Side panel (per window)
  This page        guide · saved place · clips and notes here (Return) · page tags · exclude site
  Capture          Save selection · Add a note
  Recently closed
  Library          (collapsed) Pages | Tags | search
  Footer           Open desk · Settings

Desk (own document, full tab)
  Sources          page cards · clips in page order · Quote per clip · tags · Continue
  Drafts           index → editor (title, tags, blocks: text | quote)
  Topics           tag → its pages and drafts
  Search           grouped by page, plus a Drafts group
  Transfer         export / import
```

Data (`chrome.storage.local`, one key per record). Every existing record keeps its shape:

```
readtrail.draft.v1:<uuid>   { version:1, id, title, tags, blocks:[
                                {type:"text", text} | {type:"quote", passageId, text, url, title}
                              ], createdAt, updatedAt }
readtrail.passage.v1:<uuid> + optional at:0..1        (where in the page it sits)
readtrail.saved.v1:<url>    unchanged
readtrail.note.v1:<uuid>    unchanged
readtrail.pagemeta.v1:<url> unchanged
```

Session: `readtrail.seen.v1:<tabId>` records the URL of a tab the reader clipped from, so Return can reuse that tab. `readtrail.tab.v1:<tabId>` gains an optional `reveal` field so a newly opened tab knows what to scroll to.

Export stays `readtrail-export` version 1 with an optional `drafts` array, so older builds still import new files. Nothing migrates; every change is additive.

## 8. The distinctive interaction: Return

Every quote and every clip is a live, precise, two-way link, and ReadTrail is honest about how well it worked.

**From a quote to its paragraph.** Return focuses the source's tab if it is open, otherwise opens one, scrolls the passage to the centre of the viewport, and flashes it. Three outcomes, always stated:

| Outcome | Meaning |
|---|---|
| Found exactly | Both anchors resolved **and** the resolved text equals the saved clip text |
| Found by text | Anchors failed; the clip's own text was found in the page. "The page has changed." |
| Not found | Neither worked. "The page may have changed. Your saved text is below." |

The text-equality gate matters. The existing structural check compares only a parent tag and a text length, so an equal-length rewrite would otherwise flash the wrong paragraph and call it exact. Three judging lenses independently flagged this as the one thing that must not ship wrong.

**From a page back to its clips.** The panel shows what the current page already contributed before the reader reads a line.

**Outside ReadTrail.** Markdown export with text-fragment links is Phase B, and only for export. Text fragments are never used for in-product Return, because opening one writes the quoted text into the reader's browsing history.

Return is browser-native because the URL is the unit of provenance, the tab is the unit of return, and the passage is found in the live page rather than in a copy ReadTrail made.

## 9. Removed or deferred

Removed in Phase B, with tests retired in the same commit:

- `sidepanel/library-view.js` and the hidden `#librarySection` markup, dead since Phase 4.
- `sidepanel/connections.js`: automatic relations by shared tag and domain, never surfaced. Quotation backlinks replace it, consistent with decision 19.
- The three `confirm()` calls, replaced by the inline confirmation rows already written.

Deferred with a reason:

- **Page ruler** (clip positions drawn along the page's scroll extent): Phase B. It needs the new `at` field and must be worded as position, never as reading progress.
- **Quote into a pinned draft from the panel**, Markdown export, Copy link, tag rename and autocomplete, a Clip keyboard shortcut: Phase B.
- **Item-level tags:** still deferred (decision 18). Quoting selects clips well enough.
- **A free-form canvas:** indefinitely. Headings in drafts are the ceiling for 2.0.
- **PDFs:** Chrome's built-in viewer does not give a content script the selection, so exact clips are impossible without a dependency. A text-only clip through the context menu is a Phase C experiment.
- **AI:** unchanged and owner-gated. If it comes, it acts on a draft, never on a live page.

Proposals needing owner approval, not planned: opening a topic as a tab group (`tabGroups` carries an install warning), and `unlimitedStorage` if the storage guard proves too tight.

## 10. Privacy and accessibility

No new permissions, no dependencies, no network. Two behaviours are new and must be written into `PRIVACY.md` and the store justification:

1. **Return reads the page when the reader asks it to.** Resolving anchors, and searching for the clip's own text when they fail, walks the DOM of the source page, including a dormant one. This is the same class of explicit action as the existing "Save selection", which already reads the selection on a dormant page. Nothing is captured or stored from the walk. **This clarifies the wording of a privacy commitment and needs the owner's confirmation.**
2. **Return reuses a tab the reader already clipped from.** A session-only record maps that tab to its URL, written only when the reader saves a clip from it, and cleared when the tab closes. ReadTrail does not poll other tabs for their URLs, and incognito tabs are never recorded.

Everything else holds: dormant until activated, capture only on an explicit action, incognito tabs never produce durable records, no sync, local export, deletion per item and in bulk.

Accessibility is built in, not audited later. Every control is a real button, input, or select with a label. The block editor is a form of textareas with Move up, Move down, Insert below, and Remove reachable by keyboard, and focus is restored to the moved block after a re-render, which requires targeted DOM updates rather than the current full rebuild. Return moves focus to a status line that announces the outcome. The flash respects `prefers-reduced-motion` with a static highlight instead of a timed fade.

## 11. The smallest vertical slice (Phase A)

A real reader clips two passages from two pages, opens the Desk, presses New draft, quotes both clips, writes a sentence between them, closes the tab, reopens the Desk and finds the draft intact, then presses Return on a quote and is told the truth about what was found.

1. Draft records: validators, bounds, worker handlers, and coverage by list, clear, export, and import.
2. `appendQuote` copies the text, URL, and title from the passage **in the worker**, so a snapshot is never client-authored.
3. `revealPassage`: tab reuse through the session record, a new tab with a seeded reveal otherwise, anchor resolution, the text-equality gate, the text fallback, the flash, and the three-way quality reply.
4. The Desk document: router, two panes, drafts index, block editor, Quote and Return.
5. Tests: unit coverage for every handler and validator, and a Playwright fixture that **mutates the paragraph between clip and Return** to prove the approximate and not-found states.

Out of the slice: the page ruler, the draft pin, topics for drafts, backlinks, Markdown export.

## 12. Roadmap and acceptance criteria

**Phase A. Draft and Return.** Accept when drafts round-trip through export and import, the Desk edits blocks by keyboard alone and autosaves visibly, Return reuses an open tab or opens one and reports exactly one of three honest outcomes, a mutated page yields the approximate and not-found states in an end-to-end test, the dormancy test still passes, and the full release suite is green.

**Phase B. The margin and the ruler.** Clip `at` and the page ruler, clips shown in the panel's This page with Return, Quote into a pinned draft, Markdown export with text-fragment links, tag rename and autocomplete, inline confirmations, and removal of the dead modules with their tests. Accept when a selection becomes a quote in one click, a ruler tick reveals its clip on a real page, exported links scroll to the passage in a fresh Chromium profile, and an accessibility pass reports no violations.

**Phase C. Topics, backlinks, timeline.** Drafts in Topics and search, "Quoted in N drafts" on pages and clips, a recent-clips sort. Accept when a contradiction between two sources can be recorded as two quotes and a sentence in under a minute and found again from either page.

**Phase D. Release 2.0.** Privacy copy, listing, screenshots, a logged manual QA run, package.

Each phase ends with a Codex review before the next begins.

## 13. Principal technical risks

1. **Return precision.** Single-page apps, lazy content, and consent banners defeat anchors. Mitigated by the text-equality gate, the text fallback with identical whitespace normalisation on both sides, and honest states. Proven by a mutating fixture.
2. **Reveal timing in a new tab.** The content script loads at `document_idle`, so the reveal rides on a seeded session record exactly as Continue reading does. Late-rendered content may still not exist at bootstrap.
3. **The flash cannot animate.** CSS transitions do not apply to `::highlight`, so the flash is a second named highlight removed on a timer.
4. **Storage budget.** Clips plus quote snapshots approach the 10 MB quota. A guard refuses new writes past 9 MB while always permitting removals, clearing, and settings.
5. **Additive fields must be added to both the validator and the cloner** or they are silently dropped on the next write.
6. **The Desk is a second document** that shares modules with the panel. The shared modules must stay genuinely shared, not forked.
7. **The reading lock swallows every primary click** on an active page, so no in-page control can be added. All synthesis controls stay in the panel and the Desk.
