# Status

Rewritten at the end of every working session. Keep under 40 lines.

- **Current phase:** 2.1, Sprint 011 "Round six's P1s and the Desk's text blocks" (`docs/sprints/SPRINT-011.md`), ordered by the owner 2026-10-29 and run as two cloud routines on `sprint-011/*` branches. Sprint 010 is done (decisions 89 to 101). Version string is still 2.0.0; no tag has been cut.
- **Read first:** `docs/sprints/SPRINT-010.md`, `docs/DECISIONS.md` items 89 to 101, then `docs/PRODUCT-DIRECTION-2.1.md` section 3.2 for what critique round six must measure.
- **Last commit:** see `git log -1`. The owner approved pushing `main` and the `sprint-011/*` branches for this sprint.

## Verified by the lead, merged tree

| Check | Result |
|---|---|
| `npm test` | 400 passing, 15 files |
| `npm run test:e2e` | 12 scenarios passing |
| `npm run package:check` | 30 files would ship |
| `git diff --check` | clean |

Also checked in real Chromium with a scratch Playwright script: a right-click save flashes exactly the selected text without scrolling, saves one passage and writes the seen record; a save with nothing selected shows "!" and its reason on that tab only.

## Done this session

- Merged `origin/main` (privacy wording, dead library code removed); its decisions became 85 to 88.
- Sprint 010 planned, approved, built as three parallel sessions, reviewed and merged. The lead fixed two defects the sessions reported: the undo offer drifting after Enter or a move (decision 93), and the seen record written before a right-click save succeeded (decision 97).
- `vitest.config.js` excludes `.claude/`, where agent worktrees live.
- Round five of the Desk critique (run 2026-10-09 against `aaefe94`, left uncommitted in the privacy task's worktree) is now in `docs/qa/runs/2026-09-27-desk-critique.md`. Its P0, Undo after a removal's autosave breaking every later save, is fixed and proven by an e2e scenario (decision 98).
- Critique round six ran as two cloud routines: 26/40 (A 27, B 28), up from 23. Flexibility is 3, so the editor is not redesigned (decision 101). Its P0, typing lost while a quote's Undo stood, is fixed (decision 100).

## Blocked / needs owner

1. **Manual QA-4.8 to 4.10 (Sprint 009) and QA-8.1 to 8.8 (Sprint 010) in a real Chrome.** Touch, IME, a screen reader and real narrow-column articles are not covered by any automated run. QA-4.8 and QA-4.9 are each used twice since Sprint 009; renumber after that run.
2. **Round five's four P1s are open; the owner chooses the order.** Replace import removes every draft and clip not in the file without confirmation; five untrue statements (summary after clips are cleared, Return on duplicate sentences, Return on an excluded site, save errors naming the wrong limit, the export message omitting drafts); Quote with no draft open is silent; at 960px and wider both panes share one scroll.
3. **Cloud sessions.** The three Sprint 010 sessions ran locally: the Agent tool's "remote" option fell back to worktrees. Next sprint uses claude.ai routines through `RemoteTrigger`, and the lead checks they run in the cloud before carrying on.
4. Carried over: store copy approval; `docs/store/PERMISSIONS.md` still says "(1.0)" and "1.1"; real readers (direction 2.1 section 6).

## Next task

1. **Sprint 011:** merge `sprint-011/text-blocks` and `sprint-011/desk-messages` as they land, each reviewed against its criteria; decisions from item 102.
2. Sprint 012: PDF text clips through the context menu (direction 3.3), after verifying the viewer's menu in a real Chrome.
3. Capture shortcut and tag autocomplete; first-run and empty states.
4. Do not start 1.1 AI, images, or anything touching permissions or network without the owner. Do not tag without the owner. Push approval is per sprint; Sprint 011 has it.
