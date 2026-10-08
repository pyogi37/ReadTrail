# Store Screenshot Plan

Five screenshots at 1280 x 800 (PNG, no transparency). Captured on a fresh profile with the unpacked extension loaded, against a real public Wikipedia article ("Close reading"), at 100% zoom, no other extensions installed. Originals in `docs/store/screenshots/` (not shipped; excluded by the package allow-list).

| # | File | Shows | Caption overlay (optional, top-left, short) |
|---|---|---|---|
| 1 | `01-reading-guide.png` | The ruler following a line mid-article | "Follow the line you are reading" |
| 2 | `02-paused-and-saved.png` | The same line paused (warm-gold marker) after Save for later | "Pause exactly where you stopped" |
| 3 | `03-desk-return.png` | The Desk: Sources and a Draft side by side, a quote with its citation, Return just pressed and showing "Found exactly, in the tab you already had open." | "Write beside your sources, and go straight back to them" |
| 4 | `04-sources.png` | The Desk's Sources pane, a page card expanded to show its real saved passages with Quote and Remove | "Every passage keeps its source" |
| 5 | `05-options.png` | Options page: trail style, color, size, and the "Closing tabs" preference | "Your marker, your rules, your device" |

Rules

- No personal data in any screenshot: fresh profile, no bookmarks bar, no other extensions, a public article as the source.
- The native, Chrome-docked side panel cannot be captured by automation (confirmed limitation, see the launch plan's risk log: "Playwright cannot drive the real side panel"). These five screenshots use the Desk (a full tab) and the options page instead, which show the real UI without that limitation. If a sixth screenshot showing the panel docked in real Chrome is wanted, it has to be taken by hand.
- Regenerate with `node scripts/... ` — no script is checked in for this; the capture was done ad hoc against `tests/e2e/helpers.mjs`. Re-run by hand against a current build before every submission, since the UI will keep changing.
