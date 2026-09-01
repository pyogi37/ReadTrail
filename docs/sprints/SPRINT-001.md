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
- Single-click freeze and unfreeze on readable, non-interactive text.
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
- Links, buttons, inputs, editable content, active text selection, and non-primary clicks are ignored.
- Turning the current page off removes visual markers while retaining its session position.

## Acceptance criteria

1. A fresh page is inactive and produces no canvas or position record.
2. Activating page A does not activate a different exact URL.
3. Appearance settings remain global while activation and position are page-specific.
4. Pointer movement on an active page updates the current visual line without unbounded storage writes.
5. A single click freezes readable text; pointer movement no longer moves the marker; another single click resumes following.
6. Interactive controls, editable regions, selected text, and non-primary clicks retain normal page behavior.
7. Turning ReadTrail off removes its visual markers without deleting the session anchor.
8. Turning it back on restores and scrolls to the same line.
9. Reloading or revisiting the exact URL within the browser session restores the position.
10. Restarting the browser clears the temporary reading record.
11. An unresolved DOM anchor falls back to stored scroll position without breaking the page.
12. An SPA URL change cannot carry activation into a new route.
13. Runtime messages and stored records are validated before use.
14. Existing tests remain green and new behavior has automated coverage.
15. Manual Chrome verification covers a long static page, two URLs, reload, off/on restoration, and an SPA route change.

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
- RT-006 manual Chrome verification is pending the one user-only step: reload the unpacked extension from `chrome://extensions`.

## Manual Chrome verification record

Automated browser control cannot access Chrome's internal extension manager. After the unpacked extension is reloaded and the test pages are refreshed, verify:

- [ ] A fresh long-form HTTP(S) page shows **Use on this page** and creates no marker before activation.
- [ ] Activating the page creates the reading marker and pointer movement follows readable text.
- [ ] A single click freezes the marker; another single click resumes following; a double-click does not toggle twice.
- [ ] Turning the page off hides the marker; turning it on restores the same session position.
- [ ] Reloading the exact URL restores and scrolls to the saved position.
- [ ] A second exact URL remains inactive until independently activated.
- [ ] After an SPA route change, the old page marker disappears on the next reading interaction.
- [ ] Chrome's extension service-worker console has no errors during the flow.
