# Status

Rewritten at the end of every working session. Keep under 40 lines.

- **Current phase:** Phases 1 to 5 and handoff fixes 1 to 5 are implemented. The owner-approved page-first library redesign is implemented and awaiting review before manual Chrome QA.
- **Active sprint doc:** `docs/sprints/SPRINT-007.md`
- **Last commit:** see `git log -1`
- **Release plan:** 1.0 = Phases 1 to 5 (done in code). 1.1 = BYO-key AI (Sprint 008, not started).

## Done

- Phase 0: agent reference set.
- Phase 1: per-tab session state, shared modules, chrome mock helper.
- Phase 2: anchor v2, ratio fallback, restoreQuality, page-controls.
- Phase 3: side panel, recently closed, closeSave, badge, Chrome 114 minimum.
- Phase 4: library worker module, context menu, passage capture + highlights, knowledge view (search, connections, export/import), page actions.
- Phase 5: excluded sites, packaging script, LICENSE, CHANGELOG, PRIVACY + Pages copy, store docs, release checklist, manual QA checklist, Playwright e2e harness.
- Review fixes 1–5: serialized Recently closed updates; replacement tabs use save-on-close; durable passage anchors are bounded; current-page tags UI; confirmed bulk clear for passages, notes, and page tags.
- Page-first library: one expandable card per page containing its saved place, passages, notes, and page tags; separate Pages and Tags views; search results grouped by page. Item tags and automatic connections deferred (DECISIONS 17–19).
- Test counts: 262 Vitest tests in 14 files; 4 Playwright scenarios. Full release checks green on 2026-09-13.

## In progress

- Page-first library changes are uncommitted and stopped for owner/lead review.

## Blocked / needs owner

- Enable GitHub Pages from `/docs` on `main` so the privacy policy URL resolves.
- Approve `docs/store/LISTING.md`; take five 1280x800 screenshots per `docs/store/SCREENSHOTS.md`.
- Push the branch to GitHub (agents do not push).
- Optional: install `impeccable` and run `/audit` + `/polish` on `sidepanel/` and `options/`.

## Next task

1. Owner/lead: review the page-first library diff and its product decisions.
2. Codex or owner: run `docs/qa/MANUAL-QA.md` in Chrome with the zip from `npm run package`; log in `docs/qa/runs/`.
3. Owner: complete the submission actions in `docs/HANDOFF-2026-09-13.md`; tag `v1.0.0` after submission.
4. Later: address handoff findings 6 to 10 for 1.0.1.
