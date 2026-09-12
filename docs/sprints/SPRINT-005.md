# Sprint 005: Side Panel and Recently Closed (Phase 3)

## Status

Planned. Starts after Sprint 004.

## Goal

The Chrome Side Panel becomes ReadTrail's only UI: current-tab controls, the library, and a quiet offer to save reading that was open in a tab that closed.

## Scope

- `sidepanel/sidepanel.html`, `sidepanel.css`, `sidepanel.js` (shell, tab tracking), `page-view.js` (uses `shared/page-controls.js`), `library-view.js` (port of Reading Space), `recent-view.js`.
- Manifest: remove `action.default_popup`; add `side_panel.default_path`; permissions `storage`, `activeTab`, `sidePanel`; `minimum_chrome_version` 114; `action.default_title`.
- Worker: `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true})` at top level and on install; `onRemoved` recently-closed logic; `listRecentlyClosed`, `saveRecentlyClosed`, `dismissRecentlyClosed`; `chrome.action.setBadgeText`.
- `readtrail.recent.v1` in `storage.session`: max 10 items, 30-minute expiry.
- `settings.closeSave`: `ask` (default), `always`, `never`. Options page control.
- `?mode=page` renders the same panel HTML in a full tab (replaces `reading-space/`).
- Delete `popup/` and `reading-space/` once their tests are ported to `tests/sidepanel.test.js`.

## Tab tracking

`tabs.query` on load, then `tabs.onActivated`, `tabs.onUpdated` (url or status complete for the tracked id), `windows.onFocusChanged`. Each event calls `getTabInfo` then `getPageState`. Live state via `storage.onChanged` filtered to the current tab key. Unsupported tabs render "Not available on this page".

## Acceptance criteria

1. Toolbar click opens the panel; no popup exists.
2. The panel reflects the active tab within one tab event and re-renders on session changes for that tab only.
3. Toggling in the panel activates only the current tab.
4. Continue reading from the panel opens and restores.
5. Closing an active tab with unsaved progress: `ask` adds a recent item and sets the badge; `always` writes the durable record unless incognito; `never` writes nothing.
6. Save from the recent list validates against the stored item, writes the durable record, removes the item, and clears the badge when empty.
7. Items expire after 30 minutes; the list never exceeds 10.
8. Incognito tabs never appear in the list.
9. Keyboard navigation, visible focus, semantic headings, and reduced motion hold.

## Files

`sidepanel/*`, `manifest.json`, `background/service-worker.js`, `options/*`, `tests/sidepanel.test.js`, `tests/background.test.js`, `tests/manifest.test.js`, `README.md`.
