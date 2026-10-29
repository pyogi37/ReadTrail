# Status

Rewritten at the end of every working session. Keep under 40 lines.

- **Current phase:** 2.1. Sprint 011 "Round six's P1s and the Desk's text blocks" (`docs/sprints/SPRINT-011.md`) is done and merged 2026-10-29 (decisions 102 to 105). No sprint is open. Version string is still 2.0.0; no tag has been cut.
- **Read first:** `docs/DECISIONS.md` items 102 to 105, then `docs/PRODUCT-DIRECTION-2.1.md` section 3.3 for Sprint 012.
- **Last commit:** see `git log -1`. Push approval for Sprint 011 is used up; the next sprint needs its own.

## Verified by the lead, merged tree

| Check | Result |
|---|---|
| `npm test` | 409 passing, 15 files |
| `npm run test:e2e` | 15 scenarios passing |
| `npm run package:check` | 30 files would ship |
| `git diff --check` | clean |

## Done this session

- Sprint 011 ran as two cloud sessions, started by the lead with `start_session` (target cloud) from `docs/sprints/SPRINT-011-cloud-prompts.md`, on the owner's cloud-session credit. The two Sprint 011 routines stayed paused.
- Part A (`sprint-011/text-blocks`, 67d772a): text blocks size to their text and lose their card; quotes keep their frame (decisions 102, 103). New `tests/e2e/desk-layout.spec.mjs` at 1280 and 390.
- Part B (`sprint-011/desk-messages`, acfa08e): Quote shows the Draft pane first (104); the status line moved out of the editor and a save alert clears with its draft's next save (105). No desk.css change was needed.
- Ultra review of the merged sprint: four nits; three fixed in decision 105's wording and tests, one shown not to happen.
- Lead review: both diffs stayed inside their file lists; the moved status line keeps the shared `.status-message` margin, which suits its new place above the editor.

## Blocked / needs owner

1. **Manual QA-4.8 to 4.10 (Sprint 009), QA-8.1 to 8.8 (Sprint 010) and QA-9.1 to 9.3 (Sprint 011) in a real Chrome.** Touch, IME, a screen reader and real narrow-column articles are not covered by any automated run. QA-4.8 and QA-4.9 are each used twice since Sprint 009; renumber after that run.
2. **Round five's P1s; the owner chooses the order.** Replace import removes every draft and clip not in the file without confirmation; four untrue statements (summary after clips are cleared, Return on duplicate sentences, Return on an excluded site, the export message omitting drafts); at 960px and wider both panes share one scroll. Sprint 011 closed two: save errors now name the cause that applies, and Quote with no draft open now shows its message.
3. **Delete the two paused Sprint 011 routines** at claude.ai/code/routines (trig_01QN81fBYLnRuJgMgnoMEDTs, trig_01NNJZWmfPu1oT1ugLytxfkj); the API cannot.
4. Carried over: store copy approval; `docs/store/PERMISSIONS.md` still says "(1.0)" and "1.1"; real readers (direction 2.1 section 6).

## Next task

1. Sprint 012: PDF text clips through the context menu (direction 3.3), after verifying the viewer's menu in a real Chrome. Plan it, get the owner's approval, then run it as cloud sessions via `start_session`; they report nothing when they end, so `git fetch` for their branches.
2. Round six's P2s and P3s (listed under "Out of this sprint" in `docs/sprints/SPRINT-011.md`) and round five's open P1s, in the owner's order.
3. Capture shortcut and tag autocomplete; first-run and empty states.
4. Do not start 1.1 AI, images, or anything touching permissions or network without the owner. Do not tag without the owner.
