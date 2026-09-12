# Status

Rewritten at the end of every working session. Keep under 40 lines.

- **Current phase:** Phases 1 and 2 complete in code and tests; awaiting Codex review + manual Chrome check. Phase 3 (side panel) next.
- **Active sprint doc:** `docs/sprints/SPRINT-005.md`; 003 and 004 await review
- **Last commit:** see `git log -1`
- **Release plan:** 1.0 = Phases 1 to 5 (multi-tab fix, resilience, side panel, knowledge layer, packaging). 1.1 = BYO-key AI.

## Done

- Sprints 001 and 002: reading guide, pause, Save for later, Reading Space.
- Phase 0: `AGENTS.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/AI-WORKFLOW.md`, sprint docs 003 to 008.
- Phase 1: `shared/constants.js`, `shared/validators.js`, worker rewritten around `readtrail.tab.v1:<tabId>` records with the sender trust rule, `tabs.onRemoved`/`onReplaced` cleanup, continue-reading seeds the new tab after creation, `setSettings`/`getTabInfo`/`pageInfo` messages, options writes via the worker, `tests/helpers/chrome-mock.js`, 154 tests green.

- Phase 2: anchor v2 (landmark + structural check, no text), ratio fallback when page height drifted >15%, `restoreQuality` reported by the content script and stored per tab, `shared/page-controls.js` state machine, popup shows Saved / Update saved position by timestamp and a restore note. 165 tests green.

## In progress

- Codex review of the Phase 1 and 2 diffs against Sprint 003 and 004 acceptance criteria.
- Manual Chrome check of Sprint 003 (two tabs same URL, off/on isolation, continue into a new tab, reload restore, no worker console errors). Not yet run.

## Blocked / needs owner

- Owner to install the `impeccable` design skill (`pbakaus/impeccable`) before Phase 3 if they want it used for the side panel; see `docs/AI-WORKFLOW.md`.

## Next task

- Phase 3 (Sprint 005): `sidepanel/` replaces popup and reading-space; recently-closed save offer; `minimum_chrome_version` 114.
