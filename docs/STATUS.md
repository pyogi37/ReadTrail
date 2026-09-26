# Status

Rewritten at the end of every working session. Keep under 40 lines.

- **Current phase:** 2.0 Phase A ("Draft and Return"). Implementation and ten review fixes are committed at `e254f7c`. Phase A is **not yet independently accepted**: see "Blocked" below.
- **Read first:** `docs/HANDOFF-2026-09-18.md`, then `docs/PRODUCT-DIRECTION.md`, then `docs/DECISIONS.md` items 20 to 26.
- **Last commit:** see `git log -1`. Nothing is pushed.

## Verified by the lead on 2026-09-27, at `e254f7c`, clean tree

| Check | Result |
|---|---|
| `npm test` | 297 passing, 15 files |
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

1. **The Codex follow-up review was not received.** The session that asked for it referenced the review but included no content, so its findings could not be reproduced, and Phase A must not be recorded as accepted until that review arrives. Nothing was changed on the strength of an unseen review.
2. **Decision 26.** Proposed wording for every synchronized location is ready in `docs/proposals/DECISION-26-WORDING.md`. It is a proposal only; no privacy document has been edited. It also raises one gap: the `readtrail.seen.v1:<tabId>` session record is not yet disclosed in the privacy policy, and the current "does not read anything before you turn it on" line is already inaccurate in shipped 1.0 because Save selection never required activation.
3. Carried over: push `main`, enable GitHub Pages from `/docs`, approve store copy, take screenshots.

## Manual QA genuinely not done

Real third-party articles, Chrome restart persistence, incognito-window interface, NVDA or Narrator, Windows high contrast, and physical 200% zoom. The browser evidence so far is Playwright Chromium against the local fixture only.

## Next task

1. Paste the Codex follow-up review. Reproduce each finding before changing code, fix in severity order with a regression test each, one commit per fix.
2. Confirm or amend the Decision 26 wording, then apply it in one docs-only commit.
3. Do not start Phase B, and do not push.
