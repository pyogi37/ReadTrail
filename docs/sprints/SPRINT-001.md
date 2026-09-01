# Sprint 001: Resume Position Foundation

## Status

In progress

## Goal

Within the current browser session, a reader can explicitly activate ReadTrail for one exact page, establish or freeze a reading line, hide it, restore it, and resume at that line after reloading or revisiting the same page.

This sprint implements the already-approved foundation: intentional per-page use and trustworthy reading-position memory.

## User outcome

> I can choose to use ReadTrail on this page, stop at a line, and return to the same line without ReadTrail silently creating permanent reading history.

## Scope

- Current-page activation from the extension popup.
- Inactive by default for every exact page URL.
- Dormant, following, and frozen content-script states.
- One temporary reading-position record per exact page URL.
- Page-wide reading lock with single-click freeze and unfreeze at readable positions, including text inside interactive elements.
- A clear popup warning before activation that clicked page controls are unavailable while ReadTrail is active.
- Hide without deletion when current-page activation is turned off.
- Restore on reactivation, reload, or revisit during the same browser session.
- DOM anchor restoration for an unchanged document, with scroll-position fallback.
- SPA URL-change protection so activation does not bleed into another route.

## Non-goals

- Persistent bookmarks and double-click bookmark creation.
- Saving across browser restarts.
- Save-on-close prompts or save preferences.
- Reading history, completed items, or the reading space.
- Site exclusions and permanent-data deletion controls.
- Cloud sync, accounts, analytics, AI, passage capture, or knowledge connections.
- Guaranteed exact restoration after a page's content materially changes.
- A new dynamic content-script injection architecture.

## State boundary

Global appearance preferences remain in `chrome.storage.local`.

Temporary reading state lives in `chrome.storage.session`, accessed only through validated service-worker messages:

```text
readingPages[exactUrl] = {
  version: 1,
  active: boolean,
  mode: "following" | "frozen",
  position: null | {
    anchor: object | null,
    viewportOffset: number,
    scrollY: number,
    scrollRatio: number,
    savedAt: number
  }
}
```

The record must not contain page titles, passage text, page content, or a cross-session browsing log.

## Interaction rules

- Dormant pages create no canvas, pointer listener, anchor lookup, or reading-state write.
- A primary single click on readable text freezes the current line.
- A primary single click while frozen resumes following.
- Double-click is reserved for a later bookmark sprint and must not cause two single-click transitions.
- While active, primary clicks are reserved for ReadTrail and do not activate underlying links, buttons, or controls.
- Active text selection is preserved and does not toggle the checkpoint; scrolling remains available.
- Non-primary clicks are not reading-position gestures.
- Turning ReadTrail off restores normal page clicks immediately.
- Turning the current page off removes visual markers while retaining its session position.

## Acceptance criteria

1. A fresh page is inactive and produces no canvas or position record.
2. Activating page A does not activate a different exact URL.
3. Appearance settings remain global while activation and position are page-specific.
4. Pointer movement on an active page updates the current visual line without unbounded storage writes.
5. A single primary click freezes a readable position; pointer movement no longer moves the marker; another single click resumes following.
6. While active, primary clicks on links and controls are intercepted by reading lock and can checkpoint readable text without activating the underlying element.
7. The popup warns about reading lock before activation; selected text, scrolling, and non-primary clicks are not treated as checkpoint gestures.
8. Turning ReadTrail off removes its visual markers without deleting the session anchor and restores normal page clicks.
9. Turning it back on restores and scrolls to the same line.
10. Reloading or revisiting the exact URL within the browser session restores the position.
11. Restarting the browser clears the temporary reading record.
12. An unresolved DOM anchor falls back to stored scroll position without breaking the page.
13. An SPA URL change cannot carry activation into a new route.
14. Runtime messages and stored records are validated before use.
15. Existing tests remain green and new behavior has automated coverage.
16. Manual Chrome verification covers a long static page, two URLs, reload, off/on restoration, reading-lock interception, and an SPA route change.

## Work breakdown

### RT-001 — Product and agent baseline

- Owner: Codex
- Files: `README.md`, `docs/PRODUCT-VISION.md`, `AGENTS.md`, `DEVELOPMENT.md`, this sprint document, OpenCode agent profile
- Result: shared scope and operating rules committed before implementation

### RT-002 — Position anchor module

- Owner: OpenCode, reviewed by Codex
- Files: `content/position.js`, `tests/position.test.js`
- Result: capture, serialize, validate, resolve, and fall back without storing page text

### RT-003 — Session state and messages

- Owner: Codex
- Files: `background/service-worker.js`, `tests/background.test.js`
- Result: validated page-state read/write messages backed by `chrome.storage.session`

### RT-004 — Content lifecycle

- Owner: OpenCode, reviewed and integrated by Codex
- Files: `content/content.js`, `content/renderer.js`, `content/content.css`, `tests/content.test.js`, `tests/renderer.test.js`
- Result: dormant/following/frozen states, guarded click behavior, throttled checkpoints, restoration, and SPA protection

### RT-005 — Current-page popup

- Owner: OpenCode, reviewed and integrated by Codex
- Files: `popup/popup.html`, `popup/popup.css`, `popup/popup.js`, `tests/popup.test.js`, `options/options.html`, `options/options.js`, `tests/options.test.js`
- Result: current-page activation replaces the conflicting global enable control

### RT-006 — Integration and verification

- Owner: Codex
- Files: `manifest.json`, documentation, and tests as needed
- Result: complete review, automated checks, manual Chrome verification, sprint notes, commit, and push

## Risks to watch

- DOM layout and caret APIs cannot be fully tested in JSDOM.
- Dynamic pages can invalidate anchors or shift after restoration.
- Double-click browser event ordering can accidentally toggle state twice.
- Frequent checkpoints can create unnecessary storage traffic.
- Multiple tabs on the same exact URL use last-write-wins session state in this sprint.
- Incognito behavior must be verified before claiming that privacy commitment is complete.
- Sites that perform actions during `pointerdown` or `mousedown` can act before click interception; blocking those earlier events would also break native text selection and is not part of this sprint.

## Sprint evidence

- Pre-sprint baseline: 5 test files, 14 tests passing.
- Independent audits: Codex and OpenCode agreed on the opt-in and position-model gaps.
- Production dependency budget: no new dependency approved.

## Progress

- RT-001 complete: product vision, sprint contract, SDLC, and agent boundaries committed.
- RT-002 complete: OpenCode implemented the position anchor module; Codex reviewed and hardened it; 6 test files and 23 tests pass.
- RT-003 complete: Codex added validated, exact-URL page state backed by `chrome.storage.session`; 6 test files and 27 tests pass.
- RT-004 complete: dormant/following/frozen lifecycle, exact-URL reload restoration, guarded clicks, throttled checkpoints, save-before-off acknowledgement, and async race coverage; 6 test files and 43 tests pass.
- RT-005 complete: the popup now controls only the active exact page with save-before-off and rollback handling; options now contain appearance settings only; 6 test files and 60 tests pass.
- RT-006 automated integration complete: the manifest loads position capture in order, uses `activeTab` plus `storage`, removes the legacy global enable path, and documents unpacked-extension reloads; 7 test files and 63 tests pass.
- Reading-lock correction implemented after live feedback: primary pointer clicks now checkpoint linked or controlled text without activating standard page clicks, keyboard/programmatic and non-primary clicks remain outside the gesture, the popup warns before activation, and line anchors use the visual line center; 7 test files and 66 tests pass.
- RT-006 manual Chrome verification is in progress. The unpacked extension has been reloaded and the page-level flow has been exercised in Chrome; popup off/on restoration and the extension service-worker console still require user-visible Chrome UI.

## Manual Chrome verification record

Automated browser control cannot access Chrome's internal extension manager. After the unpacked extension is reloaded and the test pages are refreshed, verify:

- [ ] A fresh long-form HTTP(S) page shows **Use on this page** and creates no marker before activation.
- [ ] Activating the page creates the reading marker and pointer movement follows readable text.
- [ ] Before activation, the popup explains reading lock clearly.
- [ ] A primary click on linked text freezes the marker without following the link; another click resumes following; a double-click does not toggle twice.
- [ ] The frozen marker aligns with the visual center of the intended text line.
- [ ] Keyboard activation, programmatic clicks, text selection, and non-primary clicks do not create checkpoints.
- [ ] Turning the page off hides the marker; turning it on restores the same session position.
- [ ] Reloading the exact URL restores and scrolls to the saved position.
- [x] A second exact URL remains inactive until independently activated.
- [x] After an SPA route change, the old page marker disappears on the next reading interaction.
- [ ] Chrome's extension service-worker console has no errors during the flow.

### Live Chrome evidence — 2026-09-01

- The active arXiv article restored with one trail canvas at scroll position `830.4`; pointer movement visibly moved the ruler across readable text.
- A primary click froze the ruler while later pointer movement left it fixed. A second primary click resumed following.
- A native double-click left following mode active; subsequent pointer movement moved the ruler to the new line.
- After freezing, scrolling from `830.4` to `2230.4`, and reloading, the article returned to `830.4` with one trail canvas.
- Navigating the active GitHub repository page to its `/issues` SPA route initially retained the old canvas; the next reading interaction removed it, and the new exact URL remained inactive.
- No page-level console errors were reported on either test page. This does not replace checking the extension service-worker console.
