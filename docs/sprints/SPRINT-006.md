# Sprint 006: Knowledge Layer (Phase 4)

## Status

Implemented; awaiting review.

## Goal

Readers can keep passages, notes, and page tags, find them through a page-first library, and take their data with them. Everything is local.

## Scope

- `content/passage.js`: runs only on a `capturePassage` message; reads `window.getSelection()`, serializes start and end with `ReadTrailPosition`; returns `{ok, text, start, end}`.
- Saved passages on an active page are drawn with the CSS Custom Highlight API (`CSS.highlights`, Chrome 105+); no DOM mutation.
- Context menu "Save selection to ReadTrail" (`contextMenus` permission, no install warning).
- Worker handlers: `savePassage`, `updatePassage`, `removePassage`, `listPassages`, `saveNote`, `updateNote`, `removeNote`, `listNotes`, `setPageTags`, `listLibrary`, `clearLibrary`, `exportLibrary`, `importLibrary`.
- Records (see `docs/ARCHITECTURE.md`): `readtrail.passage.v1:<uuid>`, `readtrail.note.v1:<uuid>`, `readtrail.pagemeta.v1:<url>`, `readtrail.library.v1` counters. `saved.v1` unchanged.
- Bounds: text and note 4,000 characters; 20 tags of 40 characters; 1,500 passages plus notes total, refused with `library-full`. Footer shows `getBytesInUse()`.
- `sidepanel/search-index.js`: in-memory inverted index; tokens from `/[\p{L}\p{N}]+/gu`; weights title and page tags 3, note 2, text 1; prefix match on a sorted token array; results are grouped by page; rebuilt on `storage.onChanged` debounced 150 ms.
- The side panel has Pages and Tags views. Every page with a saved position, passage, note, or page tag appears once; its details contain those child records. Item-level tags and automatic connections are not surfaced in 1.0.
- `sidepanel/export-import.js`: export `{format:"readtrail-export", version:1, exportedAt, saved, passages, notes, pagemeta}` via Blob download; import `merge` or `replace`, every record validated, returns `{imported, skipped, rejected}`.
- Removing a saved page asks whether to remove its passages and notes too. `clearLibrary{kinds}` removes only chosen prefixes and never touches `settings`.

## Acceptance criteria

1. Passage text is stored only through an explicit save action; dormant pages still perform no DOM inspection.
2. Bounds are enforced with a visible "library is full" state.
3. Search returns ranked results in under 50 ms for 1,500 synthetic items (asserted in a test).
4. Export then import round-trips losslessly in `replace` mode; `merge` skips duplicates by id or URL.
5. Clear-all leaves `settings` untouched.
6. Highlights render on active pages without mutating page DOM.
7. Context menu and panel both save the current selection.
8. Passages and notes are nested under their page; tags browse pages; search results never split one page into disconnected rows.

## Files

`content/passage.js`, `content/content.js`, `content/content.css`, `sidepanel/library-view.js`, `sidepanel/search-index.js`, `sidepanel/connections.js`, `sidepanel/export-import.js`, `background/service-worker.js`, `shared/validators.js`, `shared/constants.js`, `manifest.json`, `tests/search-index.test.js`, `tests/connections.test.js`, `tests/passage.test.js`, `tests/background.test.js`, `tests/sidepanel.test.js`.
