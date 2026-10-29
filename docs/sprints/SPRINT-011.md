# Sprint 011: Round six's P1s and the Desk's text blocks

## Status

Ordered by the owner 2026-10-29, straight from critique round six (`docs/qa/runs/2026-09-27-desk-critique.md`, round six; decision 101). It ran as two cloud sessions (the routines stayed paused) on `sprint-011/*` branches; the lead merged, wrote the docs, ran both reviews and pushed `main`. **Done 2026-10-29:** both parts merged, decisions 102 to 105; 406 unit tests and 15 e2e scenarios pass. PDF clips (direction 3.3), planned as Sprint 011, move to Sprint 012.

## Goal

The draft reads as one document a reader wrote, and every message the Desk sends is seen. Nothing about the record, the export, Return or the options row changes.

## Part A: Text blocks that read as prose (session `sprint-011/text-blocks`)

Round six's aesthetics stayed at 2 for one cause both assessors named: every text block is a bordered card with a fixed three-row textarea. Sprint 010 set both changes aside until a critique said they were needed (its owner decisions 2 and 3); round six says they are.

- **Text blocks grow with their text.** `field-sizing: content` on `.block-text`, Chrome 123 and later. On 114 to 122 (`minimum_chrome_version` is 114) it is ignored and blocks keep today's fixed height. A single line no longer sits in an 88px box.
- **Text blocks lose their card.** No border, no background, less space between consecutive text blocks, so they read as one run of prose. Quote blocks keep their framed treatment, which is what makes them read as embeds.
- **Nothing gets harder to find or use.** The options control, the drag handle and the undo gap still sit where they do, are still hit-testable only where visible (decision 44), and keep their 24px targets. Focus on a text block stays clearly visible. Reduced motion stays honoured.

### Acceptance criteria

- **A1.** In Chromium, a text block's height follows its text: one line is no taller than its line plus padding, and a six-sentence paragraph shows in full with no inner scroll (its `scrollHeight` equals its `clientHeight`).
- **A2.** A text block has no border and no background of its own at rest; a quote block keeps both. Consecutive text blocks sit closer together than a text block and a quote.
- **A3.** The handle, the options control and the undo slot keep their positions relative to the block and their sizes (24px or more); the focused textarea shows a visible focus indicator.
- **A4.** Proof in a new Playwright scenario, `tests/e2e/desk-layout.spec.mjs`, measured in real Chromium at 1280 and 390. Existing Desk tests pass unchanged; if a CSS-source test in `tests/desk.test.js` breaks, report it rather than editing that file.

**Files:** `sidepanel/desk.css`, `tests/e2e/desk-layout.spec.mjs` (new).

## Part B: The four P1s (session `sprint-011/desk-messages`)

- **B1. Quote at 390px leaves focus on `<body>`.** The quote handler shows the Draft pane only after `quoteInto` has rendered and asked for focus on the new quote's Return, while the pane was still hidden (`desk.js:99-106`, `draft-view.js:1413`). Show the Draft pane before the quote is placed, so focus lands on that Return at every width. A failed quote still reveals the pane and its message.
- **B2. A failed-save alert outlives the save.** After a refused save, the alert stays even when the next save succeeds (`draft-view.js:92`, `processSaveQueue`). A successful save of the open draft clears an alert that a failed save of that draft put up, and only that one. For `invalid-input`, name the cause that applies: an empty title says the draft needs a title; anything else says it could not be saved, without guessing at block length.
- **B3. Messages for a closed draft are invisible.** `#draftStatus` sits inside `<article id="draftEditor" hidden>` (`desk.html:116,127`), so "Open a draft first, then quote a clip into it.", "Draft removed." and "That draft no longer exists…" are announced into a hidden box. Move the status line out of the editor so it shows whether or not a draft is open. The undo offer keeps its place in the block list (decision 42).
- **B4.** No runtime message, storage key, record field, permission or dependency is added.
- **B5. Proof.** Unit tests in `tests/desk.test.js` for B2 and B3. A Playwright scenario in `tests/e2e/reading.spec.mjs` for B1 at 390px, asserting focus on the new quote's Return and the Draft pane visible.

**Files:** `sidepanel/draft-view.js`, `sidepanel/desk.js`, `sidepanel/desk.html`, `tests/desk.test.js`, `tests/e2e/reading.spec.mjs`.

## The sprint as a whole

1. `npm test`, `npm run test:e2e`, `npm run package:check` (30 files) and `git diff --check` all pass on merged `main`.
2. No session edits a file outside its list. The lead writes the docs: `CHANGELOG.md`, `docs/DECISIONS.md` from item 102, `docs/qa/MANUAL-QA.md`, `docs/STATUS.md`.

## Out of this sprint

Round six's P2s and P3s (Return's text fallback, placeholder contrast, repeated "Quote" names, a stale Return on a clip-gone quote, quoting at the caret, the squeezed title, the narrow-screen header stack, the export message, focus rings on `summary`); hiding the literal `# `; round five's replace-import confirmation; PDF clips (Sprint 012).
