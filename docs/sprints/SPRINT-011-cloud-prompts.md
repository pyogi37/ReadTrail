# Sprint 011: two cloud sessions

Start each with **Start a cloud session**, repository **pyogi37/ReadTrail**, branch **main**, model **Opus**. Paste one prompt per session. Both can run at the same time; they never edit the same file.

---

## Session A: text blocks that read as prose

```
You are the cloud session for PART A of ReadTrail Sprint 011. Another cloud session does part B at the same time; you never touch its files.

REPO AND RULES
- You are on a clone of pyogi37/ReadTrail at main (574ae7a or later). Create branch sprint-011/text-blocks.
- Read first: AGENTS.md, docs/PONYTAIL.md (smallest complete change; never cut validation, accessibility or prefers-reduced-motion), docs/sprints/SPRINT-011.md (your part is "Part A", criteria A1 to A4), and docs/DECISIONS.md items 41, 42, 44, 69 to 75 and 89 to 101.
- graphify-out/ is not in the repo, so the project's graphify rule does not apply: use grep and targeted line-range reads.
- EDIT ONLY: sidepanel/desk.css and a new tests/e2e/desk-layout.spec.mjs. Do not edit tests/desk.test.js, any other source, or any doc. If an existing test breaks because of your CSS, do not change it: say which and why in your report.
- No new permission, dependency, network call, runtime message or stored field.

WHAT TO BUILD (details and criteria in the sprint doc)
- Text blocks grow with their text: field-sizing: content on .block-text (Chrome 123+; on 114-122 it is ignored and blocks keep today's height). Today .block-text has min-height: 88px (desk.css ~L315) and .block-text.heading-block-text ~L325; the textarea also has rows=3 set in draft-view.js, which field-sizing: content overrides.
- Text blocks lose their card: .draft-block (~L301) gives every block a border, background and 12px padding; .quote-block (~L310) overrides colours. Make text blocks borderless and backgroundless with less space between consecutive text blocks; quote blocks keep their frame. The list gap is on .draft-blocks (~L296).
- Keep everything usable: the options toggle (.block-options-toggle), the drag handle (.block-handle, which straddles the card's left border today) and the undo slot keep sensible positions and 24px-or-larger targets, stay hidden from hit testing where invisible (decision 44), and the focused textarea keeps a clearly visible focus indicator. Respect the global prefers-reduced-motion rule in sidepanel.css (do not edit sidepanel.css). Match the existing quiet styling; no new colours outside the palette tokens.

PROOF
- New tests/e2e/desk-layout.spec.mjs using tests/e2e/helpers.mjs (launchExtension, startFixtureServer, sendMessage, deskUrl; see the Desk scenarios in tests/e2e/reading.spec.mjs). Measure in Chromium at 1280 and 390: A1 (one line no taller than line plus padding; a six-sentence paragraph has scrollHeight == clientHeight), A2 (text block border and background transparent, quote block keeps its border; text-to-text spacing smaller than text-to-quote), A3 (handle and options control sizes >= 24px, focus indicator visible on a focused textarea).
- Run npm ci, npm test, npm run test:e2e, npm run package:check (expect 30 files) and git diff --check. If Chromium or Playwright is missing, install it with npx playwright install chromium. If something cannot run here, say exactly what and why.

HAND-BACK
- Commit on sprint-011/text-blocks with an imperative summary and a body listing behaviour changes, ending with the line "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>". Push ONLY that branch: git push -u origin sprint-011/text-blocks. Never push main, never force-push, never tag, never open a PR.
- End with a short report: branch and head SHA; files changed; each criterion A1..A4 with the test that proves it; test results with counts; any existing test that broke and why; decisions the lead should record; anything unverified.
```

---

## Session B: the four P1s

```
You are the cloud session for PART B of ReadTrail Sprint 011. Another cloud session does part A (sidepanel/desk.css and a new e2e spec) at the same time; you never touch its files.

REPO AND RULES
- You are on a clone of pyogi37/ReadTrail at main (574ae7a or later). Create branch sprint-011/desk-messages.
- Read first: AGENTS.md, docs/PONYTAIL.md (smallest complete change; never cut validation, accessibility or prefers-reduced-motion), docs/sprints/SPRINT-011.md (your part is "Part B", criteria B1 to B5), docs/DECISIONS.md items 41, 42, 61, 69 to 75 and 89 to 101, and the round-six section at the end of docs/qa/runs/2026-09-27-desk-critique.md.
- graphify-out/ is not in the repo, so the project's graphify rule does not apply: use grep and targeted line-range reads.
- EDIT ONLY: sidepanel/draft-view.js, sidepanel/desk.js, sidepanel/desk.html, tests/desk.test.js, tests/e2e/reading.spec.mjs. Not sidepanel/desk.css (part A owns it): if moving the status line needs a style change, say exactly which rule in your report and the lead adds it at merge. No doc edits; the lead writes them. No new permission, dependency, network call, runtime message or stored field.

WHAT TO FIX (criteria in the sprint doc)
- B1, Quote at 390px leaves focus on <body>. sidepanel/desk.js ~L99-106: the quote handler calls draftView.quoteInto and shows the Draft pane only in its callback, but quoteInto (draft-view.js ~L1388-1422) renders and asks for focus on the new quote's Return (pendingFocus ~L1413) before that callback runs, while the Draft pane is still hidden. Show the Draft pane before the quote is placed. A failed quote must still reveal the pane and its message.
- B2, a failed-save alert outlives the save. setStatus (draft-view.js ~L92) never clears an alert, and the success branch of processSaveQueue never clears the one a failed save of that draft put up. Clear that alert, and only that one, when the open draft's next save succeeds. saveErrorText's invalid-input message names two possible causes; name the one that applies: an empty title says the draft needs a title; otherwise say it could not be saved, without guessing at block length.
- B3, messages for a closed draft are invisible. #draftStatus sits inside <article id="draftEditor" hidden> (desk.html ~L116-129), so "Open a draft first, then quote a clip into it.", "Draft removed." and "That draft no longer exists..." are announced into a hidden box. Move the status line out of the editor so it shows whether or not a draft is open. The undo offer keeps its place in the block list (decision 42; see how els.undo and its home are wired in draft-view.js init).
- B4: every existing test in tests/desk.test.js and the Desk e2e scenarios keeps passing. If one asserts the old DOM position of #draftStatus, change only that assertion and say so in your report.

PROOF
- Unit tests in tests/desk.test.js for B2 (alert cleared by the next successful save; the right message for an empty title) and B3 (each of the three messages visible with no draft open). A Playwright scenario in tests/e2e/reading.spec.mjs for B1 at 390x844: open a draft, switch to Sources, Quote a clip, assert the Draft pane is visible and focus is on the new quote's Return.
- Run npm ci, npm test, npm run test:e2e, npm run package:check (expect 30 files) and git diff --check. If Chromium or Playwright is missing, install it with npx playwright install chromium. If something cannot run, say exactly what and why.

HAND-BACK
- Commit on sprint-011/desk-messages with an imperative summary and a body listing behaviour changes, ending with the line "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>". Push ONLY that branch: git push -u origin sprint-011/desk-messages. Never push main, never force-push, never tag, never open a PR.
- End with a short report: branch and head SHA; files changed; each criterion B1..B5 with the test that proves it; test results with counts; any existing assertion you changed and why; any desk.css rule the lead must add; decisions the lead should record; anything unverified.
```
