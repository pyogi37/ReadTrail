# Proposal: privacy wording for Return (Decision 26)

**Status: awaiting the owner's confirmation. Nothing in this document has been applied.**

Prepared 2026-09-27 by the lead. Decision 26 is the last thing blocking 2.0 Phase A. It is a wording question, not a code question: Return is built and tested, and the question is how to describe it truthfully.

## What Return actually does

Verified in the code, not assumed:

1. It runs **only** when the reader presses Return on a quote or a clip.
2. The worker reads the stored clip, then asks that page's content script to find it (`content/content.js`, the `revealPassage` branch).
3. The content script resolves the clip's two anchors and, if that fails, searches the page's text for the clip's own words (`content/passage.js`, `revealPassage` and `rangeFromText`).
4. It scrolls the passage into view, flashes it for 2.5 seconds, and replies with one word: `exact`, `approximate`, or `missing`.
5. **The reply is the only thing that leaves the page.** The content script writes nothing and returns no page text.

A dormant page is still dormant in every other sense: no listeners, no pointer tracking, no canvas, no reading-state writes, no ongoing inspection. It reads once, on that press, and stops.

## The finding that changes the framing

**The current wording is already inaccurate in shipped 1.0, before Return exists.**

`PRIVACY.md` and `docs/privacy-policy.md` both say:

> It does not read, track, or store anything on a page before you turn ReadTrail on for that page.

But "Save selection to ReadTrail" has never required activation. `content/content.js`'s `capturePassage` branch has no activation gate and its own comment says "Works on dormant pages too". A reader who right-clicks a selection on a page they never turned on has always had that selection read and stored.

So this is a **correction of an existing error**, not a new concession. The honest rule has always been: *nothing is read automatically; two things are read when you explicitly ask.* Return makes that rule visible rather than creating it.

## One gap in the framing to decide as well

Return adds a new stored item the privacy documents do not yet list: a session record `readtrail.seen.v1:<tabId>` holding the URL of a tab the reader saved a clip from, so Return can come back to that tab instead of opening a duplicate.

It holds a URL the clip already stored, never anything from the page. It is removed when the tab closes and erased when Chrome closes. It is not derived from the search. It should still be disclosed, because the privacy policy lists everything stored.

## Proposed wording, location by location

### 1. `docs/DECISIONS.md` — replace item 26

> 26. **Return reads a source page only when the reader presses Return.** Finding a saved clip resolves its anchors and, if they fail, searches the page for the clip's own words. This happens on that press and nowhere else, including on a dormant page. Nothing found during the search is captured, stored, or returned: the page replies with one of `exact`, `approximate`, or `missing`. Dormancy is otherwise unchanged, and no listener, canvas, pointer tracking, or reading-state write happens on a dormant page. Why this is a correction rather than a concession: "Save selection to ReadTrail" has never required activation either, so the absolute wording in `PRIVACY.md` was already inaccurate in 1.0. Consequence: the privacy documents state one rule, that nothing is read automatically and two actions read on request, and disclose the `readtrail.seen.v1:<tabId>` session record.

### 2. `PRIVACY.md` and `docs/privacy-policy.md` (identical files, change both)

**In "What ReadTrail stores", add one row:**

> | Which page a tab is showing (its URL only) | Only when you save a clip from that tab | `chrome.storage.session` on this device; removed when the tab closes and erased when Chrome closes | So "Return" can bring you back to the tab you are already using instead of opening a second one |

**Replace the first bullet of "What ReadTrail never does":**

Current:

> - It does not read, track, or store anything on a page before you turn ReadTrail on for that page.

Proposed, as two bullets:

> - It never reads a page on its own. Before you turn ReadTrail on for a page it attaches no listeners, follows nothing you do, draws nothing, and records no reading position.
> - Two actions read a page because you asked them to, and only at the moment you ask. **Save selection** reads the text you have selected. **Return** looks for a passage you already saved, so it can scroll you to it. Return keeps nothing it sees: it reports only whether it found the passage exactly, found it by its wording because the page changed, or could not find it.

### 3. `docs/store/PERMISSIONS.md` — the host-permission justification

The existing sentence is already narrow enough to be true ("inspects no DOM for reading position"), but it invites the reviewer to assume more. Proposed replacement for that sentence:

> The content script is dormant until the reader turns ReadTrail on for that exact page in that tab: before activation it registers no event listeners, tracks nothing, draws nothing, records no reading position, and writes no state. Two reader-initiated actions read the page at the moment they are chosen and at no other time: "Save selection to ReadTrail" reads the current selection, and "Return" locates a passage the reader previously saved so the page can be scrolled to it. Return stores nothing it reads; it reports only whether the passage was found exactly, found by its wording, or not found. Automated tests in the public repository assert this dormancy (`tests/content.test.js`, "stays dormant").

The **Website content** disclosure below it stays as written and stays true: content is stored only when the reader explicitly saves a passage, and Return stores nothing.

### 4. `AGENTS.md` — the privacy rule agents read every session

Current:

> - Nothing is captured before activation: no pointer tracking, DOM inspection, canvas, or state writes on a dormant page.

Proposed:

> - Nothing is captured automatically: no pointer tracking, no canvas, no reading-state writes on a dormant page. Exactly two reader-initiated actions read a dormant page, at the moment they are invoked: `capturePassage` (Save selection) and `revealPassage` (Return). Return stores nothing it reads. Do not add a third without the owner's decision.

### 5. `docs/STATUS.md` — the blocked item

Replace the Decision 26 blocker with a line recording the owner's confirmation and the date, once given.

### 6. `CHANGELOG.md` — leave the 1.0 entry alone

Its privacy line describes the released 1.0 and should not be rewritten. The 2.0 entry should carry the rule in its own words when 2.0 ships.

### 7. `docs/PRODUCT-VISION.md` — the owner's file, and possibly no change needed

Line 109 reads:

> - No reading state is captured before activation on a page.

That is already true and stays true. Return captures no reading state. If the owner wants the vision to name the two explicit exceptions for completeness, that is their edit to make; the lead has not touched this file.

## Recommendation

Approve the wording above. It makes the documents more accurate than they are today, in a direction that also fixes a pre-existing overstatement about Save selection, and it discloses one session record that was previously undocumented.

## What happens on approval

One commit, docs only, no code change: items 1 through 5, plus the same edit to both copies of the privacy policy. Then Phase A's owner-gated item is closed and the remaining release work is the manual QA that has not yet been done on real sites, in high contrast, at 200% zoom, with a screen reader, and across a Chrome restart.
