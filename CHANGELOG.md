# Changelog

All notable changes to ReadTrail are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned for 1.1.0

- Optional AI actions (summaries, tag and connection suggestions) using the reader's own Anthropic API key. Off unless a key is added.

## [1.0.0] - Unreleased

First Chrome Web Store release.

### Added

- Reading guide (ruler, underline, or dots) that follows the current line on pages you turn it on for.
- Reading lock: a single click pauses at a line; another click resumes.
- Explicit **Save for later** with one durable resume point per exact page URL.
- Side panel with current-page controls, saved pages, and a "Recently closed" list for tabs that closed with unsaved progress (ask, always save, or never).
- Per-tab reading state: two tabs on the same page never share activation, position, or reading lock.
- Resilient restoration: landmark-based anchors with structural checks and a proportional fallback when a page changed.
- Knowledge layer: saved passages, notes, tags, local search, connections, and JSON export/import.
- Options for appearance and closing-tab behavior.

### Privacy

- Nothing is captured before you turn ReadTrail on for a page.
- All data stays on this device. No accounts, analytics, or network requests.
- Incognito tabs never leave a trace.
