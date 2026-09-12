# Chrome Web Store: Permission Justifications

Paste these into the "Privacy practices" tab of the developer dashboard. Keep them in sync with `manifest.json` and `PRIVACY.md`.

## Single purpose

ReadTrail helps people read long pages in the browser: it follows the current line, lets the reader pause at an exact place, and remembers that place for pages the reader chooses to save.

## Permission justifications

**storage**
Stores the reader's appearance preferences and the pages they explicitly saved (URL, title, and a structural reading position) in `chrome.storage.local` on the device. Temporary per-tab reading state lives in `chrome.storage.session` and is erased when Chrome closes. Nothing is synced or transmitted.

**activeTab**
Used by the side panel to identify the URL and title of the tab the reader is currently looking at, so the panel can show and control ReadTrail for that page. No page content is read through this permission.

**sidePanel**
ReadTrail's only user interface is a Chrome side panel with the current-page controls, saved pages, and the "recently closed" list. Clicking the toolbar icon opens it.

**contextMenus**
Adds one item, "Save selection to ReadTrail", so a reader can keep a passage from a page they are reading. The selection is stored only when the reader chooses this item.

**Host permission: all http and https sites (content script `*://*/*`)**
The reading guide must be able to run on whichever page the reader decides to use it on, and pages opened through "Continue reading" must restore without a new permission prompt. The content script is dormant until the reader turns ReadTrail on for that exact page in that tab: before activation it registers no event listeners, inspects no DOM for reading position, draws nothing, and writes no state. Automated tests in the public repository assert this dormancy (`tests/content.test.js`, "stays dormant"). Readers can also exclude sites in Settings.

## Remote code

None. All JavaScript ships inside the package. There is no eval, no remote script loading, and no network request in version 1.0.

## Data usage disclosure (1.0)

- Personally identifiable information: not collected.
- Health, financial, authentication information: not collected.
- Personal communications: not collected.
- Location: not collected.
- Web history: **not collected**. Page URLs are stored on the device only for pages the reader explicitly activates (temporary) or saves (durable). They are never transmitted.
- User activity: not collected. Click and pointer events are used live to draw the guide and are not logged.
- Website content: **stored on the device only when the reader explicitly saves a passage**. Never transmitted.

Certifications: data is not sold, not used for purposes unrelated to the single purpose, and not used for creditworthiness or lending.

## For 1.1 (BYO-key AI), update to

- Website content: user-initiated transmission of the reader's own saved passages and notes to Anthropic's API using an API key the reader supplied. Off unless a key is added. The developer never receives the data.
