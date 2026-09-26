# ReadTrail Agent Instructions

Canonical instructions for every AI collaborator (Claude Code, Codex, OpenCode). `CLAUDE.md` imports this file. Keep this file short; link to docs instead of inlining them.

## Start of every session

1. Read `docs/STATUS.md` (current phase, last commit, next task). It is the handoff file between agents.
2. Read the active sprint doc it names under `docs/sprints/`.
3. Read `docs/ARCHITECTURE.md` only if the task touches messages, storage, or a new surface.
4. Do not re-read the whole repo. Name files and line ranges; use search tools for discovery.

## Product authority

- The user (`pyogi37`) is the product owner. `docs/PRODUCT-VISION.md` is the product source of truth; `docs/DECISIONS.md` records decisions already made.
- Do not add features, permissions, external services, or data collection that are not in the active sprint.
- Unresolved items in the vision are questions for the owner, not permission to decide silently.

## Roles

| Role | Who | Owns |
|---|---|---|
| Lead | Claude Code | Sprint scope, architecture, implementation, tests, integration, commits, `docs/STATUS.md` |
| Reviewer + QA | Codex | Independent review of each phase diff against sprint acceptance criteria; browser-driven manual QA logged in `docs/qa/runs/` |
| Worker | OpenCode (`.opencode/agents/readtrail-worker.md`) | One bounded task in named files; no commits, no scope changes |

Only the lead commits. Nobody pushes without the owner. No agent rewrites history or edits the product vision. Agents never edit the same files concurrently.

Model routing and token rules: `docs/AI-WORKFLOW.md`.

## Architecture in ten lines

- Manifest V3, plain JavaScript/HTML/CSS, no bundler, no runtime dependencies.
- `background/service-worker.js` is the single trust boundary: every runtime message and stored record is validated there.
- `shared/` holds constants and validators loaded by every surface (classic scripts, `importScripts` in the worker).
- `content/` owns page interaction, anchoring, and the canvas overlay. It is dormant until the reader activates that exact page in that tab.
- `sidepanel/` (replaces `popup/` and `reading-space/` from Phase 3) owns current-tab controls and the library.
- `options/` owns global appearance and behavior preferences, written only through the worker.
- Temporary reading state: `chrome.storage.session`, keyed per tab. Durable data: `chrome.storage.local`, one key per record. Never `storage.sync`.
- Protocol and schema tables: `docs/ARCHITECTURE.md`.

## Privacy and interaction rules

- Nothing is captured automatically: no pointer tracking, no canvas, no reading-state writes on a dormant page. Exactly two reader-initiated actions read a dormant page, at the moment they are invoked: `capturePassage` (Save selection) and `revealPassage` (Return). Return stores nothing it reads. Do not add a third without the owner's decision.
- Passage text is stored only when the reader explicitly saves a passage. Never store page content, selections, or history otherwise.
- Incognito tabs never produce durable records.
- On an active page, primary clicks belong to the reading lock; scrolling and text selection stay available. Turning ReadTrail off hides UI but keeps the session anchor.
- No network requests exist in 1.0. In 1.1 the only request is to Anthropic with the reader's own key, triggered by the reader.

## Workflow

1. Inspect existing code and tests before editing. Reuse `shared/validators.js` and existing patterns.
2. State any assumption that changes behavior or a data shape.
3. Stay inside the sprint's files and acceptance criteria.
4. Add or update tests with every behavior change.
5. Run the touched test file, then `npm test`, then `git diff --check`.
6. Update `docs/STATUS.md` before ending the session: what is done, what is next, what is blocked.
7. Commit only a coherent green increment. Message: imperative summary, body lists behavior changes.

## Code conventions

- Small functions, explicit state transitions, validate at every trust boundary, fail safely when Chrome APIs or DOM anchors are missing.
- Comments explain constraints, not code.
- Preserve accessibility (labels, focus styles, `role`s) and `prefers-reduced-motion`.
- Tests: Vitest + JSDOM; sources are evaluated into the window; Chrome APIs come from `tests/helpers/chrome-mock.js`.

## Commands

```sh
npm install
npm test                # unit + behavioral (Vitest, JSDOM)
npm run test:e2e        # Playwright against the unpacked extension (npx playwright install chromium once)
npm run package:check   # release package validation
git diff --check
```

Chrome behavior must also be checked by loading the unpacked extension (`chrome://extensions` → Reload → refresh test pages). The manual checklist lives in `docs/qa/MANUAL-QA.md`.
