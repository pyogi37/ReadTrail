# Status

Rewritten at the end of every working session. Keep under 40 lines.

- **Current phase:** Phase 0 (shared agent reference set) — complete; Phase 1 starting.
- **Active sprint doc:** `docs/sprints/SPRINT-003.md`
- **Last commit:** see `git log -1`
- **Release plan:** 1.0 = Phases 1–5 (multi-tab fix, resilience, side panel, knowledge layer, packaging). 1.1 = BYO-key AI.

## Done

- Sprints 001–002: reading guide, pause, Save for later, Reading Space, 128 tests.
- Phase 0: `AGENTS.md` rewritten, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/AI-WORKFLOW.md`, sprint docs 003–007, stray `Claude outputs/` moved out of the repo.

## In progress

- Phase 1: shared modules + per-tab session state.

## Blocked / needs owner

- Nothing.

## Next task

- Phase 1, task RT-301: create `shared/constants.js` and `shared/validators.js`, wire `importScripts`, keep all tests green.
