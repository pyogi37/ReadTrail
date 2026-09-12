# Status

Rewritten at the end of every working session. Keep under 40 lines.

- **Current phase:** Phases 1 to 5 implemented and reviewed. Ten review findings are listed in `docs/HANDOFF-2026-09-13.md`; fix 1 to 5 before submission. Then manual Chrome QA and owner items.
- **Active sprint doc:** `docs/sprints/SPRINT-007.md`
- **Last commit:** see `git log -1`
- **Release plan:** 1.0 = Phases 1 to 5 (done in code). 1.1 = BYO-key AI (Sprint 008, not started).

## Done

- Phase 0: agent reference set.
- Phase 1: per-tab session state, shared modules, chrome mock helper.
- Phase 2: anchor v2, ratio fallback, restoreQuality, page-controls.
- Phase 3: side panel, recently closed, closeSave, badge, Chrome 114 minimum.
- Phase 4: library worker module, context menu, passage capture + highlights, knowledge view (search, connections, export/import), page actions.
- Phase 5: excluded sites, packaging script, LICENSE, CHANGELOG, PRIVACY + Pages copy, store docs, release checklist, manual QA checklist, Playwright e2e harness (4 scenarios green in headless Chromium).
- Test counts: 253 Vitest tests in 14 files; 4 Playwright scenarios.

## Findings recorded this session

- Worker never sees `tab.url`; `pageInfo` fallback is the normal path (DECISIONS 14).
- Extension pages open in a tab carry `sender.tab`; trust rule fixed (DECISIONS 15).

## In progress

- Nothing in code. Next is review and QA.

## Blocked / needs owner

- Enable GitHub Pages from `/docs` on `main` so the privacy policy URL resolves.
- Approve `docs/store/LISTING.md`; take five 1280x800 screenshots per `docs/store/SCREENSHOTS.md`.
- Push the branch to GitHub (agents do not push).
- Optional: install `impeccable` and run `/audit` + `/polish` on `sidepanel/` and `options/`.

## Next task

Start from `docs/HANDOFF-2026-09-13.md` (findings and owner actions).

1. Codex: review `git diff 82cad57..HEAD` against Sprints 003 to 007 acceptance criteria; report defects with file:line.
2. Codex or owner: run `docs/qa/MANUAL-QA.md` in Chrome with the zip from `npm run package`; log in `docs/qa/runs/`.
3. Lead: fix findings, bump nothing (already 1.0.0), tag `v1.0.0` after submission.
