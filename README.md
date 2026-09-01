# ReadTrail

**A privacy-first Chrome extension that helps people resume long-form reading without losing their place.**

ReadTrail adds a configurable visual reading guide to text-heavy pages and remembers page-level reading state locally. The project explores a simple product question: how can a browser help people continue reading without turning their attention into another data stream?

> **Status:** Active early-stage build. The core extension, reading guide, local preferences, page lifecycle, and automated tests exist today. The broader reading workspace is still being developed.

## What works today

- Canvas-based reading trail for following the current line
- Configurable line highlighting and visual preferences
- Popup controls and a dedicated settings page
- Local settings persistence
- Page-specific reading lifecycle
- Manifest V3 Chrome extension architecture
- Automated behavioral tests with Vitest

## Product principles

- **Private by default:** reading data should stay on the device unless the user explicitly chooses otherwise.
- **Intentional activation:** the extension should not collect reading state before it is enabled for a page.
- **Useful, not distracting:** controls should disappear behind the reading experience.
- **Honest product boundaries:** planned capabilities are documented separately from features already implemented.

See [Product Vision](docs/PRODUCT-VISION.md) for the product direction, decisions, and open questions.

## How it is structured

```text
popup/       Quick controls
options/     Extension settings
content/     On-page reading experience
background/  Extension lifecycle and page state
tests/       Behavioral tests
docs/        Product vision and engineering notes
```

The extension uses standard HTML, CSS, and JavaScript with Chrome Manifest V3 APIs. A canvas overlay renders the reading trail, while extension storage and background logic coordinate preferences and page state.

## Run it locally

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the project directory.
5. Open a text-heavy page and activate ReadTrail from the extension popup.

Run the automated checks:

```sh
npm install
npm test
```

## Roadmap

- Reliable restoration to the exact reading position
- Intentional bookmarks and unfinished-reading navigation
- Clear save behavior when closing or leaving a page
- A private reading space for revisiting saved material
- Reflection and knowledge connections built on top of reliable reading memory

Roadmap items are planned work, not completed claims.

## Why I built this

ReadTrail is a product-engineering project focused on browser APIs, local-first state, interaction design, privacy constraints, and turning an ambiguous user problem into an incremental product roadmap. It is being built in public as part of my work across customer-facing AI and full-stack product engineering.

## Development notes

More detail on the development workflow is available in [DEVELOPMENT.md](DEVELOPMENT.md).
