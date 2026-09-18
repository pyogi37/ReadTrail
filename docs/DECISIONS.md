# Decisions

Append-only log. Each entry: date, decision, why, consequences. Product-level decisions also appear in `docs/PRODUCT-VISION.md`.

## 2026-09-13: Launch plan

1. **Launch target is a public Chrome Web Store listing.** Consequence: privacy policy URL, permission justifications, packaged zip, and store assets are required.
2. **1.0 ships everything except AI; 1.1 adds BYO-key AI.** Why: the first review should carry zero network or third-party data disclosure. Consequence: Phases 1 to 5 gate 1.0.
3. **Knowledge layer is a reader-facing, local-first feature.** Passages, notes, tags, search, connections, export/import. Passage text is stored only on an explicit save.
4. **AI is optional and uses the reader's own Anthropic key.** No hosted proxy, no accounts. Key stored in `storage.local`, never synced, with the plaintext risk stated in the UI.
5. **The Chrome Side Panel replaces the popup.** One entry point; `minimum_chrome_version` 114. Reading Space becomes the panel's library view, also openable in a tab.
6. **Session state is keyed per tab id, validated by URL.** Why: URL-keyed state produced cross-tab activation, orphaned reading locks, and lost updates. Consequence: `readtrail.tab.v1:<tabId>` records, `tabs.onRemoved` cleanup, sender-based trust rule.
7. **Content scripts stay statically injected on `*://*/*`.** Why: on-demand injection cannot serve side-panel activation or programmatic "Continue reading" tabs without per-origin prompts. Consequence: the store justification must document dormancy, backed by the dormancy test.
8. **Tab-close save offer uses a "recently closed" list plus badge, not `chrome.notifications`.** Why: least intrusive, no extra permission. Preference `closeSave` = ask, always, or never; default ask.
9. **Never add the `tabs` permission.** It adds a browsing-history warning; `activeTab` plus content-script host access covers every need.
10. **Claude Code leads, Codex reviews and drives browser QA, OpenCode free tier does bounded boilerplate.** `AGENTS.md` is canonical; `CLAUDE.md` imports it.
11. **License is MIT.**
12. **No new production dependencies, no bundler.** Playwright is a devDependency only for the e2e harness.

## 2026-09-13: Design tooling

13. **Side-panel polish uses the `impeccable` skill; motion stays CSS-only.** Why: impeccable runs in both Claude Code and Codex so both agents apply the same design rules; Framer Motion skills assume React, which ReadTrail does not use. Consequence: owner installs impeccable before Phase 3; every transition respects `prefers-reduced-motion`.

## 2026-09-13: Verified in Chromium (e2e harness)

14. **The worker never sees `tab.url` without the `tabs` permission.** Content-script host access does not expose tab URLs to `chrome.tabs.query` or `chrome.tabs.get`. Consequence: `getTabInfo` always falls back to the content script's `pageInfo` reply for http(s) tabs; this is the normal path, not an edge case. The `tabs` permission is still not added (decision 9).
15. **An extension page open in a tab carries `sender.tab`.** The panel's "Open in a tab" mode would have been keyed as a content script. Consequence: the trust rule checks the sender's extension origin before checking `sender.tab`, in the worker and in the library handlers (`isExtensionPageSender`).
16. **Playwright is the automated half of QA.** `npm run test:e2e` loads the unpacked extension in headless Chromium, serves fixtures over http, and drives the worker through a hidden extension page (a service worker cannot message itself). The real side panel surface stays on the manual checklist.

## 2026-09-13: Page-first library

17. **Pages are the primary library object.** Passages, notes, the saved reading position, and tags appear inside their page rather than as parallel top-level collections. Why: readers remember what they read as pages, while passages and notes are supporting material. Consequence: pages with any intentionally saved data appear in one unified Pages view.
18. **Tags belong to pages in 1.0.** Item-level tag fields remain accepted in the storage schema for export/import compatibility but are not exposed in the interface. A Tags view groups page tags and opens the matching pages. Item-level tagging can be reconsidered only with a distinct reader need.
19. **Search results are grouped by page.** Search still covers titles, URLs, passage text, note text, and page tags, but presents matching pages with their related contents together. Connections are deferred until their interaction model is designed; the initial Tags view supplies deliberate cross-page browsing without an unexplained recommendation layer.
