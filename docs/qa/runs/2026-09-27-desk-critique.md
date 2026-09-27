# Desk critique, two rounds, 2026-09-27

Run with the `impeccable` skill (v4.4.0), following `reference/critique.md`. Both rounds ran the required two isolated assessments: a design review that never saw detector output, and a detector-and-browser pass that never saw the review. Evidence is measured in Chromium against the unpacked extension.

## Score

| Round | Score | Band |
|---|---|---|
| Before any fixes | 19/40 | Poor |
| After the first five fixes | 21/40 | Acceptable |
| After the second round | 19/40 | Poor |
| After the third round | 20/40 | Acceptable |

All ten heuristics applied both times; this is an Operate surface, so neither flexibility nor help was eligible for `n/a`.

Two points for five fixes looks thin, and the reason is worth recording: three of the five landed cleanly, but the two heuristics already at the floor, flexibility and help, had not been touched at all, and two of the fixes introduced new inconsistencies that cost back what the composition gained. Both were then fixed in the second pass, along with everything else below. The score has not been re-measured since; the next run should do that before anyone claims a number.

## Confirmed fixed, verified against the running interface

- **Return's honesty.** Four conditions driven against a real mutating page: intact and the tab open, paragraph moved, paragraph deleted, source tab closed. Four correct answers, and the "opened a fresh tab" clause present and accurate.
- **The two dead animations.** `animation-name` computes to a real name with a real duration, `animationstart` fires on quote, insert and both move directions, and `prefers-reduced-motion` suppresses all of it with zero events.
- **The verdict's placement.** It renders inside the quote block as a sibling after the citation, never above the block list, carries `data-quality`, takes focus, and shows a visible ring on programmatic focus. Contrast of the three states: 11.61, 14.63, 8.32.
- **Live draft updates and deep links.** A second Desk tab went from one draft row to two when the first created one; a route to a draft made after page load resolves.
- **Target sizes.** Both previous misses now measure 24.0.
- **Accessible names.** Chrome's own accessibility tree reports no empty name on any button, link, input, tab or heading.

## Found in the second round and fixed

- **A verdict appeared on a quote nobody checked.** Quote one clip twice, press Return on the first, make any edit: the second showed the first one's answer. Caused by the fix that moved verdicts onto quotes, which keyed the cache by passage id. Worse than the problem it replaced, because it asserted a fact the product was never told.
- **Removing a clip had no confirmation, no undo and no message**, while it silently severed every quote of it in every draft. Protection had been inversely proportional to damage.
- **A hidden semantic heading announced its block's whole body**, so a screen reader's heading list carried prose in every entry.
- **Restoring a draft from the address bar took the caret**, stranding the entire Sources pane behind the landing point for a forward-tab reader.
- **The accent fix was half done**: a maintenance Save inherited a full-column width and became the loudest control on the page, and gold had come to mean both Quote and Continue reading.
- Plus: no keyboard accelerators anywhere, no help on the Desk, provenance set smaller than the buttons beside it, four destructive idioms, a status line that never cleared, and three pieces of dead code.

## Detector

`impeccable detect` reports 0 findings against `desk.html`. The 22 low-contrast findings against the sibling panel are the false positive of decision 30, and the second round proved the mechanism rather than trusting the record: both invented backgrounds were reproduced bit-for-bit by compositing the repository's own alpha tokens over an assumed white page. Real ratios are 16.15, 7.36, 5.36 and 8.34.

One finding is real but arguable: the verdict block matches a "coloured side border on a padded, rounded, filled box" rule. It is a deliberate treatment, the colour is never the only signal, and each state carries its own wording.

## Not tested, and not claimed

No overlay was produced. Injection was attempted and refused by the extension's content security policy, which blocks both remote and inline scripts; the fallback was direct instrumentation inside the page's own origin.

Still untested by anyone: a real screen reader, Windows high contrast, physical 200% zoom, touch hardware, Chrome restart persistence, an incognito window, and real third-party articles. These remain the manual release checks and no automated pass substitutes for them.

---

## Round three

Run after the second round of fixes, same protocol, two isolated assessments.

**Score: 19/40, back where it started.** The composition of that number changed: aesthetics rose from 2 to 3 and help from 1 to 2, both earned, while visibility of status, error prevention and error recovery each fell from 2 to 1. The second round had bought polish with correctness.

**Confirmed landed by measurement:** the verdict no longer bleeds onto an unchecked quote; the semantic heading announces its first line only; a route restore no longer takes focus; one solid accent control on the whole screen; Return's three outcomes correct across four conditions; animations run and reduced motion suppresses them; no native dialog anywhere; zero console errors; zero horizontal overflow; zero controls under 24px; zero unnamed controls in Chrome's own accessibility tree; a visible focus indicator at all 24 tab stops.

**Found, all introduced in this session, all fixed:**

- **Every Return silently broke the draft it reported on.** Persisting the outcome made the quote fail the worker's provenance signature, so every autosave afterwards was rejected and the reader lost everything typed next, under a message that named the wrong cause. The guard now signs provenance alone.
- **The Desk rebuilt the editor after its own saves**, because a storage change fires in the page that caused it. The caret left the block being typed in, and the undo offer was destroyed about 650ms into the twelve seconds it promised.
- **Undo could destroy a block**, clamping its insert index before dropping the placeholder, and mistaking an empty block the reader already had for its own.
- **The confirmation destroyed on one keypress**, focusing the destructive button with no Escape, where the native dialog it replaced did the opposite.
- **A fully transparent "Remove block" was still the topmost hit target**, hidden with opacity alone.
- **The summary counted checked quotes against every quote**, claiming something about quotes nobody examined, in gold.

**Not measured since these fixes.** A fourth round should establish the current score; the 19 above predates them.

**Assessment B's own corrections, worth recording** because they are the same discipline this project asks of itself: it retracted three of its own findings after re-measuring, having first reported invisible action rows, missing animation starts, and unnamed controls, each an artifact of how it measured rather than a fault in the product.

---

## Round four

Same protocol, two isolated parallel sub-agents. This round both were also barred from `.impeccable/critique/`, `docs/qa/runs/`, `docs/STATUS.md` and `docs/DECISIONS.md`, so neither could read the previous rounds' findings. Snapshot persisted at `.impeccable/critique/2026-09-27T08-10-30Z__sidepanel-desk-html.md`.

**Score: 20/40.** Assessment A reached 20 independently; the synthesis reached the same number from the combined evidence. Four rounds now read **19 → 21 → 19 → 20**, and that flat line is the finding of this round. Every round fixed real defects and left the structural scores untouched, because each round's work went on repairing the previous round's honesty defect. Flexibility has been 1 in all four rounds.

Only rounds one and four exist as snapshots; two and three were recorded here as prose, so the trend helper shows `19 → 20`. The sequence above is the real one.

**The P0, reproduced and fixed this round.** A failed Return was reversed by the next render and never reached the summary:

| step | the quote said | the summary said |
|---|---|---|
| successful Return | "Opened the page in a new tab and found the passage there." | 1 found exactly |
| its clip removed | unchanged | 1 found exactly |
| the Return that fails | "That clip is no longer in your library." | 1 found exactly |
| one block added | "Found exactly when you last checked, just now." | 1 found exactly |
| after a reload | "Found exactly when you last checked, just now." | 1 found exactly |

The two assessments contradicted each other here and both were right about different branches: a reveal that succeeds and reports `missing` was handled correctly all along; a reveal that returns `!ok` wrote nothing. Fixed in `d2d9b3e`, with guards that assert the stored value and the text after a rebuild, both confirmed to fail against the old code.

**Confirmed working by measurement:** Return's wording true across intact, moved, deleted and tab-closed, each naming the tab it used; the flash is the Custom Highlight API with zero DOM mutations over 2.4s, and reduced motion keeps it at an identical 2401ms while decorative animation drops to zero events; 0 of 71 controls unnamed in Chrome's own accessibility tree; 27 of 27 tab stops show a visible focus indicator under real Tab presses; zero horizontal overflow at 360, 400, 900 and 1280; zero console errors across twelve runs; zero contrast failures by two independent methods, the pixel method putting the true floor at 4.94:1 where the computed method said 5.36; typing survives three cases including Return firing inside the autosave debounce.

**Found and not yet fixed** (the block-control pass owns most of these):

- Return can only reuse a tab it was told about, and the side panel's own Save selection never tells it — decision 50.
- `.btn-remove-block` and `.btn-insert-below` compute to identical colour, border and background, one Tab apart, both hidden until hover, and Remove fires with no confirmation, while removing a whole draft is permanent.
- The confirmations are not modal and do not contain focus; Escape works only from inside them; two can be armed at once; focus drops to `<body>` after a confirmed destruction, and after the block undo's 12s window expires. `desk.html` promises unqualified that Escape closes a confirmation.
- A heading block renders the reader's whole paragraph at 21px Georgia and holds 28px of it out of view (`clientHeight 101` against `scrollHeight 129`).
- `.draft-title-input`'s intended 22px display face is dead CSS, lost to `sidepanel.css:723` at equal specificity; the draft's own title renders identical to the library search field.
- 48 of 64 rendered text nodes are under 13px; every interactive label is 11px.
- `#draftUndo` is a `<button>` placed as a direct child of `<ol id="draftBlocks">`.
- Five tab stops fall back to Chrome's default 1px ring instead of `--focus`.
- At 1280px the panes keep `role="tabpanel"` while the tablist is `display:none`, leaving orphaned tabpanels; `Home` does nothing on the tablist at 360px.

**No overlay exists.** Injection was attempted three ways — inline, `file://`, and a served localhost script — and all three were refused by MV3's default `script-src 'self'`, with the console refusals recorded. Every measurement came from `page.evaluate`, CDP and screenshot pixel diffs.

**The detector result was an artifact**, and this round is the first to prove it — decision 49.

**Assessment B retracted six of its own findings** after re-measuring: an overlapping button (a closed `<details>` still returns a plausible rect), invisible-but-clickable hover controls (a teleported cursor does not trigger `:hover`; a ten-step move does), unreachable tab stops (its own `blur()` baseline dropped `:focus-within`), a status line that never clears (its polling arithmetic ran 5.4s while labelled 12s), a flash covering 18% of the viewport (8× too high, the figure included a 40px scroll re-centring), and an entire Return-honesty run voided for having mutated the reader's tab while Return used its own. Every one would have become a fix that broke something working.

**Still untested by anyone:** a real screen reader, Windows high contrast, physical 200% zoom, touch hardware, Chrome restart persistence, an incognito window, real third-party articles. Unexercised by any round: library search, the tags browser, import/export, both Clear buttons, the options page, and the panel surface beyond a detector scan.

