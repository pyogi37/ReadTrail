# Status

Rewritten at the end of every working session. Keep under 40 lines.

- **Current phase:** 2.1. Sprint 012 "The audit's must-fix findings" (`docs/sprints/SPRINT-012.md`) is done and merged on local `main` 2026-10-31 (decisions 106 to 112). No sprint is open. Version string is still 2.0.0; no tag has been cut.
- **Read first:** `docs/DECISIONS.md` items 106 to 112, then `docs/PRODUCT-DIRECTION-2.1.md` section 3.3 for Sprint 013.
- **Last commit:** see `git log -1`. Sprint 012 has no push approval yet: `main` is ahead of `origin/main` until the owner approves.

## Verified by the lead, merged tree

| Check | Result |
|---|---|
| `npm test` | 424 passing, 15 files |
| `npm run test:e2e` | 15 scenarios passing |
| `npm run package:check` | 30 files would ship |
| `git diff --check` | clean |

Also checked in real Chromium with a scratch Playwright script (deleted after): active on A, link to B in the same tab, Back, reload, close. A's record survives B, its place restores, and Recently closed offers it. The same script fails on the old worker.

## Done this session

- `/ponytail-audit` of `cc3837b`: 20 findings, 8 must-fix; the report lives in this session's transcript only.
- Sprint 012 planned from findings 1 to 8; the owner approved it, added 11 and 12, and decided Reset keeps excluded sites and a lossy replace import is refused.
- Three cloud sessions built it (`sprint-012/desk-drafts` dd719b5, `sprint-012/panel-settings` 9b332f7, `sprint-012/worker-guards` 708216f), each inside its file list; the lead reviewed and merged them.

## Blocked / needs owner

1. **Push `main`** (Sprint 012 merges and docs).
2. **Manual QA-4.8 to 4.10, QA-8.1 to 8.8, QA-9.1 to 9.3 and QA-10.1 to 10.3 in a real Chrome.** Touch, IME, a screen reader, two real Desk tabs and real narrow-column articles are not covered by any automated run. QA-4.8 and QA-4.9 are each used twice since Sprint 009; renumber after that run.
3. **Round five's P1s; the owner chooses the order.** Four untrue statements (summary after clips are cleared, Return on duplicate sentences, Return on an excluded site, the export message omitting drafts); at 960px and wider both panes share one scroll. Replace import no longer deletes the library when it cannot use every record (decision 111), but still asks no confirmation.
4. **Delete the two paused Sprint 011 routines** at claude.ai/code/routines (trig_01QN81fBYLnRuJgMgnoMEDTs, trig_01NNJZWmfPu1oT1ugLytxfkj); the API cannot.
5. Carried over: store copy approval; `docs/store/PERMISSIONS.md` still says "(1.0)" and "1.1"; real readers (direction 2.1 section 6).

## Next task

1. The audit's remaining items, in the owner's order: Back restoring a page still switched on (9) and Return calling `<br>` text missing (10), both after a check in real Chrome; note editors losing typing (13); Recently closed Save going backwards (14); Markdown export escaping page titles (15); the Desk's remove-clip warning (16); the package test-file guard (17); slow paths (18); duplicates and dead code (19, 20). A worker version check on `updateDraft` would close the last two-tab race (decision 106).
2. Sprint 013: PDF text clips through the context menu (direction 3.3), after verifying the viewer's menu in a real Chrome. Run sprints as cloud sessions via `start_session`; they report nothing when they end, so `git fetch` for their branches.
3. Round six's P2s and P3s (`docs/sprints/SPRINT-011.md`, "Out of this sprint").
4. Capture shortcut and tag autocomplete; first-run and empty states.
5. Do not start 1.1 AI, images, or anything touching permissions or network without the owner. Do not tag without the owner.
