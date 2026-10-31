# Sprint 012: The audit's must-fix findings

## Status

Proposed by the lead 2026-10-31 from the whole-repo audit of `cc3837b` (`/ponytail-audit`; findings 1 to 8, all confirmed by re-reading the cited lines). **Approved by the owner 2026-10-31**, who added audit findings 11 and 12 (Part A) and took both proposed decisions below. **Done 2026-10-31:** all three parts merged, decisions 106 to 112; 424 unit tests and 15 e2e scenarios pass, and C1 was checked in real Chromium. It runs as three cloud sessions on `sprint-012/*` branches, started by the lead with `start_session`; the lead merges, writes the docs, runs both reviews and pushes `main` once the owner approves the push. PDF clips (direction 3.3), planned as Sprint 012, move to Sprint 013.

## Goal

Nothing the reader wrote, tagged, excluded or read is lost or changed without their say. Every fix is the smallest one that closes its case, and each case gets a test that fails without the fix. No runtime message, storage key, record field, permission or dependency is added.

## Owner decisions (taken 2026-10-31)

1. **Reset to defaults and excluded sites (B2).** Today "Reset to defaults" on the options page also clears every excluded site, without asking. Decided: Reset restores appearance and behaviour only and keeps excluded sites, which have their own Remove buttons.
2. **Replace import with records that would be rejected (C2).** Today the old library is deleted even when some imported records are skipped. Decided: refuse the whole replace import before writing anything, with a message saying the file has records ReadTrail cannot use and nothing was changed. A merge import keeps today's behaviour (it skips and counts them).

## Part A: Drafts that do not overwrite each other (session `sprint-012/desk-drafts`)

- **A1. A second Desk tab takes in the other tab's edits.** `load()` (`draft-view.js:144-159`) redraws the old `current` when the stored draft changed elsewhere and this tab has no unsaved edits. Set `current` to the stored copy (with fresh block keys) before redrawing. A tab with unsaved edits keeps today's behaviour.
- **A2. Quote ends an open Undo offer.** `quoteInto` (`draft-view.js:1401`) takes the stored draft, which still holds a quote kept for Undo, and leaves the offer open. Withdraw the offer first, as `openDraft` does (decision 98's save-on-withdraw keeps the removal).
- **A3. Undo keeps what was typed into the placeholder.** Removing a draft's only block adds an empty text block, and Undo drops it whenever it is the only block (`draft-view.js:1213-1216`), even after the reader typed in it. Drop it only while it is still an empty text block.
- **A4. Reopening a draft whose save failed shows the text that failed.** `openDraft` builds `current` from `drafts` (`draft-view.js:186`), which a storage reload may have reset to the stored, older draft, while `retryFailedSave` (`:191`) resends the failed snapshot. Build `current` from that snapshot when one exists, so the editor and the retry agree.
- **A5. Proof.** Unit tests in `tests/desk.test.js`: two Desk instances sharing one storage mock, where an append in one followed by a keystroke in the other keeps the quote; remove a quote, Quote another clip within the offer, then let the offer time out: the removed quote stays removed and appears once at most; type into the placeholder, press Undo: the typed text stays; a failed save of A, a storage reload, then reopen A: the editor shows the failed snapshot's text and the next save carries it.

**Files:** `sidepanel/draft-view.js`, `tests/desk.test.js`.

## Part B: The side panel and options keep what the reader set (session `sprint-012/panel-settings`)

- **B1. Page tags follow the tab.** `setTab` (`page-view.js:511`) empties the tags field and nothing refills it. Fill it from the library with `syncPageTags()`, and never overwrite the field while it has focus.
- **B2. The options page does not undo exclusions.** `options.js` sends its first-loaded `excludedHosts` with every change. Reload settings on `chrome.storage.onChanged` for the settings key. Reset keeps `excludedHosts` (decision 1).
- **B3. Proof.** In `tests/knowledge-view.test.js`: switch from a tagged page to another tagged page and back; the field shows each page's tags, and saving sends the old tags plus the new one. In `tests/options.test.js`: a settings change from elsewhere, then a slider move, keeps the excluded site; Reset keeps excluded sites.

**Files:** `sidepanel/page-view.js`, `options/options.js`, `tests/knowledge-view.test.js`, `tests/options.test.js`.

## Part C: The worker and the page keep the reader's place (session `sprint-012/worker-guards`)

- **C1. Following a link keeps the page you left.** `handleTakeSeededReveal` (`service-worker.js:859-860`) deletes the whole tab record when its URL differs from the new page's. Remove only a stale `reveal` seed; a plain reading record stays, so Back finds it and closing the tab still offers or saves it.
- **C2. A replace import that would drop records changes nothing.** `library.js:774-776` checks shapes only; later rejections (quote snapshot mismatch, library or draft limits) are skipped while the old library is still retired. Per decision 2, compute rejections before the first write and refuse with `INVALID_INPUT`. Merge mode is unchanged.
- **C3. Only real mouse moves move the checkpoint.** `onMouseMove` (`content.js:481`) accepts script-made events; click and double-click already refuse them. Add the `isTrusted` check. Existing tests that move with untrusted events switch to the `trustedPointerEvent` helper.
- **C4. A malformed clear request clears nothing.** `handleClearLibrary` (`library.js:701`) falls back to every kind for any non-array `kinds`. Fall back only when `kinds` is absent; anything else is `INVALID_INPUT`.
- **C5. Proof.** `tests/background.test.js`: a reading record survives a page load at another URL in the same tab, and a stale seed is removed. `tests/library.test.js`: replace import with one rejected record leaves the library as it was; `kinds: "notes"` is refused and deletes nothing. `tests/content.test.js`: a script-made mousemove changes no position and sends no save.

**Files:** `background/service-worker.js`, `background/library.js`, `content/content.js`, `tests/background.test.js`, `tests/library.test.js`, `tests/content.test.js`.

## The sprint as a whole

1. `npm test`, `npm run test:e2e`, `npm run package:check` (30 files) and `git diff --check` all pass on merged `main`.
2. No session edits a file outside its list. The lead writes the docs: `CHANGELOG.md`, `docs/DECISIONS.md` from item 106, `docs/qa/MANUAL-QA.md`, `docs/STATUS.md`.
3. The lead checks C1 in a real Chrome with a scratch Playwright script: active on A, link to B, Back, then close the tab; A's place is restored and offered.

## Out of this sprint

The audit's other items: the Back-button zombie page (9) and Return on `<br>` text (10), both needing a Chrome check first; note editors losing typing (13); recently closed Save going backwards (14); Markdown export escaping (15); the Desk's remove-clip warning (16); the package test-file guard (17); slow paths (18); duplicates and dead code (19, 20). Round five's and round six's remaining items. PDF clips (Sprint 013).
