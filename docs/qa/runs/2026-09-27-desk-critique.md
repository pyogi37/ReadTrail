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

## Round five, 2026-10-09

Measured before Sprints 009 and 010 landed, so its scores describe the Desk as of `aaefe94`; the critique that measures Sprint 010 is a separate round. Brought into `main` on 2026-10-29 from the uncommitted log in the privacy task's worktree.

Same protocol: two isolated parallel sub-agents, both barred from `.impeccable/critique/`, `docs/qa/runs/`, `docs/STATUS.md` and `docs/DECISIONS.md`. Measured in headless Chromium against the unpacked extension at `aaefe94`. Snapshot persisted at `.impeccable/critique/2026-10-09T16-20-32Z__sidepanel-desk-html.md`.

**Score: 23/40.** Assessment A reached 26 alone; the synthesis took one point each from visibility of status, user control and error recovery for defects only Assessment B measured. Five rounds read **19 → 21 → 19 → 20 → 23**. The structural scores moved for the first time: flexibility 1 → 2, recognition 2 → 3, help 2 → 3, all traceable to the quote-block redesign (decisions 69 to 75). Aesthetics stays at 2.

**Found, not yet fixed:**

- **P0.** Undoing a removed quote after its 400ms autosave makes every later save fail: the worker accepts only quotes already in the stored draft (`background/library.js:490-511`), the UI blames the title (`sidepanel/draft-view.js:308`), and later typing is lost on reload. Reproduced twice; cause confirmed in code.
- **P1.** "Replace instead of merge" imports without confirmation and removes every draft and clip not in the file; the status reports only what was imported, and the box stays ticked.
- **P1.** Five untrue statements: a draft summary still claiming "found exactly" after its clips are cleared; Return highlighting the first of two identical sentences; Return on an excluded site reporting a failure that did not happen; save errors naming the wrong limit; the export message (and the privacy policy's Export section) omitting drafts.
- **P1.** Quote with no draft open writes its message into the hidden editor, so nothing is shown or announced.
- **P1.** At 960px and wider both panes share one scroll, so a quote pulls Sources away; at 390px focus lands on `<body>` after quoting.

**Confirmed working by measurement:** Return across intact, moved, rewritten, deleted and closed-tab sources; Escape and focus return in every confirmation and options row; Alt+↑/↓ and Ctrl+Enter; merge import counts match storage; "Clear saved places" removes only saved places; removing a draft keeps its clips; autosave in 482ms surviving reload; 67 of 67 controls named; zero console errors; no horizontal overflow at 1280 to 320; reduced motion fully honoured.

**Detector:** `desk.html` clean. `sidepanel.html`'s 14 low-contrast findings are decision 30's false positive again (`#fdf4f4` is the 7% accent gradient over white). It missed the browser-default placeholder grey at 3.22 to 3.60:1. **No overlay exists**: `script-src 'self'` refused both injection paths.

**Exercised for the first time:** library search, the Tags view, export, merge and replace import, and both Clear buttons. Still untested: a real screen reader, forced colours, touch hardware, the real side panel's right-click capture, headed Chrome.

## Round six, 2026-10-29

The first round run as two cloud routines (claude.ai, Opus 5.5), each an isolated session that cloned `main` at `1818cc1`: Sprint 010 and the round-five P0 fix. Both were barred from this log, `.impeccable/`, `docs/STATUS.md`, `docs/DECISIONS.md`, `docs/PRODUCT-DIRECTION-2.1.md`, the handoffs and the sprint docs. Both used impeccable 4.8.0. The routines' permission classifier blocked `npx skills add`, so A read the skill from a plain clone, and B ran the checksum-verified detector engine 0.1.18 from `npm pack`. Measured in headless Chromium against the unpacked extension, with real key and pointer events.

**Score: 26/40, Acceptable.** Assessment A gave 27 and Assessment B gave 28. The synthesis takes the lower score where the other assessment measured the defect behind it: user control falls to 2 for A's P0, error recovery to 2 for B's lingering alert, and aesthetics to 2 for A's finding that the draft reads as a form. Six rounds read **19 → 21 → 19 → 20 → 23 → 26**.

| # | Heuristic | A | B | Synthesis |
|---|---|---|---|---|
| 1 | Visibility of system status | 3 | 3 | 3 |
| 2 | Match with the real world | 3 | 3 | 3 |
| 3 | User control and freedom | 2 | 3 | 2 |
| 4 | Consistency and standards | 3 | 3 | 3 |
| 5 | Error prevention | 2 | 2 | 2 |
| 6 | Recognition rather than recall | 3 | 3 | 3 |
| 7 | Flexibility and efficiency | 3 | 3 | 3 |
| 8 | Aesthetic and minimalist design | 2 | 3 | 2 |
| 9 | Error recognition and recovery | 3 | 2 | 2 |
| 10 | Help and documentation | 3 | 3 | 3 |

**What direction 2.1 section 3.2 asked:** flexibility moved again, from 2 to 3, and both assessors scored it 3 on keys that cross blocks, Alt with an arrow, Control with Enter, drag and deep links. It was 1 for four rounds. So the editor is not redesigned again. Aesthetics did not move: it stays at 2, and both assessments name the same cause. Every text block is a bordered card with a fixed three-row textarea, so the draft reads like a form, and long paragraphs scroll inside their own boxes.

**Design specificity (A):** authored, not generic. The verdict on each quote, the provenance summary and the pencil-red and kept-gold palette belong to this product. The block cards and the stacked pane headers are generic app chrome.

**Found:**

- **P0, fixed the same day (decision 100).** While a removed quote's Undo stood, each autosave rebuilt the editor: typed words were lost and focus fell off Undo. The cause was decision 98's stored copy failing decision 41's own-write check (`sidepanel/draft-view.js:148` with `:246`).
- **P1.** At 390px, Quote leaves focus on `<body>`. The focus is asked for while the Draft pane is still hidden (`draft-view.js:1412`, `desk.js:103`). Round five found the same at 390px.
- **P1.** Text blocks never grow (`area.rows = 3`, `min-height: 88px`). A six-sentence paragraph needs 208px and gets 88.
- **P1.** A failed-save alert stays after the next save succeeds, and the message names two possible causes instead of the one that applies (`draft-view.js:92`, `:273`).
- **P1.** Messages written to the draft status line are invisible when no draft is open. "Open a draft first", "Draft removed." and "That draft no longer exists" all land inside the hidden editor (`desk.html:116,127`). This is round five's P1, still open.
- **P2.** Return's text fallback only finds identical wording. A one-word edit to the paragraph reports "not found", although the help promises "by its wording". It can also report "by its wording" for a different paragraph with the same sentence (`content/passage.js:276-285`; partly an artefact of the fixture's repeated prose).
- **P2.** Placeholders measure 3.22 to 3.58:1, because no `::placeholder` colour is set (`#newDraftTitle`, `#librarySearch`, `#draftTags`).
- **P2.** In Sources, five buttons are named just "Quote", with repeated "Edit passage note" and "Remove this passage" (`knowledge-view.js:361`).
- **P2.** A quote whose clip was deleted keeps its Return until it is pressed, although the Desk already knows the clip is gone (`draft-view.js:885`).
- **P2.** Quote always appends at the end of the draft.
- **P2.** The draft title gets about 185px at 1280 and is cut off by the three action buttons (`desk.css:205-211`).
- **P2.** At 390px the first writing block starts about 780px down, below the header, help, tabs, pane intro, New draft form and drafts list.
- **P3.** The export message omits drafts (round five's, still open). `summary` and the skip link use Chrome's 1px outline instead of the 2px ring. The New draft form is a card inside a card. Much secondary text is 11px. `.quote-cite` declares colour and size twice. One object is called clip, passage and block in different places, and the literal `# ` stays visible in headings.

**Detector:** `desk.html` 0 static findings. `sidepanel.html` had 9 low-contrast findings, all decision 30's false positive again: the gradient was laid over white instead of `#17141f`, and the real ratios are 16.15, 7.36 and 5.36 on the plain background and at least 14.05, 6.40 and 4.66 at the Desk gradient's peak. Live scans over CDP confirmed the two placeholder findings and missed `#draftTags`. Tiny text on `#libraryUsage` and the kicker above the heading are arguable. Nested cards on `#newDraftForm` are confirmed.

**Confirmed working by measurement:**
- Every Sprint 010 behaviour worked: Enter at the end, quiet Backspace, crossing at the edges and over quotes, Alt with an arrow announcing the new position, Control with Enter, and drag with a drop line and Escape.
- Undo restored text and quotes, with storage keeping the quote during the offer.
- Return behaved in all four conditions, and its verdicts survived a reload.
- Markdown Copy and Download were byte-identical.
- Search, tags and their deep links worked; merge import counts were right; and a quoted clip's deletion warning named the draft.
- Keyboard: 63 tab stops at 1280 and 30 at 390, each with a visible indicator.
- Accessibility tree: 0 unnamed controls.
- Every visible target is at least 24px apart from one native checkbox. There was no overflow at 390 or 1280 and zero console errors. Reduced motion leaves no animations.

**Still untested:** the real side panel, touch hardware, a screen reader's speech, IME, reading the clipboard back, storage-full and draft-full saves, two Desk tabs editing one draft, replace-mode import, and round five's excluded-site and duplicate-sentence cases.
