# Status

Rewritten at the end of every working session. Keep under 40 lines.

- **Current phase:** 2.0 Phase A ("Draft and Return"), now at version 2.0.0. Implementation, ten review fixes, the owner-approved Decision 26 wording, and two discoverability fixes are committed. Phase A is **not yet independently accepted**: see "Blocked" below.
- **Read first:** `docs/HANDOFF-2026-09-18.md`, then `docs/PRODUCT-DIRECTION.md`, then `docs/DECISIONS.md` items 20 to 26.
- **Last commit:** see `git log -1`. Nothing is pushed.

## Verified by the lead on 2026-09-27, at `5a5caee`, clean tree

| Check | Result |
|---|---|
| `npm test` | 298 passing, 15 files |
| `npm run test:e2e` | 6 scenarios passing |
| `npm run package:check` | 31 files would ship |
| `git diff --check` | clean |

These are the lead's own runs, matching the counts in `docs/qa/runs/2026-09-18-2.0-phase-a-fixes.md`. No implementation code changed in this session.

## Done in this phase

- Draft records, bounds, and the storage guard that never blocks a removal.
- Worker handlers for drafts; `appendQuote` copies each quote's snapshot from the stored passage, so no surface can author provenance.
- Drafts flow through `listLibrary`, `clearLibrary`, export, and import; a file written before drafts existed still imports.
- Return: tab reuse through `readtrail.seen.v1:<tabId>`, otherwise a new tab seeded with `reveal`; anchors, then a text-equality gate, then a text search; honest exact, approximate, or missing.
- The Desk: responsive Sources and Draft panes, a keyboard-reachable narrow-screen switcher, hash routes, block editing with focus restored after a move.
- Ten findings from `docs/qa/runs/2026-09-18-2.0-phase-a.md` fixed and verified in `...-fixes.md`.

## Blocked / needs owner

1. **The Codex follow-up review never arrived** (the reviewer hit a usage limit). Phase A must not be recorded as independently accepted until some independent review happens. Nothing was ever changed on the strength of an unseen review.
2. **`docs/store/PERMISSIONS.md` still labels its disclosure "(1.0)" and the AI phase "1.1".** The package is now 2.0.0. These labels are store copy the owner approves, so they were left alone; they need one pass before submission.
3. Carried over: push `main`, enable GitHub Pages from `/docs`, approve store copy, take screenshots.

## Manual QA genuinely not done

Real third-party articles, Chrome restart persistence, incognito-window interface, NVDA or Narrator, Windows high contrast, and physical 200% zoom. The browser evidence so far is Playwright Chromium against the local fixture only.

## Decision 26: closed

Owner approved the proposed wording on 2026-09-27. Applied to `docs/DECISIONS.md` item 26, both copies of the privacy policy (including a new row for the `readtrail.seen.v1:<tabId>` session record and one for drafts), `docs/store/PERMISSIONS.md`, and the `AGENTS.md` privacy rule. `docs/PRODUCT-VISION.md` was not touched: its line "No reading state is captured before activation" remains true. The 1.0 changelog entry was left as released history. Reasoning is kept in `docs/proposals/DECISION-26-WORDING.md`.

## Discoverability fixes, 2026-09-27

The owner reported that nothing appeared new in Chrome after reloading. The build was verified to load cleanly (no console or service-worker errors, a draft created and a clip quoted through the interface), so the cause was that nothing was visible: the manifest still said 1.0.0, so a reload changed nothing on the extensions card, and the Desk was reachable only through a small footer link. Both are fixed. The third cause is inherent to Chrome: a side panel left open during a reload keeps running the old code until it is closed and reopened.

## Next task

1. Get an independent review of Phase A when a reviewer is available; until then Phase A stays unaccepted.
2. Do the manual QA listed above, which is what stands between this and a submission.
3. Do not start Phase B, and do not push.
