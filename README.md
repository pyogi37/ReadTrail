<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0f172a,100:1e3a8a&height=200&section=header&text=ReadTrail&fontSize=56&fontColor=ffffff&animation=fadeIn&fontAlignY=38&desc=A%20privacy-first%20reading%20companion%20for%20Chrome&descAlignY=58&descSize=18" width="100%"/>

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=500&size=20&duration=3000&pause=800&color=60A5FA&center=true&vCenter=true&width=650&lines=Resume+long-form+reading+without+losing+your+place;Local-first+%2B+Manifest+V3+%2B+Canvas+reading+trail;Private+by+default.+Intentional+by+design." alt="Typing SVG" />

<br/>

![Status](https://img.shields.io/badge/Status-Working%20MVP-22C55E?style=for-the-badge)
![Manifest](https://img.shields.io/badge/Manifest-V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![License](https://img.shields.io/badge/Privacy-Local--First-8B5CF6?style=for-the-badge&logo=googlechrome&logoColor=white)

[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](.)
[![Vitest](https://img.shields.io/badge/Tested%20with-Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)](.)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](.)

</div>

<br/>

## 📖 What is ReadTrail?

**ReadTrail is a privacy-first Chrome reading companion that helps you follow the current line, pause on an exact place, and return to pages you intentionally save.**

It explores a simple product question:

> How can a browser help people continue reading without turning their attention into another data stream?

<div align="center">

> ⚡ **Status:** Preparing 1.0 for the Chrome Web Store. The reading guide, anchored pause points, explicit Save for later flow, persistent resume points, side panel with saved pages, per-tab state, local preferences, and automated tests exist today.

</div>

<br/>

## ✅ What Works Today

<table>
<tr>
<td width="50%" valign="top">

- 🖊️ A visual guide that follows the current reading line
- 📍 A paused marker anchored to the selected text line while you scroll
- 🎨 Configurable trail styles, colors, size, opacity, and highlighting
- ⚙️ Explicit activation for the exact page you choose

</td>
<td width="50%" valign="top">

- 💾 Explicit **Save for later** with one persistent resume point per exact page URL
- 🕒 A quiet "Recently closed" list when a tab closes with unsaved reading (ask, always save, or never)
- 📚 A side panel with your saved pages: Continue reading, Remove, and Clear all
- 📄 Continue reading opens the page, activates reading lock, and restores the saved position
- 🔒 Local-only settings and saved-page data—no account, analytics, or page-text collection
- 🧩 Manifest V3 Chrome extension architecture
- 🧪 250+ automated tests with Vitest plus Playwright end-to-end scenarios
- ✂️ Keep each page's saved place, passages, notes, and tags together; browse tags, search locally, and export or import JSON

</td>
</tr>
</table>

<br/>

## 📸 Screenshots

### Follow your place on long-form pages

![ReadTrail reading guide highlighting the current passage on an arXiv article](docs/images/reading-guide-training.png)

![ReadTrail reading guide moved farther down the same arXiv article](docs/images/reading-guide-results.png)

### Customize the reading guide

![ReadTrail appearance settings with trail style, color, size, opacity, and text highlighting controls](docs/images/appearance-settings.png)

### Return to saved reading (side panel)

![ReadTrail Reading Space showing a saved article with Continue reading and Remove actions](docs/images/reading-space.png)

_Screenshot predates the side panel; the same list now lives in the panel._

<br/>

## 🧭 Product Principles

| Principle | What it means |
|---|---|
| **Private by default** | Reading data stays on the device unless the user explicitly chooses otherwise |
| **Intentional activation** | The extension does not collect reading state before it's enabled for a page |
| **Useful, not distracting** | Controls disappear behind the reading experience |
| **Honest product boundaries** | Planned capabilities are documented separately from features already implemented |

📄 See **[Product Vision](docs/PRODUCT-VISION.md)** for the product direction, decisions, and open questions.

<br/>

## 🏗️ How It's Structured

```text
shared/        Constants, validators, and the page-controls state machine
sidepanel/     Side panel: current-tab controls, recently closed, saved pages
options/       Extension settings
content/       On-page reading experience
background/    Extension lifecycle, validation, per-tab state, recently closed
tests/         Behavioral tests
docs/          Product vision, architecture, decisions, sprints
```

The extension uses standard HTML, CSS, and JavaScript with Chrome Manifest V3 APIs. A canvas overlay renders the reading trail. The service worker is the single trust boundary: it validates every message, keeps temporary reading state per tab in session storage, and owns every durable write. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

<br/>

## 🚀 Run It Locally

1. Clone or download this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode**
4. Select **Load unpacked** and choose the project directory
5. Open a text-heavy page, click the ReadTrail toolbar icon to open the side panel, and turn it on for that page
6. Move to a line and click once to pause the marker there
7. Choose **Save for later** in the side panel when you want the place to survive a browser restart
8. Use **Library → Pages** in the side panel to continue reading or expand a page's passages and notes

After changing the source, you do not need to reinstall the extension: click **Reload** on the ReadTrail card in `chrome://extensions`, then refresh any page you want to test.

**Run the automated checks:**

```sh
npm install
npm test                 # unit and behavioral tests
npx playwright install chromium
npm run test:e2e         # end-to-end against the unpacked extension
npm run package:check    # validates the store package
```

<br/>

## 🗺️ Roadmap

- [x] Session restoration to the exact reading position on unchanged pages
- [x] Explicit Save for later with one durable resume point per exact URL
- [x] Private saved-pages list (now in the side panel) for continuing and managing saved pages
- [x] Anchored paused markers that remain attached to their text while scrolling
- [x] Per-tab reading state so two tabs on the same page never interfere
- [x] More resilient restoration when a page's structure changes (landmark anchors, structural checks, proportional fallback)
- [x] Optional save offer when closing a tab with unsaved reading progress (side panel, no notifications)
- [x] Page-first library with passages, notes, page tags, grouped local search, and export/import
- [ ] Chrome Web Store 1.0 submission (release checklist in `docs/RELEASE-CHECKLIST.md`)
- [ ] 1.1: optional AI actions with your own Anthropic key

> Roadmap items are planned work, not completed claims.

<br/>

## 💡 Why I Built This

ReadTrail is a product-engineering project focused on browser APIs, local-first state, interaction design, privacy constraints, and turning an ambiguous user problem into an incremental product roadmap. It's being built in public as part of my work across customer-facing AI and full-stack product engineering.

<br/>

## 📚 Development Notes

More detail on the development workflow is available in **[DEVELOPMENT.md](DEVELOPMENT.md)**.

<br/>

<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:1e3a8a,100:0f172a&height=90&section=footer" width="100%"/>

</div>
