# Independent review prompt: the whole of 2.0 Phase A

For a reviewer who has not worked on this branch. Codex is the intended reviewer per `AGENTS.md`; any independent reviewer can use it.

## Why this review exists

Four rounds of design critique have examined the Desk's *surface*. **Nobody has reviewed the worker, the storage layer or the trust boundary end to end**, and Phase A changed the trust boundary. Four defects have already shipped and been caught only by measuring the running product; all four passed their tests. Assume the same class of fault is still present somewhere nobody has measured.

Do not review the design. Review correctness, the trust boundary, and data safety.

## Scope

```sh
git diff a732d4c..HEAD    # Phase A in full: from the last pre-2.0 commit to now
git log --oneline a732d4c..HEAD
```

Phase A begins at `2efa6cf` ("Add drafts and Return, the spine of the 2.0 direction"); `a732d4c` is its parent.

Read `docs/PRODUCT-DIRECTION.md` for intent and `docs/DECISIONS.md` 20–52 for what was decided and why. `docs/ARCHITECTURE.md` has the message and storage tables. Do not edit `docs/PRODUCT-VISION.md`.

## The questions that matter most

**1. The sender trust rule.** `background/service-worker.js` is the only trust boundary. Every runtime message and every stored record is supposed to be validated there.

- Is the extension-origin check genuinely performed before `sender.tab` is consulted, on every path (decision 15)?
- `LIBRARY.isContentSender` and `isExtensionPageSender`: can either return true for a sender it should not? What happens for a message from a page the extension did not author, an iframe, or a worker?
- The worker must never see `tab.url` without the `tabs` permission (decision 14). Is there any new path that assumes it can?
- `revealPassage` is the newest message that reaches into a page. It reads a dormant page at the moment it is invoked and is documented as storing nothing it reads. **Verify that claim against the code**, including `openTabForReveal`, `pendingReveals` and `handleTakeSeededReveal`. Does a seeded reveal survive longer than it should, or become readable by a tab that should not have it?

**2. Storage validation, and what a surface may author.** Decision 40: the worker signs quote provenance so no surface can author provenance it never read. The signature is passage id, text, url and title; `checked` is validated but deliberately not signed.

- Can a compromised or buggy surface now write a quote whose text, url or title does not match a stored passage?
- `checked` accepts `{quality, at, reason}` with `reason` constrained to one literal. Is `cloneDraftBlock` the only way a block reaches storage? Can an unvalidated field survive an import, an export round trip, or `updateDraft`?
- `guardStorage` / `guardGrowingWrite`: are the soft limit and the per-draft limits enforced on every write path, including `appendQuote` and `importLibrary`?
- Import validates every record. Does `replace` mode ever clear the library before it knows the payload is good?

**3. Incognito and dormancy.** Both are non-negotiable.

- One hole here was found and fixed after this prompt was first written (decisions 53 to 55): the incognito refusal in `handleSavePassage` and `handleSaveNote` was reachable only from a content script, so the side panel's own Save selection bypassed it entirely. An extension page now names a `tabId` that the worker resolves with `chrome.tabs.get`. **Verify the new guard rather than rediscovering the old hole**, and look for the same shape elsewhere: any check written as `fromContent && sender.tab.…` is unreachable for the panel.
- Can any *other* path produce a durable record from an incognito tab? Check the context menu, `revealPassage`, `persistResumePoint` and the recently-closed flow.
- `setPageTags` deliberately does not require a tab, because the library tags pages that are open nowhere. Is that the right line, and can it leak an incognito URL?
- Exactly two reader-initiated actions may read a dormant page: `capturePassage` and `revealPassage`. Is there now a third, or a path that reads a page without an explicit reader action?

**4. Per-tab isolation.** Session state is keyed `readtrail.tab.v1:<tabId>`. Phase A added `readtrail.seen.v1:<tabId>`.

- Is `seen` cleaned up on `tabs.onRemoved` / `onReplaced` like the tab record, or does it leak for the session?
- `findSeenTab` matches by URL. Can it return a tab showing a different page, or a tab from another window or profile, and hand the reveal to it?
- Known defect, decision 50: the side panel's `savePassageFromTab` sends `savePassage` from an extension page, so `rememberSeenTab` is never called and Return opens a duplicate tab. **Do not fix it** — confirm the diagnosis and say whether the fix belongs in the worker or the panel.

**5. Failure states.** Every error the reader can see should name a true cause.

- Are there paths where a write is rejected and the reader is told the wrong reason? That exact fault shipped once (decision 40).
- Does any error path leave state half-written — a draft saved without its block, a passage removed with a dangling key?

## What a finding should look like

State the file and line, the concrete input or sequence that triggers it, and the observable consequence for a reader. If you cannot produce a sequence, say so and mark it a suspicion. Prefer one reproducible finding to five plausible ones; six plausible findings were retracted in round four after re-measurement, and every one of them would have become a fix that broke something working.

## How to run it

```sh
npm install
npm test                # 331 passing, 15 files
npm run test:e2e        # 7 scenarios
npm run package:check   # 31 files would ship
```

Chrome behaviour must also be checked by loading unpacked from the repo root. `tests/e2e/helpers.mjs` gives you `launchExtension`, a fixture server, and a bridge page that provides a trusted extension sender.

## Out of scope

Design, copy, layout, motion, the store listing, and Phase B. The block-control redesign is already decided and queued; do not propose it.
