# Status

Rewritten at the end of every working session. Keep under 40 lines.

- **Current phase:** 2.1, Sprint 009 "Get the draft out" (`docs/sprints/SPRINT-009.md`). The 2.1 direction was agreed with the owner on 2026-10-09 and is written in `docs/PRODUCT-DIRECTION-2.1.md`: the draft leaves the Desk, then the Desk behaves like one document, then PDFs become clippable. Decisions 76 to 84. Version string is still 2.0.0; no tag has been cut.
- **Read first:** `docs/PRODUCT-DIRECTION-2.1.md`, then `docs/sprints/SPRINT-009.md`, then `docs/DECISIONS.md` items 69 to 84.
- **Last commit:** see `git log -1`. `main` was in sync with `origin` at the start of this session; the Sprint 009 commit is local until the owner pushes.

## Verified by the lead, clean tree

| Check | Result |
|---|---|
| `npm test` | 379 passing, 16 files |
| `npm run test:e2e` | 9 scenarios passing |
| `npm run package:check` | 32 files would ship |
| `git diff --check` | clean |

## Done this session

Sprint 009 step 1 is implemented and green: `sidepanel/draft-markdown.js` (pure Markdown rendering of a draft or one quote, file naming), **Copy as Markdown** and **Download .md** beside Close on the open draft, **Copy with source** in a quote's options row before Remove, and a generalised text download in `export-import.js`. Unit coverage in `tests/draft-markdown.test.js` and four Desk tests. No permission, message, page read, or storage write was added. CHANGELOG, manual QA (QA-4.8 to 4.10), decisions, and this file updated.

One harness defect found and recorded (decision 84): leaked `hashchange` listeners across Desk instances in `tests/desk.test.js`. Not a product defect.

## Blocked / needs owner

1. **Codex review of the Sprint 009 diff** against `docs/sprints/SPRINT-009.md` acceptance criteria. Prompt is in the session handoff; the lead fixes confirmed defects.
2. **Manual QA-4.8 to 4.10 in a real Chrome:** the clipboard and the downloads folder cannot be exercised by the JSDOM or Playwright suites. Paste into Google Docs once to confirm the blockquotes render.
3. Carried over: store copy approval and `docs/store/PERMISSIONS.md` still says "(1.0)" and "1.1"; the fifth design critique has not been run; manual QA with a screen reader, high contrast, 200% zoom, touch, and real third-party articles is still not done.
4. **Real readers.** Nobody outside the project has used ReadTrail on a real page. Direction 2.1 section 6 asks the owner to put it in front of two or three students or writers for twenty minutes each, and asks the lead to log the north-star journey on three real reads under `docs/qa/runs/`.

## Next task

In this order, each its own sprint doc and each reviewed before the next begins:

1. Codex review of Sprint 009; fix what it confirms; owner runs QA-4.8 to 4.10.
2. Sprint 010: the Desk as one document (direction 3.2), then the fifth critique. Flexibility must move or the editor is redesigned again.
3. Sprint 011: PDF text clips through the context menu (direction 3.3), after verifying in a real Chrome that the viewer fires the menu with selection text.
4. Capture shortcut and tag autocomplete; first-run and empty states.
5. Do not start 1.1 AI, images, or anything touching permissions or network without the owner. Do not tag or push without the owner.
