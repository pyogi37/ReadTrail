# Sprint 007: Release Hardening and Store Submission (Phase 5, ships 1.0.0)

## Status

Active.

## Goal

A reproducible production package, a public privacy policy, complete store materials, and a logged manual QA run. Publishing needs the owner's click.

## Scope

- `scripts/package.mjs` (Node 22+, no dependencies): allow-list `manifest.json`, `icons/`, `background/`, `content/`, `shared/`, `sidepanel/`, `options/`; writes `dist/readtrail-<version>.zip`. `--check` fails on version mismatch, missing manifest-referenced files, unparsable JS, or files outside the allow-list.
- `tests/package.test.js`: builds into a temp dir and asserts no `tests/`, `docs/`, `.opencode/`, `node_modules/` entries.
- `package.json` scripts: `package`, `package:check`, `test:e2e`; `@playwright/test` devDependency.
- `tests/e2e/`: Playwright persistent context with `--load-extension`, fixtures served from `tests/e2e/fixtures/` over `node:http`, assertions through the service worker. Scenarios: reload restores, two tabs same URL isolated, continue opens and restores, close tab creates a recent item, export/import round trip.
- `PRIVACY.md`, `docs/privacy-policy.md`, `docs/index.md`, `docs/_config.yml` for GitHub Pages.
- `LICENSE` (MIT), `CHANGELOG.md`.
- `docs/store/LISTING.md`, `docs/store/PERMISSIONS.md`, `docs/store/SCREENSHOTS.md`.
- `docs/RELEASE-CHECKLIST.md`, `docs/qa/MANUAL-QA.md`, `docs/qa/runs/`.
- Side panel first-use explanation; `settings.excludedHosts` with an "Exclude this site" control, checked by the content script right after `getSettings`.
- README refresh: side-panel screenshots, license badge, store link placeholder.

## Acceptance criteria

1. `npm run package` produces a zip containing only allow-listed files; the zip loads via `chrome://extensions` with no worker errors on install, update, and restart.
2. `npm run package:check` passes and is part of the release checklist.
3. The privacy policy URL resolves publicly.
4. Listing copy, permission justifications, and screenshot plan are drafted and approved by the owner.
5. Excluded hosts stay inert; the content script exits after one `getSettings`.
6. A manual QA run for 1.0.0 is logged in `docs/qa/runs/` with every case passed or an approved exception.
7. `v1.0.0` is tagged after submission.
