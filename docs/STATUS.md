# Status

Rewritten at the end of every working session. Keep under 40 lines.

- **Current phase:** 2.0 Phase A ("Draft and Return"). The Desk implementation and all ten independent-review fixes are complete and committed, awaiting follow-up review.
- **Read first:** `docs/HANDOFF-2026-09-18.md`, then `docs/PRODUCT-DIRECTION.md`, then `docs/DECISIONS.md` items 20 to 26.
- **Last commit:** see `git log -1`. Nothing is pushed.
- **Checks:** `npm test` 297 passing in 15 files, `npm run test:e2e` 6 passing, `npm run package:check` 31 files, `git diff --check` clean.

## Done in this phase

- Draft records: `readtrail.draft.v1:<uuid>`, validators and cloners, bounds (100 drafts, 200 blocks, 24,000 characters), a 9 MB storage guard that never blocks a removal.
- Worker handlers `saveDraft`, `updateDraft`, `removeDraft`, `listDrafts`, `appendQuote`. The quote snapshot is copied from the stored passage inside the worker, so no surface can author provenance.
- Drafts flow through `listLibrary`, `clearLibrary`, export, and import. A file written before drafts existed still imports.
- Return: `revealPassage` in the worker (tab reuse through `readtrail.seen.v1:<tabId>`, otherwise a new tab seeded with `reveal`), and in the content script (anchor resolve, **text-equality gate**, text-search fallback, flash, three-way quality reply).
- 16 new tests covering drafts and all three Return outcomes.
- Desk: responsive Sources/Draft panes, accessible narrow-screen switcher, and hash routes for drafts, topics, and searches.
- Sources reuses the page-first knowledge view; its optional Quote hook leaves the side panel unchanged. The panel footer now opens the Desk.
- Draft UI creates, edits, reorders, removes, and quotes blocks; Return moves focus to its exact/approximate/missing result.
- Desk unit coverage and a Playwright honesty scenario (quote, move source text, then remove it). Desktop and narrow layouts were visually checked.
- Review fixes: draft-aware queued saves; quote provenance enforcement; replace-import preflight; all durable growth behind the 9 MB guard.
- Return now verifies a seen tab's live URL, releases seeds only to the authoritative non-incognito sender, and waits for a reopened tab's final quality.
- Text fallback handles block boundaries; `# ` blocks expose heading presentation and semantics; narrow panes implement the complete tab/tabpanel relationship.
- Remediation evidence: `docs/qa/runs/2026-09-18-2.0-phase-a-fixes.md`.

## In progress

- None. Phase A is ready for an independent follow-up review.

## Blocked / needs owner

- **DECISIONS 26:** Return reads a dormant page's DOM when the reader asks it to. Same class of action as the existing "Save selection", but the vision's wording says no DOM inspection happens before activation. `PRIVACY.md` and the store justification need the owner's confirmed wording before 2.0 ships.
- Push `main`; enable GitHub Pages from `/docs`; approve store copy and screenshots (all carried over from the 1.0 handoff).

## Next task

1. Follow-up review the ten fixes against the findings in `docs/qa/runs/2026-09-18-2.0-phase-a.md` and the verification run beside it.
2. If no defects remain, resolve Decision 26 and complete the remaining manual release checks. Do not push without the owner.
