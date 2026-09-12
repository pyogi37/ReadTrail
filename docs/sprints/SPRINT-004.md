# Sprint 004: Restoration Resilience and Update Saved Position (Phase 2)

## Status

Implemented; awaiting review.

## Goal

Restore honestly when a page has changed, and let the reader update a saved place when their temporary progress is newer.

## Scope

- Anchor v2: `{version:2, path, offset, landmark:{id, path}|null, check:{tag, textLength}}`. No page text.
- Resolve order: landmark path, then body path; each candidate must pass `check`; otherwise scroll fallback.
- Scroll fallback uses `scrollRatio * maxScrollY()` when the document height differs by more than 15% from the implied height at save time, else `scrollY`.
- `resolvePosition` returns `restoreQuality: "exact" | "approximate" | "fallback"`; stored in the tab record; surfaced in the UI as "Restored approximately, this page has changed."
- Validators accept v1 and v2; `clonePosition` and `cloneSavedRecord` copy every v2 field.
- `shared/page-controls.js`: pure `saveButtonState(tabState, savedRecord)` returning one of `none`, `save`, `saved`, `update`. Popup uses it now; side panel reuses it in Phase 3.
- Update saved position writes through the existing `saveForLater` path (content snapshot).

## Acceptance criteria

1. v1 anchors still restore.
2. A v2 anchor resolves after nodes are prepended to `body` when a landmark exists.
3. A mismatched `check` rejects the candidate and falls back.
4. Ratio fallback is used when the document height changed by more than 15%; otherwise `scrollY`.
5. `restoreQuality` is reported and stored.
6. Button state table: no position gives `none` ("Pause at a line first"); position and no record gives `save`; record newer or equal gives `saved`; position newer gives `update`.
7. Update writes a durable record from the content snapshot without touching other records.

## Files

`content/position.js`, `content/content.js`, `shared/validators.js`, `shared/page-controls.js`, `popup/popup.js`, `popup/popup.html`, `tests/position.test.js`, `tests/content.test.js`, `tests/popup.test.js`, `tests/shared.test.js`.
