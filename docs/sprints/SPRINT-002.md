# Sprint 002: Shippable Continue-Reading MVP

## Status

Active. Product scope is locked; implementation starts after the Sprint 001 reading-lock build is reloaded and its revised Chrome flow is verified.

## Goal

Turn ReadTrail's session-only reading foundation into a small, coherent MVP that a reader can deliberately save, close, reopen, and continue from after restarting Chrome.

## Release promise

> ReadTrail helps me focus on long browser reading, explicitly save exactly where I stopped, and reliably continue later—even after closing Chrome.

## Product decisions locked for this sprint

- Permanent saving is always an explicit **Save for later** action in the popup.
- Each exact page URL has at most one persistent resume point.
- Saving again replaces that page's previous persistent resume point.
- Unsaved progress remains temporary and does not silently move the persistent checkpoint.
- Saved checkpoints survive closing and reopening Chrome.
- A minimal Reading Space lists saved pages and supports **Continue reading** and **Remove**.
- **Continue reading** opens the saved URL, activates reading lock, restores the saved position, and initially shows the saved visual state.
- Following, paused, and saved states are visually distinct.
- Exact-word, phrase, and passage anchoring remains future-compatible direction, not an MVP requirement.

## Core user flow

```text
Activate reading lock
→ follow the reading guide
→ single-click to pause at a line
→ open the popup
→ Save for later
→ close Chrome
→ reopen Reading Space
→ Continue reading
→ page opens active at the saved position
```

After the reader resumes and moves forward, the durable saved point remains unchanged until **Save for later** is chosen again.

## Experience states

### Following

- A light, translucent guide tracks the current readable line.
- Movement should feel responsive but quiet and respect reduced-motion preferences.

### Paused

- A stronger fixed treatment makes the temporary checkpoint unmistakable.
- The marker aligns with the visual center of the intended text line.
- The popup offers **Save for later** when a valid checkpoint exists.

### Saved

- A warm-gold treatment distinguishes a deliberate saved checkpoint from a temporary pause.
- Opening through Reading Space restores the page with this saved treatment visible.
- Resuming following changes the active guide back to the following treatment; the durable saved record remains unchanged in storage and is not rendered as a second simultaneous marker.
- The popup indicates when current temporary progress is newer than the durable saved point and offers **Update saved position**.

The visual direction is calm and editorial rather than dashboard-like. It should use restrained motion, strong state contrast, accessible focus styles, and local assets only.

## Persistent data boundary

Temporary page state remains in `chrome.storage.session` and continues to use validated service-worker messages.

Persistent saved pages live in `chrome.storage.local`, also behind validated service-worker messages. Use one prefixed storage item per exact URL so concurrent saves or removals cannot overwrite unrelated records:

```text
"readtrail.saved.v1:<exactUrl>" = {
  version: 1,
  title: string,
  position: {
    anchor: object,
    viewportOffset: number,
    scrollY: number,
    scrollRatio: number,
    savedAt: number
  },
  savedAt: number
}
```

The exact URL is encoded in the storage key and is not duplicated inside the record. The domain is derived for display and is not stored separately. The explicit-save timestamp is distinct from the position-capture timestamp.

The record must not contain passage text, page content, selections, analytics identifiers, or an automatically collected browsing history. The title and URL become durable only because the reader explicitly saved that page.

## Scope

### Persistent checkpoint service

- Validate every persistent record and runtime message at the service-worker boundary.
- Save or update one checkpoint per exact HTTP(S) URL.
- List saved pages in a stable most-recently-updated order.
- Remove one saved page and support an explicit clear-all action with confirmation.
- Keep persistent storage writes separate from session checkpoint writes.
- Snapshot the active content script's in-memory position when saving; never infer the saved position from the URL-keyed shared session record because two tabs can have the same exact URL.
- Require a tab-bound save message whose sender URL matches the saved exact URL; reject incognito, unsupported, oversized, or malformed input.
- Migrate or fail safely if malformed local data is encountered.

### Popup save states

- No checkpoint: save action unavailable with a useful explanation.
- Temporary checkpoint, never saved: **Save for later**.
- Current checkpoint equals durable checkpoint: clearly show **Saved**.
- Temporary checkpoint is newer/different: **Update saved position**.
- Saving failures preserve the previous durable record and show an actionable error.
- Provide an obvious entry point to Reading Space.

### Minimal Reading Space

- Extension-owned page with a calm empty state and a simple saved-page list.
- Each item shows title, domain, last-saved time, **Continue reading**, and **Remove**.
- **Continue reading** prepares an active frozen session from the durable record before opening the page in a new tab.
- Ordinary navigation to a previously saved URL remains dormant after a browser restart; only **Continue reading** performs automatic activation.
- Broken or unsupported URLs fail visibly without deleting the saved item.
- Removal is explicit; clear-all requires confirmation.
- Keyboard navigation, visible focus, semantic headings, and reduced motion are required.

### Reading-state visuals

- Use shared visual tokens for following, paused, and saved states.
- Saved state must remain distinguishable without relying on color alone.
- Avoid injecting interactive handles or controls into page content.
- Preserve readable text selection and the Sprint 001 reading-lock rules.

### Release readiness

- Review manifest permissions and justify every permission in user-facing language.
- Add a concise first-use explanation covering reading lock, temporary progress, and explicit persistent saving.
- Provide clear local-data deletion controls.
- Verify extension CSP, failure states, reduced motion, keyboard access, and common long-form pages.
- Prepare a production extension package and a Chrome Web Store release checklist.
- Draft store description, privacy disclosure, screenshot plan, and version notes; publishing itself requires the product owner's approval.

## Non-goals

- Multiple saved positions or bookmarks on one page.
- Exact-word, phrase, sentence, or passage persistence.
- Notes, reactions, questions, tags, folders, search, or completion tracking.
- Knowledge graphs, recommendations, summaries, or other AI features.
- Accounts, cloud sync, cross-device sync, or external transmission.
- Automatic permanent history or automatic durable checkpoint updates.
- Importing passages or read-it-later collections.
- Comprehensive adaptation to every site-specific layout or custom pointer interaction.

## Acceptance criteria

1. An unsaved page never creates a durable `readtrail.saved.v1:` record.
2. **Save for later** is unavailable until a valid temporary checkpoint exists.
3. Explicit saving creates one validated durable record for the exact page URL.
4. Saving the same URL again updates that record without creating a duplicate.
5. The durable record survives a full Chrome restart.
6. Reading further does not change the durable record until the reader explicitly updates it.
7. The popup accurately distinguishes unsaved, saved, and newer-temporary-progress states.
8. Reading Space lists only explicitly saved pages with title, derived domain, saved time, continue, and remove actions.
9. **Continue reading** opens the exact URL in a new tab, activates reading lock, restores the saved position, and renders the saved state without modifying the durable record.
10. Removing a saved page deletes its durable record without deleting unrelated session state.
11. Clear-all requires confirmation and removes only ReadTrail's durable saved-page records.
12. Malformed messages, records, URLs, titles, and positions are rejected or ignored safely.
13. Following, paused, and saved states are visually and non-color distinguishable.
14. Dormant pages retain normal behavior and create no reading or persistent state.
15. Popup and Reading Space are keyboard accessible, expose useful errors, and respect reduced motion.
16. No passage text, page content, automatic history, analytics, account data, or network transmission is introduced.
17. Automated tests cover persistence, popup states, continue flow, deletion, validation, and visual-state transitions.
18. Manual Chrome verification covers save, restart, continue, update, remove, clear-all, two exact URLs, and representative long-form pages.
19. The production package passes the release checklist with no unexplained permission or service-worker errors.
20. With two tabs on the same exact URL, saving snapshots the initiating tab's in-memory position rather than the other tab's shared session checkpoint.
21. Incognito saving is rejected and writes no durable record.
22. Direct navigation to a saved URL after restart remains dormant unless launched through **Continue reading**.

## Proposed work breakdown

### RT-201 — Sprint contract and storage design

- Owner: Codex
- Files: product/sprint documentation and persistent record contract
- Result: privacy boundary, message schema, and acceptance tests agreed before implementation

### RT-202 — Persistent saved-page service

- Owner: Codex
- Files: `background/service-worker.js`, `tests/background.test.js`
- Result: validated save, list, remove, clear, and continue preparation backed by `chrome.storage.local`

### RT-203 — Popup save lifecycle

- Owner: OpenCode, reviewed by Codex
- Files: `popup/`, `tests/popup.test.js`
- Result: save/update/saved states, Reading Space entry point, and failure handling

### RT-204 — Three-state reading visuals

- Owner: OpenCode, reviewed by Codex
- Files: `content/`, content and renderer tests
- Result: visually distinct following, paused, and saved treatments with line-centered restoration

### RT-205 — Minimal Reading Space

- Owner: OpenCode, reviewed by Codex
- Files: new `reading-space/` surface and focused tests
- Result: accessible list, empty state, continue, remove, and clear-all flows

### RT-206 — Integration, release hardening, and package

- Owner: Codex
- Files: manifest, documentation, tests, release assets/checklist as required
- Result: verified Chrome flow, privacy review, production package, and store-submission materials ready for product-owner approval

Agents must not edit overlapping files concurrently. Codex reviews and integrates every implementation task before committing or pushing.

## Risks and deliberate constraints

- Chrome service-worker suspension requires message flows that do not rely on in-memory state.
- Opening a saved page and restoring only after its content script is ready can race; prepare session state before opening the new tab and roll it back if tab creation fails.
- Exact URLs can contain sensitive queries or fragments; the Save UI must state that the exact URL and title are retained locally.
- Persistent records require explicit bounds, including the existing URL limit, a bounded title, bounded anchor depth, and finite timestamps and coordinates.
- Continue redirects to a different exact URL must fail dormant rather than carrying activation across the redirect.
- DOM changes can invalidate anchors; retain the existing scroll fallback and communicate imperfect restoration honestly.
- Page titles and URLs are sensitive durable data even when explicitly saved; deletion must be obvious and reliable.
- A full Chrome restart must be tested manually because JSDOM cannot prove storage lifetime.
- Visual distinction cannot depend on color alone and must remain legible over unpredictable site backgrounds.
- Time pressure favors one excellent resume loop over multiple partially finished organization features.

## Definition of done

- All acceptance criteria pass or any exception is explicitly approved and documented.
- `npm test` and `git diff --check` pass.
- Manual Chrome restart and representative-page verification are recorded.
- No high-severity review finding remains open.
- The repository is clean, committed, pushed, and contains a reproducible production package plus release checklist.
