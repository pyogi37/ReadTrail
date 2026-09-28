# Status

Rewritten at the end of every working session. Keep under 40 lines.

- **Current phase:** 2.0 Phase A ("Draft and Return"), version 2.0.0. The Desk has been through **four** rounds of design critique. Measured: **19 → 21 → 19 → 20 out of 40**. Round four's P0 is fixed; five of its findings are open and belong to the next piece of work. Phase A has still had **no single independent review of the whole diff**: see "Blocked".
- **Read first:** `docs/PRODUCT-DIRECTION.md`, then `docs/DECISIONS.md` items 20 to 52.
- **Last commit:** see `git log -1`. `main` is pushed to `origin` and in sync; no tag has been cut.

## Verified by the lead, clean tree

| Check | Result |
|---|---|
| `npm test` | 364 passing, 15 files |
| `npm run test:e2e` | 9 scenarios passing |
| `npm run package:check` | 31 files would ship |
| `git diff --check` | clean |

## Done since 2.0.0

Recorded in full in `docs/qa/runs/2026-09-27-desk-critique.md` and `...-ui-audit.md`, with the decisions in `docs/DECISIONS.md` 26 to 75. In short: one visual language across both surfaces; Return names the tab it looked in, answers on the quote it describes, and keeps what it found; destructive actions share one idiom that counts the cost, focuses the way out and closes on Escape; the draft reads as a document, with provenance promoted and plumbing concealed.

**Four self-inflicted faults, each caught by measuring the running product and each fixed:** animations that never ran, a verdict appearing on a quote nobody checked, a Return that silently broke autosave, and a deleted clip whose quote went on claiming it was found. All four passed their original tests. Every replacement guard asserts a computed or stored value.

**An incognito hole, found in the manual QA and fixed** (decisions 53 to 55): the incognito refusal on `savePassage` and `saveNote` was reachable only from a content script, so the side panel's own Save selection was never checked. An extension page now names a `tabId` the worker resolves, and the panel no longer offers a save it knows will be refused, so the published policy's "never offers to save them" is now true (decisions 57 to 59). **Restart persistence also verified for the first time** in a real profile restart: durable records survive, session storage is completely empty.

## Blocked / needs owner

1. ~~No independent review of the whole Phase A diff.~~ **Done.** Codex reviewed `b49e2da`: eight findings, four P1, plus confirmation of decision 50. All verified here, all fixed, none retracted. Decisions 60 to 68.
2. `docs/store/PERMISSIONS.md` still labels its disclosure "(1.0)" and the AI phase "1.1" while the package is 2.0.0. Store copy the owner approves.
3. Carried over: approve store copy, take screenshots. `main` is pushed; GitHub Pages is live and both URLs were checked by the owner, so the privacy policy URL for the store form is `https://pyogi37.github.io/ReadTrail/privacy-policy`.

**Manual QA genuinely not done:** a real screen reader, Windows high contrast, physical 200% zoom, touch hardware, real third-party articles. Restart persistence is done, and the owner has run the incognito check the harness cannot (decision 55), so both of those are closed. Every automated pass is Playwright Chromium against a local fixture. Unexercised by any critique round: library search, the tags browser, import/export, both Clear buttons, the options page.

## Next task

Decided with the owner after round four, in this order:

1. ~~Redesign the quote block's controls.~~ **Done** (decisions 69 to 75): Return leads the block, the plumbing sits behind one options control, shortcuts are taught where they are used, and the pre-commit review caught a latent undo defect that could write one draft's quote into another.
2. **Run a fifth critique** to measure whether the structural scores moved. Flexibility has been 1 for four rounds; this change targets it and aesthetics directly, and no score should be claimed until one is measured.
3. Then the remaining round-four findings: non-modal confirmations and focus after a confirmed destruction, the heading block holding prose out of view, the dead `.draft-title-input` CSS, and the 11px label scale elsewhere on the Desk.
4. Do the manual QA above. Do not start Phase B. Do not tag or submit a release without the owner.
