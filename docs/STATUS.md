# Status

Rewritten at the end of every working session. Keep under 40 lines.

- **Current phase:** Phase 1 (per-tab session state) complete in code and tests; awaiting Codex review + manual Chrome check. Phase 2 next.
- **Active sprint doc:** `docs/sprints/SPRINT-003.md` (review), then `docs/sprints/SPRINT-004.md`
- **Last commit:** see `git log -1`
- **Release plan:** 1.0 = Phases 1 to 5 (multi-tab fix, resilience, side panel, knowledge layer, packaging). 1.1 = BYO-key AI.

## Done

- Sprints 001 and 002: reading guide, pause, Save for later, Reading Space.
- Phase 0: `AGENTS.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/AI-WORKFLOW.md`, sprint docs 003 to 008.
- Phase 1: `shared/constants.js`, `shared/validators.js`, worker rewritten around `readtrail.tab.v1:<tabId>` records with the sender trust rule, `tabs.onRemoved`/`onReplaced` cleanup, continue-reading seeds the new tab after creation, `setSettings`/`getTabInfo`/`pageInfo` messages, options writes via the worker, `tests/helpers/chrome-mock.js`, 154 tests green.

## In progress

- Codex review of the Phase 1 diff against Sprint 003 acceptance criteria.
- Manual Chrome check of Sprint 003 (two tabs same URL, off/on isolation, continue into a new tab, reload restore, no worker console errors). Not yet run.

## Blocked / needs owner

- Owner to install the `impeccable` design skill (`pbakaus/impeccable`) before Phase 3 if they want it used for the side panel; see `docs/AI-WORKFLOW.md`.

## Next task

- Phase 2 (Sprint 004): anchor v2 with landmark + check, ratio fallback, `restoreQuality`, `shared/page-controls.js`, Update saved position.
