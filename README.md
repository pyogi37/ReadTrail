<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0f172a,100:1e3a8a&height=200&section=header&text=ReadTrail&fontSize=56&fontColor=ffffff&animation=fadeIn&fontAlignY=38&desc=A%20privacy-first%20reading%20companion%20for%20Chrome&descAlignY=58&descSize=18" width="100%"/>

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=500&size=20&duration=3000&pause=800&color=60A5FA&center=true&vCenter=true&width=650&lines=Resume+long-form+reading+without+losing+your+place;Local-first+%2B+Manifest+V3+%2B+Canvas+reading+trail;Private+by+default.+Intentional+by+design." alt="Typing SVG" />

<br/>

![Status](https://img.shields.io/badge/Status-Active%20Early--Stage%20Build-22C55E?style=for-the-badge)
![Manifest](https://img.shields.io/badge/Manifest-V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![License](https://img.shields.io/badge/Privacy-Local--First-8B5CF6?style=for-the-badge&logo=googlechrome&logoColor=white)

[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](.)
[![Vitest](https://img.shields.io/badge/Tested%20with-Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)](.)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](.)

</div>

<br/>

## 📖 What is ReadTrail?

**ReadTrail adds a configurable visual reading guide to text-heavy pages and remembers page-level reading state locally.**

It explores a simple product question:

> How can a browser help people continue reading without turning their attention into another data stream?

<div align="center">

> ⚡ **Status:** Active early-stage build. The core extension, reading guide, local preferences, page lifecycle, and automated tests exist today. The broader reading workspace is still being developed.

</div>

<br/>

## ✅ What Works Today

<table>
<tr>
<td width="50%" valign="top">

- 🖊️ Canvas-based reading trail for following the current line
- 🎨 Configurable line highlighting and visual preferences
- ⚙️ Exact-page activation from the popup and a dedicated appearance settings page

</td>
<td width="50%" valign="top">

- 💾 Local settings persistence
- 📄 Session-only reading-position restore for the exact pages you activate
- 🧩 Manifest V3 Chrome extension architecture
- 🧪 Automated behavioral tests with Vitest

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
popup/       Quick controls
options/     Extension settings
content/     On-page reading experience
background/  Extension lifecycle and page state
tests/       Behavioral tests
docs/        Product vision and engineering notes
```

The extension uses standard HTML, CSS, and JavaScript with Chrome Manifest V3 APIs. A canvas overlay renders the reading trail, while extension storage and background logic coordinate preferences and page state.

<br/>

## 🚀 Run It Locally

1. Clone or download this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode**
4. Select **Load unpacked** and choose the project directory
5. Open a text-heavy page and activate ReadTrail from the extension popup

After changing the source, you do not need to reinstall the extension: click **Reload** on the ReadTrail card in `chrome://extensions`, then refresh any page you want to test.

**Run the automated checks:**

```sh
npm install
npm test
```

<br/>

## 🗺️ Roadmap

- [x] Session-only restoration to the exact reading position on unchanged pages
- [ ] Intentional bookmarks and unfinished-reading navigation
- [ ] Clear save behavior when closing or leaving a page
- [ ] A private reading space for revisiting saved material
- [ ] Reflection and knowledge connections built on top of reliable reading memory

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
