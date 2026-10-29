# Sprint 010: The Desk as one document (2.1, step 2)

## Status

Done 2026-10-29. Approved by the owner the same day, with the recommendation on the handle; the owner added parts B and C. All three branches are merged into `main`, with two fixes from the lead (decisions 93 and 97); decisions 89 to 97 record the rest. The three sessions ran as local worktree agents, not in the cloud as the owner asked. Direction: `docs/PRODUCT-DIRECTION-2.1.md` section 3.2. Part A is measured next by the fifth critique round (decision 76): if flexibility is still 1, the editor is redesigned again before Sprint 011.

## How this sprint runs

Three cloud sessions in parallel, one per part, at the owner's request. Each branches from `main`, owns only the files listed for its part, and pushes only its own branch: `sprint-010/desk-editor`, `sprint-010/reading-guide`, `sprint-010/save-confirmation`. The lead reviews each branch against its criteria, merges it into `main`, writes the docs (`CHANGELOG.md`, `docs/DECISIONS.md` from item 89, `docs/qa/MANUAL-QA.md`, `docs/ARCHITECTURE.md`, `docs/STATUS.md`), runs `/code-review` and `/ponytail-review` on the merged diff, and pushes `main`. No session edits a file another session owns.

## Part A: The Desk as one document

### Goal

Writing in the Desk stops feeling like filling in a form. The keys a writer already knows move between blocks the way they move through a page, a block can be dragged to where it belongs, and a quote sits in the text as an embed the caret passes over. Every block is still a real labelled form control underneath, and nothing about the record, the export, Return or the options row changes.

### Scope

- **Text block keys**, in the textarea's own keydown handler, which already owns Alt with an arrow and Control or Command with Enter and stops them (decision 71):

  | Key, where | Today | After |
  |---|---|---|
  | Enter, caret collapsed at the end of a text block | line break | a new empty text block below, caret in it |
  | Enter anywhere else, or Shift with Enter | line break | unchanged |
  | Backspace in an empty text block that has a block above | nothing | the block goes; caret at the end of the nearest text block above |
  | Up, caret collapsed at the start of a text block | stays | caret at the end of the nearest text block above |
  | Down, caret collapsed at the end of a text block | stays | caret at the start of the nearest text block below |
  | Alt with an arrow, Control or Command with Enter | move, add text below | unchanged |

- **Caret placement after a rebuild.** `renderBlocks` rebuilds the list on every structural change, and `pendingFocus` already says which block and control get focus afterwards. It gains where the caret goes, start or end, and `restoreFocus` places it.
- **A quiet removal for an empty block.** Backspace removes only a block with nothing in it, so nothing the reader wrote can be lost. It offers no undo, leaves the status line alone, and does not pull focus to the undo offer. Remove in the options row keeps its offer exactly as it is.
- **Quote blocks are atomic embeds.** They already cannot be typed into. Now the caret steps over them. The keys above look past quote blocks to the nearest text block, and if there isn't one in that direction, the key does nothing. Tab still reaches a quote's three controls (decision 81).
- **A drag handle on every block.** Pointer events with pointer capture, so mouse, pen and touch share one path. A drag lifts the block after a few pixels of movement and shows a line where it will land. Releasing ends in the existing `moveBlock`, so the announcement, the autosave and the focus rules are the ones Move up and Move down already prove. Escape or `pointercancel` puts the block back. The handle is not a button and not a tab stop. It is hidden from assistive technology, because Alt with an arrow and the options row are the keyboard and single-pointer paths (WCAG 2.5.7) and stay the ones the tests prove.
- **The handle on touch (owner decision, recommendation accepted).** Where there is hover, the handle appears on hover and while dragging, and is hidden from hit testing otherwise (decision 44), so a quote at rest still shows decision 69's three things. Under `(hover: none)` it is always visible, because there is no hover to reveal it. It is not a tab stop, so decision 81's three tab stops hold.

### Assumptions that change behaviour

1. **"A block's edge" means the start or end of its text, not its first or last visual line.** Measured in Chromium 153 on Windows with Playwright: Up on a textarea's first visual line moves the caret to position 0, Down on the last moves it to the end, and Up from a wrapped second line moves one visual line. So Up from anywhere on the first line goes to the start of the block, and the next Up crosses. That costs one extra press but never takes the caret out of a wrapped paragraph the reader meant to move within, and JSDOM can prove it exactly.
2. **An Enter that creates a block adds nothing to the block it left.** The text stays byte for byte as it was, so the export (Sprint 009, criterion 2) is unaffected.
3. **No key ever removes a quote or a block with text in it.** Removing one of those stays a deliberate act in the options row, with its undo offer.

### Acceptance criteria

- **A1. Enter at the end.** With a collapsed caret at the end of a text block, Enter inserts exactly one empty text block directly below it and puts the caret in that block. The block it left is byte-identical to before. Shift with Enter, and Enter anywhere but the end, insert a line break as today. Enter during IME composition (`isComposing`) is left to the browser.
- **A2. At the block limit**, Enter at the end says so in the status line with `role="alert"`, exactly as Add text below does, and changes nothing.
- **A3. Backspace in an empty block** that has any block above removes it. The live region says "Empty block removed.", and the caret sits at the end of the nearest text block above. No undo is offered, the status line is untouched, and focus does not move to the undo offer. If every block above is a quote, focus lands on the Return of the quote directly above, or on its options control when it has no Return, and never on the citation link (decision 72). Backspace in a block with text, in the first block, or over a selection is left to the browser.
- **A4. Up at the start and Down at the end** cross into the nearest text block in that direction, at its end and at its start respectively, stepping over any quote blocks between. With no text block in that direction, nothing happens. Shift with an arrow, Alt with an arrow, and a caret anywhere else are left alone.
- **A5. Each key is handled once.** A key that changes the list or the focused block stops its event, so the block's own handler never acts on it a second time (decision 71). One Enter makes one block and one Backspace removes one block.
- **A6. Drag.** Pressing a block's handle and moving at least 4 pixels lifts the block, and a line marks where it will land. Releasing moves it there through `moveBlock`: "Moved to position n of m." is announced and the draft saves once. Dropping where it started does nothing and saves nothing. Escape or `pointercancel` during a drag leaves the order unchanged and saves nothing. Dragging works from the handle only; pressing in a textarea still places the caret and selects text.
- **A7. The handle is accessible by staying out of the way.** It is not focusable, carries `aria-hidden="true"`, has a hit area of at least 24 × 24 CSS pixels, and is hit-testable only where it is visible (decision 44). It sets `touch-action: none` so dragging it on a touch screen does not scroll the page. Under `prefers-reduced-motion` nothing about lifting, the drop line or landing animates (the global rule in `sidepanel.css` already covers it; new rules must not escape it).
- **A8. What does not change, proven by the existing suite.** Alt with an arrow, Control or Command with Enter, the options row (its order, labels, shortcuts, Copy with source, Remove last), the undo offer, Return, its verdict and the summary behave as before. Every existing test in `tests/desk.test.js` and the Desk e2e scenarios passes without its assertions being edited. If one cannot, the reason is reported so it can be recorded as a decision rather than the test being quietly changed.
- **A9. A quote never holds a caret.** No key in A1 to A4 puts focus inside a quote block's blockquote, which stays non-editable. Tab stops in a quote at rest stay at three.
- **A10. Nothing new crosses a boundary.** No runtime message, storage key, record field, page read, permission, dependency or network call is added. The draft record's shape is unchanged, and `draftToMarkdown` returns the same text for the same draft.
- **A11. Proof.** Unit tests in `tests/desk.test.js` cover A1 to A7 and A9. The drag is driven with stubbed block rectangles, since JSDOM does no layout. One new Playwright scenario in `tests/e2e/reading.spec.mjs` drives Enter, Backspace, Up and Down crossing a quote (including the two-press edge from the first visual line) and a mouse drag in real Chromium.

### Files (session `sprint-010/desk-editor`)

`sidepanel/draft-view.js`, `sidepanel/desk.css`, `tests/desk.test.js`, `tests/e2e/reading.spec.mjs`. The handle's visual details follow the `impeccable` skill where it is available (decision 13).

## Part B: The reading guide stays on the text

### Goal

The ruler, the underline and the yellow line highlight mark the text being read, not the whole width of the window or of the element around it. Today the ruler and underline are drawn from the left edge of the viewport to the right, and the line highlight is an inline `background-color` on the whole block element, which fills that element's box well past its text.

### Scope

- **Line highlight through the CSS Custom Highlight API**, the mechanism saved passages already use (`readtrail-passage`). One named highlight, `readtrail-line`, over the text of the block under the pointer. Its colour paints only behind the glyphs, line by line, so it ends where the text ends on both sides. The page's own elements get no class and no inline style any more. The configured colour (`settings.highlightColor`, 0.3 alpha as today) is applied by one ReadTrail-owned rule for `::highlight(readtrail-line)`, removed when the page deactivates.
- **Ruler and underline bounded by the text.** The horizontal extent is the bounding box of the text in the block under the pointer (a range over that block's contents), found by the same `lineAtPoint` lookup the highlight uses. `renderRuler` and `renderUnderline` take that extent; their end marks (the saved flag, the frozen end caps, the saved end badge) sit at its ends.
- **Message routing for part C.** `content.js` routes `{ type: "flashCapture" }` from the worker to `window.ReadTrailPassage.flashCaptured()`, which part C writes. It returns whether it flashed. Guard for the function being absent, as every other route does.

### Acceptance criteria

- **B1. The highlight stays on the text.** With Highlight current line on, the block under the pointer is marked by the `readtrail-line` highlight in `CSS.highlights`, over a range of that block's contents, in the configured colour at 0.3 alpha. The block element gets no class and no inline style; a page's own inline `background-color` is never touched.
- **B2. The ruler and underline stay on the text.** Each spans only from the left to the right of the text box of the block under the pointer, never the viewport, and its end marks sit at those ends.
- **B3. Gaps and redraws.** Over a margin or gap with no block, the guide keeps the extent it last had. Before any block has been found it spans the viewport, as today. A frozen or saved guide redrawn from its anchor takes the extent of the anchor's block.
- **B4. Leaving the page as it was.** Turning the highlight off, pausing and deactivating each remove `readtrail-line` from `CSS.highlights` and remove the ReadTrail rule. Dots are unchanged. Nothing is read on a dormant page and nothing is stored.
- **B5. Routing.** `flashCapture` calls `ReadTrailPassage.flashCaptured()` once and does nothing else. It is safe when that function is absent, and it works on a dormant page, since it belongs to the reader's own save.
- **B6. Proof.** Unit tests in `tests/content.test.js` and `tests/renderer.test.js` cover B1 to B5, with stubbed rectangles and a stubbed `CSS.highlights`. The existing highlight-cleanup test changes on purpose, because the mechanism it asserted (a class and an inline style) is the defect. Its intent stays the same: the highlight goes and the page's own style survives. One Playwright scenario in a new `tests/e2e/guide.spec.mjs` activates the fixture, moves the pointer over a paragraph narrower than the window, and reads the canvas to show that the ruler's pixels outside the text's extent are transparent.

### Files (session `sprint-010/reading-guide`)

`content/content.js`, `content/renderer.js`, `content/content.css`, `tests/content.test.js`, `tests/renderer.test.js`, `tests/e2e/guide.spec.mjs` (new).

## Part C: The right-click save says it saved

### Goal

"Save selection to ReadTrail" in the page's context menu already saves, but it passes an empty callback, so the reader cannot tell whether anything happened, and a failed save is silent. Now a saved passage flashes where it is, and a failed one says why.

### Scope

- **The flash.** `captureSelection` keeps a clone of the range it captured, in memory only. `flashCaptured()` flashes that range with the reveal highlight Return already uses (`readtrail-reveal`, `FLASH_MS`) without scrolling, then forgets it, and returns whether it flashed.
- **The worker.** `onContextMenuClick` passes a real callback to `handleSavePassage`. On `ok`, it sends `{ type: "flashCapture" }` to that tab. On failure, at capture or at save, it sets that tab's badge to "!" and its title to one sentence saying why. Both reset to the global badge and title (`text: null`, `title: null` for that tab) after eight seconds or on that tab's next successful save. Incognito stays ignored, as today.
- **No new permission.** `chrome.action` needs none. No storage shape changes.

### Acceptance criteria

- **C1.** A successful context-menu save sends `flashCapture` to the tab it came from, once, and the page flashes exactly the captured text without scrolling.
- **C2.** A failed context-menu save never flashes. It sets that tab's badge to "!" and its title to a sentence naming the reason: no selection (for example, a selection inside a frame), longer than the clip limit, storage full, or anything else as "it could not be saved". Nothing about the recently-closed badge count changes for other tabs, and the tab returns to the global badge after eight seconds or on its next successful save.
- **C3.** `flashCaptured()` flashes only the range captured by the most recent `captureSelection`, only once, and returns `false` with nothing captured. The range is never stored or sent anywhere.
- **C4.** No permission, dependency, network call, storage key or record field is added. `flashCapture` carries nothing but its type.
- **C5. Proof.** Tests in `tests/library.test.js` cover C1, C2 and the reset, through the existing context-menu harness. Tests in `tests/passage.test.js` cover C3 with a stubbed `CSS.highlights`.

### Files (session `sprint-010/save-confirmation`)

`background/library.js`, `content/passage.js`, `tests/library.test.js`, `tests/passage.test.js`, and `tests/helpers/chrome-mock.js` only if `chrome.action` needs adding to the mock. Part B routes the message in `content.js`, through the `flashCaptured()` interface named above.

## The sprint as a whole

1. `npm test`, `npm run test:e2e` (11 scenarios), `npm run package:check` (30 files) and `git diff --check` all pass on the merged `main`.
2. No session edited a file outside its list. The lead writes every document in this sprint.

## Out of this sprint

- Splitting a block with Enter in the middle of its text.
- Merging into the block above with Backspace at the start of a block that has text, and Delete at the end.
- Left and Right crossing between blocks.
- Selecting across blocks, and undo or redo that spans blocks.
- Crossing in one press from the first or last visual line (assumption 1).
- Auto-scrolling while dragging near the edge of the pane.
- Dragging a clip from Sources into the draft.
- A keyboard-operable handle.
- contenteditable or rich text, and Markdown shortcuts beyond `# `.
- Restyling text blocks without their card, and textareas that grow with their text (`field-sizing: content`). Neither was asked for; the fifth critique says whether they are needed.
- A confirmation for the side panel's own Save selection, which already reports in its status line.
- A right-click save without a selection, for example the whole page.
- Bounding the dots style, which follows the pointer and has no width.
- The fifth critique itself, which follows this sprint.
- Steps 3.3 to 3.5 of the direction follow in their own sprints.
