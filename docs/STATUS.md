# Status

Rewritten at the end of every working session. Keep under 40 lines.

- **Current phase:** 2.0 Phase A ("Draft and Return"). The data layer and Return are built, tested, and committed. The Desk user interface is the unfinished half.
- **Read first:** `docs/HANDOFF-2026-09-18.md`, then `docs/PRODUCT-DIRECTION.md`, then `docs/DECISIONS.md` items 20 to 26.
- **Last commit:** see `git log -1`. Nothing is pushed.
- **Checks:** `npm test` 278 passing in 14 files, `npm run test:e2e` 4 passing, `npm run package:check` 28 files, `git diff --check` clean.

## Done in this phase

- Draft records: `readtrail.draft.v1:<uuid>`, validators and cloners, bounds (100 drafts, 200 blocks, 24,000 characters), a 9 MB storage guard that never blocks a removal.
- Worker handlers `saveDraft`, `updateDraft`, `removeDraft`, `listDrafts`, `appendQuote`. The quote snapshot is copied from the stored passage inside the worker, so no surface can author provenance.
- Drafts flow through `listLibrary`, `clearLibrary`, export, and import. A file written before drafts existed still imports.
- Return: `revealPassage` in the worker (tab reuse through `readtrail.seen.v1:<tabId>`, otherwise a new tab seeded with `reveal`), and in the content script (anchor resolve, **text-equality gate**, text-search fallback, flash, three-way quality reply).
- 16 new tests covering drafts and all three Return outcomes.

## In progress

- `sidepanel/draft-view.js` is written but **not yet wired to any page**: `sidepanel/desk.html`, `desk.js`, and `desk.css` do not exist yet, so nothing in the interface can create a draft or press Return. This is the next task.

## Blocked / needs owner

- **DECISIONS 26:** Return reads a dormant page's DOM when the reader asks it to. Same class of action as the existing "Save selection", but the vision's wording says no DOM inspection happens before activation. `PRIVACY.md` and the store justification need the owner's confirmed wording before 2.0 ships.
- Push `main`; enable GitHub Pages from `/docs`; approve store copy and screenshots (all carried over from the 1.0 handoff).

## Next task

1. Build `sidepanel/desk.html` + `desk.js` + `desk.css`: two panes, hash router, the existing knowledge view as the Sources pane with a Quote button per clip, `draft-view.js` as the Draft pane.
2. Add a Playwright scenario that clips, quotes, mutates the paragraph, and asserts the approximate and missing states.
3. Then stop for the Codex review named in `docs/HANDOFF-2026-09-18.md`.
