# ReadTrail Agent Instructions

## Product authority

- The user is the product owner and owns product vision.
- `docs/PRODUCT-VISION.md` is the product source of truth.
- The active sprint document is the delivery source of truth.
- Do not introduce features, product behavior, analytics, external services, or permanent data collection that are not in an approved sprint.
- Treat unresolved items in the product vision as questions, not permission to decide them silently.

## Agent roles

- Codex is the lead engineering partner. It owns scope alignment, architecture, task decomposition, review, integration, verification, and commits.
- OpenCode is a bounded implementation worker. It edits only the files named in its task, runs relevant checks, and reports assumptions or blockers.
- No implementation worker may commit, push, rewrite history, change the sprint scope, or edit the product vision.
- Agents must not edit the same files concurrently.

## Current architecture

- Manifest V3 Chrome extension using plain JavaScript, HTML, and CSS.
- `background/service-worker.js` owns extension state and message validation.
- `content/` owns page interaction, position detection, and rendering.
- `popup/` owns current-page controls.
- `options/` owns global appearance preferences.
- Tests use Vitest with JSDOM.

## Privacy and interaction constraints

- A page is dormant until the reader explicitly activates ReadTrail for that exact page.
- Dormant means no pointer tracking, DOM inspection for reading position, canvas, or reading-state writes.
- Temporary reading state belongs in `chrome.storage.session` and must be accessed through the service worker.
- Appearance preferences belong in `chrome.storage.local`.
- Never store passage text, page content, or browsing history unless a future approved sprint explicitly requires it.
- Dormant pages preserve all normal interaction. On an explicitly activated page, primary clicks are reserved for ReadTrail's reading lock and must not activate underlying links, buttons, or controls; scrolling and text selection remain available.
- Turning ReadTrail off hides its UI but does not delete the current session anchor.

## Engineering workflow

1. Read this file, `docs/PRODUCT-VISION.md`, and the active sprint document.
2. Inspect existing code and tests before editing.
3. State any assumption that changes behavior or data shape.
4. Keep the change within the assigned files and acceptance criteria.
5. Add or update tests with behavior changes.
6. Run `npm test` and `git diff --check` before handoff.
7. Report changed files, test results, remaining risks, and any out-of-scope findings.

## Code conventions

- Prefer small functions and explicit state transitions.
- Validate every runtime message and stored record at trust boundaries.
- Fail safely when Chrome APIs, DOM anchors, or layout information are unavailable.
- Avoid new production dependencies unless the sprint explicitly approves one.
- Preserve accessibility semantics and reduced-motion support.
- Comments should explain non-obvious constraints, not restate code.

## Git safety

- Preserve unrelated and uncommitted user changes.
- Do not use destructive Git commands.
- Only Codex creates commits or pushes, after review and verification.
