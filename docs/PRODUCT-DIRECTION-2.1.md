# ReadTrail Product Direction (2.1)

Written 2026-10-09 by the lead and agreed with the owner the same day. `docs/PRODUCT-DIRECTION.md` remains the 2.0 model this builds on; nothing in it is reversed. `docs/PRODUCT-VISION.md` remains the owner's compass. Decisions taken here are recorded in `docs/DECISIONS.md` from item 76.

## 1. Where 2.0 left the reader

2.0 is correct and honest. A reader clips without filing, writes a draft beside their sources, and every quote can Return to its paragraph and tell the truth about what it found. Four rounds of critique and one independent review have made each of those claims true.

Three facts stop it from being usable by the people it is for: graduate students, researchers, essayists and other writers, and anyone else who reads to answer a question.

1. **The draft is a dead end.** Its only way out is the JSON library backup. A student cannot hand it in, a writer cannot paste it into the document they are actually writing, and nobody can cite from it. For every reader we name, the finished work lives somewhere else, and ReadTrail does not reach that place.
2. **PDFs cannot be clipped.** Chrome's own viewer gives a content script no selection. Researchers spend most of their reading day in PDFs, so the primary user of the 2.0 direction is excluded by default.
3. **The Desk is not a writing surface.** Its design score has sat at 19, 21, 19 and 20 out of 40 across four rounds, and flexibility has been 1 in every one. Each round repaired the honesty defects the previous round left and never touched the structure. The structural ceiling is the editor: a stack of textareas rearranged with Move up and Move down will not read as a document however good the chrome around it gets.

Nobody outside this project has yet used ReadTrail on a real page. That is the fourth fact, and it governs how much of the following should be built before someone does.

## 2. What 2.1 is

**2.1 makes the draft leave the Desk, makes the Desk behave like one document, and makes PDFs clippable.** In that order. Each item is independently shippable and each is measured before the next begins.

The product model does not change: sources, clips, drafts, quotes, Return. No new record type. No container object. No permission, dependency, or network call. Incognito, dormancy, and the two explicit reads stay exactly as published.

## 3. The work, in order

### 3.1 Get the draft out

Markdown is the lingua franca of every place a reader writes: Google Docs and Word paste it as formatted text, Notion and Obsidian read it natively, and a `.md` file is a plain-text file that will open in fifty years.

- **Copy as Markdown** and **Download as Markdown** on the open draft. The title becomes the document heading, text blocks pass through as the reader wrote them, each quote becomes a blockquote with its source named and numbered, and a Sources list at the end gives every page once, with its title and URL.
- **Copy with source** on a quote, from the Desk, for the sentence a reader wants to drop into something else right now.
- Citations are plain numbered references, not Markdown footnote syntax, because footnote syntax survives in Obsidian and GitHub and collapses to literal brackets everywhere else. A plain `[1]` and a numbered list are readable in every target, including a plain-text email.
- The export is generated from the stored record on the device. Nothing is read from any page and nothing new is stored.

This is the smallest item and the largest usability unlock. It ships first.

### 3.2 Make the Desk one document

The editor keeps one textarea per block underneath, because that is what keeps every block a real labelled form control and what the test harness can drive. What changes is that the blocks stop behaving like a list of fields and start behaving like a page:

- Enter at the end of a text block creates the next block and moves the caret into it. Backspace at the start of an empty block removes it and lands at the end of the one above.
- Up and Down at a block's edge cross into the neighbouring block instead of stopping.
- A drag handle moves a block with the pointer. The keyboard path (Alt with an arrow) stays and remains the one the tests prove.
- A quote block is an atomic embed: it cannot be typed into, and the caret steps over it.
- The options row, the undo offer, Return and its verdict are unchanged.

The outcome is measured, not asserted: a fifth critique round after this lands, and the finding of that round is whether flexibility and aesthetics moved. If flexibility is still 1, the editor is redesigned again before anything else is built.

### 3.3 Clip from PDFs

Chrome's PDF viewer blocks content scripts, so an exact clip with two DOM anchors is impossible there without a dependency. The context menu still fires on a selection inside the viewer and carries the selected text. That is enough for a **text-only clip**: the text, the file URL as the source, no anchors.

- Return on a PDF quote reports honestly that it cannot locate a passage inside a PDF, and offers to open the file. It never claims a position it does not have.
- The panel's page header names the source as a PDF so the reader knows which rules apply.
- Before this is promised in any copy, the viewer behaviour is verified in a real Chrome, because the menu's selection text in the PDF viewer is a platform behaviour we have not yet measured.

### 3.4 Capture speed

Already deferred from Phase B and still right: a keyboard shortcut for Save selection, declared in the manifest without an install warning, and tag autocomplete in the panel. The no-filing promise only feels real when capture takes no attention.

### 3.5 First-run and empty states

The empty panel and the empty Desk each show exactly one next action and nothing else. Nobody knows what Return means until they have pressed it once, so the first quote in a reader's first draft is where Return is explained, in one sentence, where it is used.

## 4. The audiences, named

- **Students and researchers** need 3.1 to hand work in and 3.3 to clip from what they actually read. Both before 3.2.
- **Writers** are the best fit 2.0 already has: the draft is a writing surface and quotes with Return are how an essayist works with sources. They need 3.1 to get their paragraphs into the piece and 3.2 so that writing in the Desk does not feel like filling in a form.
- **Designers and other visual thinkers** would want image clips. 2.1 says no. Images are a new data shape, they would exhaust the storage guard in an afternoon, and they pull toward a moodboard product that ReadTrail is not. If images ever come, it is a separate decision for the owner.

## 5. Deliberately not in 2.1

AI, sync, accounts, a canvas, an on-page highlight layer, image clips, and any citation-manager integration. The highlight layer is the Hypothesis and LiquidText trap and collides with the reading lock. Integrations mean network calls, which are an owner stop-point. The 1.1 AI sprint stays owner-gated and, if it comes, acts on a draft, never on a live page.

## 6. Before and beside the build

1. **The lead runs the north-star journey on three real reads** this sprint, such as arXiv HTML papers and a long essay, and logs it under `docs/qa/runs/`. Real third-party pages have never been exercised.
2. **The owner puts the extension in front of two or three actual students or writers for twenty minutes each.** Their first stumble reorders this list more reliably than any critique round has. Until that happens, the order above is the lead's best judgment, not evidence.

## 7. Acceptance for 2.1 as a whole

A graduate student clips four passages from two HTML articles and one PDF, writes a draft that quotes all four, downloads it as Markdown, pastes it into their document and finds every quote attributed and every source listed once. Opening the Desk a week later, they Return from an HTML quote and are told the truth, Return from the PDF quote and are told plainly why it cannot be located, and the draft reads as one document they wrote rather than a form they filled in. Sprint plans: `docs/sprints/SPRINT-009.md` onward.
