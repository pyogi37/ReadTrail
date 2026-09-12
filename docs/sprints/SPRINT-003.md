# Sprint 003: Shared Modules and Per-Tab Session State (Phase 1)

## Status

Implemented; awaiting review.

## Goal

Two tabs never share reading state. Turning ReadTrail off in one tab cannot leave another tab click-locked. The service worker becomes the only writer of settings.

## User outcome

> I can have the same article open twice, use ReadTrail in one tab, and the other tab behaves exactly as if ReadTrail were never touched.

## Scope

- `shared/constants.js`: `globalThis.ReadTrailShared = { DEFAULTS, ERRORS, LIMITS, KEYS }` as a classic-script IIFE.
- `shared/validators.js`: move `isRecord`, `isFiniteNumber`, `isValidPageUrl`, `isValidAnchor`, `isValidPosition`, `clonePosition`, `isValidSavedPosition`, `isValidSavedRecord`, `cloneSavedRecord` out of the worker; add `isValidTabRecord`, `isValidSettings`.
- Worker loads both via `importScripts`. Content scripts load `shared/constants.js` first via the manifest. Popup and options load them with `<script>` tags.
- Session state moves from one `readingPages` map to one key per tab: `readtrail.tab.v1:<tabId>` with `{version:1, url, title, active, mode, position, incognito, origin, updatedAt}`.
- Trust rule: content-script senders are identified by `sender.tab.id`; extension-page senders pass `tabId` and are accepted only when `sender.url` starts with `chrome.runtime.getURL("")`.
- `chrome.tabs.onRemoved` and `onReplaced` delete the tab's record.
- Continue reading: create the tab first, then seed `readtrail.tab.v1:<newTabId>`. Seed failure after creation returns `session-storage-error` with the tab id; the tab stays open and dormant.
- New messages: `setSettings`, `getTabInfo`; content handler `pageInfo`.
- `savePagePosition` carries `title`.
- Stale `readingPages` key removed on install/update.

## Non-goals

- Side panel, anchor v2, knowledge layer, packaging.
- Any change to single-tab behavior visible to the reader.

## Acceptance criteria

1. Activating URL X in tab A leaves tab B on X dormant after reload; B's `getPageState` returns the inactive default.
2. Turning off in A never changes B's record.
3. Two active tabs on X write different keys; `savePagePosition` from a tab with no record returns `page-inactive`.
4. Any operation leaves unrelated tab records byte-identical.
5. `tabs.onRemoved` deletes the record; a late `savePagePosition` afterwards is rejected and writes nothing.
6. Continue reading: the new tab's record exists after `tabs.create` returns and before the reply; a pre-existing tab on the same URL gains no record.
7. Seed failure after tab creation replies `{ok:false, error:"session-storage-error", tabId}`.
8. A content-script sender with a spoofed `msg.tabId` is keyed by `sender.tab.id`; an extension-page sender without `tabId` gets `invalid-input`; any other sender gets `invalid-sender`.
9. `setSettings` rejects malformed input and leaves stored settings unchanged; options no longer writes storage directly.
10. `getTabInfo` returns `{ok, url, title, incognito, supported}`, falling back to the content script's `pageInfo` when `tab.url` is unavailable.
11. All existing tests pass (rewritten expectations only where the sprint changes behavior); new suites cover every criterion above.

## Work breakdown

| Task | Files | Notes |
|---|---|---|
| RT-301 shared modules | `shared/constants.js`, `shared/validators.js`, `background/service-worker.js`, `manifest.json`, `tests/shared.test.js`, `tests/manifest.test.js` | Pure extraction; tests stay green |
| RT-302 chrome mock helper | `tests/helpers/chrome-mock.js`, `tests/background.test.js` | Move `createBackedStore`; add emitters and sender factories |
| RT-303 per-tab state in worker | `background/service-worker.js`, `tests/background.test.js` | Keys, trust rule, listeners, continue reorder |
| RT-304 surfaces | `content/content.js`, `popup/popup.js`, `options/options.js`, `options/options.html`, `popup/popup.html`, tests | `tabId` in messages, `setSettings`, `pageInfo`, title in checkpoints |
| RT-305 docs | `docs/ARCHITECTURE.md`, `docs/STATUS.md`, `README.md` | Reflect the new protocol |

## Risks

- `importScripts` requires a classic worker; a manifest test pins `background.type` absent.
- `chrome.tabs.get(id).url` may be undefined for tabs the extension has not been invoked on; `getTabInfo` falls back to the content script.
- Continue-reading seed race is milliseconds against a page load; if manual QA ever sees a dormant continue, add a `tabs.onUpdated status:"complete"` push.
