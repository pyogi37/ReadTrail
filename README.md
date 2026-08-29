# ReadTrail

ReadTrail is a privacy-first browser extension for people who read long, text-heavy pages and want help following the current line, remembering exactly where they stopped, and returning later without losing context.

The project is currently in an early product and engineering stage. Its first foundation is reliable reading-position memory; bookmarks, unfinished-reading navigation, reflection, and knowledge connections build outward from that base.

Read the [product vision](docs/PRODUCT-VISION.md) for the current principles, decisions, and open questions.

## Current Extension

ReadTrail is a Manifest V3 Chrome extension with:

- A canvas-based reading trail
- Line highlighting and visual customization
- A popup for quick controls
- A full settings page
- Local settings persistence
- Automated behavioral tests

The current implementation is a starting point. It does not yet represent the complete initial product experience described in the product vision.

## Local Setup

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the project directory.

For automated checks:

```sh
npm install
npm test
```

## Privacy Direction

ReadTrail is intended to be opt-in per page, collect no reading state before activation, and keep saved data local by default. Permanent history should always be controlled by the reader.

The current implementation is still being aligned with these commitments. Do not assume every planned privacy behavior is complete yet.

## Project Status

The product vision is being shaped collaboratively before expanding the feature set. Exact reading-position restoration, intentional bookmarks, close-or-leave saving behavior, and the reading space are planned product areas rather than completed claims.
