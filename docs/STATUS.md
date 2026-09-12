# Status

Rewritten at the end of every working session. Keep under 40 lines.

- **Current phase:** Phases 1 to 5 implemented and reviewed. Handoff findings 1 to 5 are fixed; findings 6 to 10 remain optional 1.0.1 cleanup. Next: review, manual Chrome QA, and owner submission items.
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
- Test counts: 257 Vitest tests in 14 files; 4 Playwright scenarios. `npm test`, `npm run test:e2e`, `npm run package:check`, and `git diff --check` green on 2026-09-13.

## In progress

- Nothing. Stopped for owner review after findings 1 to 5.

## Blocked / needs owner

- Enable GitHub Pages from `/docs` on `main` so the privacy policy URL resolves.
- Approve `docs/store/LISTING.md`; take five 1280x800 screenshots per `docs/store/SCREENSHOTS.md`.
- Push the branch to GitHub (agents do not push).
- Optional: install `impeccable` and run `/audit` + `/polish` on `sidepanel/` and `options/`.

## Next task

1. Owner/lead: review commits `aeba78a` through `8335787`.
2. Codex or owner: run `docs/qa/MANUAL-QA.md` in Chrome with the zip from `npm run package`; log in `docs/qa/runs/`.
3. Owner: complete the submission actions in `docs/HANDOFF-2026-09-13.md`; tag `v1.0.0` after submission.
4. Later: address handoff findings 6 to 10 for 1.0.1.
