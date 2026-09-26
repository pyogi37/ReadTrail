# Status

Rewritten at the end of every working session. Keep under 40 lines.

- **Current phase:** 2.0 Phase A ("Draft and Return"), version 2.0.0. The Desk is built and has been through two rounds of design critique with every finding fixed. Phase A has still had **no single independent review of the whole diff**: see "Blocked".
- **Read first:** `docs/PRODUCT-DIRECTION.md`, then `docs/DECISIONS.md` items 20 to 39.
- **Last commit:** see `git log -1`. Nothing is pushed.

## Verified by the lead on 2026-09-27, clean tree

| Check | Result |
|---|---|
| `npm test` | 320 passing, 15 files |
| `npm run test:e2e` | 6 scenarios passing |
| `npm run package:check` | 31 files would ship |
| `git diff --check` | clean |

## Done since the last status

- **2.0.0.** Version bumped so a reload in `chrome://extensions` is visible; a test keeps the manifest and package versions in step. The side panel leads with a button into the Desk instead of a footer link.
- **One visual language.** Both surfaces draw from one token set: warm ink ground, annotation-pencil accent, gold for what the reader kept, one display face. Every colour pair measured; the lowest is 5.36 to 1.
- **Motion that runs.** Two of three animations had never run, because `--motion` carries its own easing and made the `animation` shorthand invalid. Fixed, and guarded by a browser assertion rather than a string match.
- **Return is honest and its answers last.** It names the tab it looked in, renders its answer on the quote it describes, and keeps what it found so a draft can say how many of its quotes still resolve.
- **Destructive actions are safe and consistent.** One inline confirmation idiom everywhere, each naming the cost in numbers; removing a clip says how many drafts quote it; removing a block has a twelve-second undo. No native dialog remains.
- **The draft reads as a document.** Provenance promoted, block plumbing behind hover and focus, an append control, keyboard accelerators, and a "How the Desk works" disclosure.
- Evidence: `docs/qa/runs/2026-09-27-desk-critique.md` and `docs/qa/runs/2026-09-27-ui-audit.md`.

## Blocked / needs owner

1. **No independent review of the whole Phase A diff.** The critiques covered the Desk surface; nobody has reviewed the worker, storage and trust-boundary changes end to end. The Codex reviewer hit a usage limit.
2. `docs/store/PERMISSIONS.md` still labels its disclosure "(1.0)" and the AI phase "1.1" while the package is 2.0.0. That is store copy the owner approves.
3. Carried over: push `main`, enable GitHub Pages from `/docs`, approve store copy, take screenshots.

## Manual QA genuinely not done

A real screen reader, Windows high contrast, physical 200% zoom, touch hardware, Chrome restart persistence, an incognito window, and real third-party articles. Every automated pass so far is Playwright Chromium against a local fixture.

## Next task

1. Re-run `impeccable critique` on the Desk. The last measured score, 21/40, predates the second round of fixes, so no current number should be claimed.
2. Get an independent review of the whole Phase A diff.
3. Do the manual QA above. Do not start Phase B, and do not push.
