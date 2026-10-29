# Changelog

All notable changes to ReadTrail are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Copy as Markdown** and **Download .md** on the open draft. The title becomes the heading, your text passes through as you wrote it, each quote becomes a blockquote naming its source, and a Sources list at the end gives every page once with its title and address. Two quotes of one page share a number.
- **Copy with source** in a quote's options, for dropping one quotation into whatever you are writing elsewhere.
- Nothing new is read or stored to produce either. If the clipboard is unavailable, ReadTrail says so and points to the download.
- **The Desk reads as one document.** Enter at the end of your text starts the next block. Backspace in an empty block removes it and takes you to the end of the text above. Up at the start and Down at the end move into the neighbouring block, stepping over quotes, which hold no caret. Alt with an arrow and the options row still move blocks from the keyboard.
- **Drag a block by its handle** to where it belongs, with a mouse, pen or finger. A line shows where it will land, and Escape puts it back.
- **The right-click save says whether it saved.** "Save selection to ReadTrail" now flashes the text it kept. When it cannot save, the toolbar icon shows "!" for that tab, and its tooltip says why.

### Changed

- The ruler, the underline and the line highlight now cover only the text you are reading, not the whole width of the window or of the box around the text. The highlight no longer changes the page's own elements.

### Fixed

- **Undoing a removed quote no longer stops the draft saving.** Pressing Undo remove after the removal had autosaved used to make every later save of that draft fail, so writing after it was lost on reload.
- The privacy policy described a **Clear all** button that no reader can reach. It now names the two controls the side panel and the Desk actually show, **Clear saved places** and **Clear page content**, and says exactly what each removes and keeps, including that neither removes drafts or the passage text quoted in them.

### Planned

- Optional AI actions (summaries, tag and connection suggestions) using the reader's own Anthropic API key. Off unless a key is added.

## [2.0.0] - Unreleased

The first public release. Version 1.0.0 was completed but never submitted to the Chrome Web Store, so 2.0.0 contains everything listed under 1.0.0 below as well as the Desk.

### Added

- **Drafts.** Write in blocks beside your sources. A draft holds your own text and quotes of passages you saved, and each quote keeps the title, site, and exact position of the passage it came from.
- **The Desk**, a full tab opened from the side panel: your sources on the left, the draft you are writing on the right.
- **Return.** Go from any quote back to the exact paragraph in its page. ReadTrail focuses the tab you already have open when it can, and always says what it found: the passage exactly, the passage by its wording because the page changed, or nothing at all.
- Drafts are included in export and import. A file exported before drafts existed still imports.

### Changed

- The side panel leads with a button that opens the Desk, replacing the small link in its footer.
- The privacy documents now state one rule about reading a page: nothing is read automatically, and two actions read it when you ask them to, at that moment only. Those are **Save selection** and **Return**. This corrects wording that was already inaccurate, because Save selection never required turning ReadTrail on.

## [1.0.0] - Unreleased

First Chrome Web Store release.

### Added

- Reading guide (ruler, underline, or dots) that follows the current line on pages you turn it on for.
- Reading lock: a single click pauses at a line; another click resumes.
- Explicit **Save for later** with one durable resume point per exact page URL.
- Side panel with current-page controls, saved pages, and a "Recently closed" list for tabs that closed with unsaved progress (ask, always save, or never).
- Per-tab reading state: two tabs on the same page never share activation, position, or reading lock.
- Resilient restoration: landmark-based anchors with structural checks and a proportional fallback when a page changed.
- Knowledge layer: saved passages, notes, tags, local search, and JSON export/import.
- Options for appearance, closing-tab behavior, and excluded sites.

### Privacy

- Nothing is captured before you turn ReadTrail on for a page.
- All data stays on this device. No accounts, analytics, or network requests.
- Incognito tabs never leave a trace.
