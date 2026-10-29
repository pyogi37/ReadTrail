# Status

Rewritten at the end of every working session. Keep under 40 lines.

- **Current phase:** 2.1, Sprint 010 "The Desk as one document" (`docs/sprints/SPRINT-010.md`), approved by the owner 2026-10-29 with two small tasks added: the reading guide and line highlight stay on the text, and the right-click save says it saved. It runs as three parallel cloud sessions on `sprint-010/*` branches; the lead merges, writes the docs, and pushes `main`. Version string is still 2.0.0; no tag has been cut.
- **Read first:** `docs/sprints/SPRINT-010.md`, then `docs/PRODUCT-DIRECTION-2.1.md` section 3.2, then `docs/DECISIONS.md` items 69 to 88.
- **Last commit:** see `git log -1`. `origin/main` had nine commits (privacy wording for the two clears, removal of `library-view.js`, `connections.js` and the worker's `removePageData`), built on the `main` from before Sprint 009. They are merged here, with their decisions renumbered from 76 to 79 to 85 to 88, because 76 to 84 were already Sprint 009's. The owner approved pushing the merge.

## Verified by the lead, merged tree

| Check | Result |
|---|---|
| `npm test` | 355 passing, 15 files |
| `npm run test:e2e` | 9 scenarios passing |
| `npm run package:check` | 30 files would ship |
| `git diff --check` | clean |

## Done this session

- The knowledge graph now includes the docs: all 84 decisions of the time, the sprints and the QA logs join the code (1203 nodes, 50 communities). The 12 PNGs were not extracted.
- Sprint 010 was written, trimmed under Ponytail, and approved.
- `vitest.config.js` excludes `.claude/`, because an agent worktree there doubled the suite to 695 tests and pulled in a Playwright spec.

## Blocked / needs owner

1. **Manual QA-4.8 to 4.10 (Sprint 009) in a real Chrome:** the clipboard and the downloads folder. The ids QA-4.8 and QA-4.9 have each been used twice since Sprint 009; renumber them after that run.
2. Carried over: store copy approval; `docs/store/PERMISSIONS.md` still says "(1.0)" and "1.1"; manual QA with a screen reader, high contrast, 200% zoom, touch, and real third-party articles.
3. **Real readers.** Nobody outside the project has used ReadTrail on a real page (direction 2.1 section 6).

## Next task

1. Merge the three Sprint 010 branches as they land, each reviewed against its criteria. Record decisions from item 89, add a QA-8 section for the editor, and add the `flashCapture` protocol row to `docs/ARCHITECTURE.md`.
2. The fifth critique on the Desk. If flexibility is still 1, the editor is redesigned again.
3. Sprint 011: PDF text clips through the context menu (direction 3.3), after verifying the viewer's menu in a real Chrome.
4. Capture shortcut and tag autocomplete; first-run and empty states.
5. Do not start 1.1 AI, images, or anything touching permissions or network without the owner. Do not tag without the owner. Pushing `main` and the `sprint-010/*` branches is approved for this sprint only.
