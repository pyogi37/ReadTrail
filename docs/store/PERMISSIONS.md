# Chrome Web Store: Permission Justifications

Paste these into the "Privacy practices" tab of the developer dashboard. Keep them in sync with `manifest.json` and `PRIVACY.md`. Written for 2.0.0, the first submitted release.

## Single purpose

ReadTrail is a reading companion that stays on the reader's device: it follows the line the reader is on, lets them pause at an exact place and return to pages they chose to save, and lets them keep passages, notes and their own writing alongside the sources those passages came from.

## Permission justifications

**storage**
Stores the reader's appearance preferences; the pages they explicitly saved (URL, title, and a structural reading position); passages, notes and tags they explicitly saved; and drafts they write, each quote inside a draft carrying the passage, source and position it came from. All of it in `chrome.storage.local` on the device. Temporary per-tab reading state, and the tab id a clip was taken from, live in `chrome.storage.session` and are erased when Chrome closes. Nothing is synced or transmitted.

**activeTab**
Used by the side panel to identify the URL and title of the tab the reader is currently looking at, so the panel can show and control ReadTrail for that page. No page content is read through this permission.

**sidePanel**
ReadTrail's current-page controls and library live in a Chrome side panel, opened from the toolbar icon. The panel can also open the Desk, a full browser tab for writing drafts beside the sources they draw on.

**contextMenus**
Adds one item, "Save selection to ReadTrail", so a reader can keep a passage from a page they are reading. The selection is stored only when the reader chooses this item.

**Host permission: all http and https sites (content script `*://*/*`)**
The reading guide must be able to run on whichever page the reader decides to use it on, and pages opened through "Continue reading" must restore without a new permission prompt. The content script is dormant until the reader turns ReadTrail on for that exact page in that tab: before activation it registers no event listeners, tracks nothing, draws nothing, records no reading position, and writes no state. Two reader-initiated actions read the page at the moment they are chosen and at no other time: "Save selection to ReadTrail" reads the current selection, and "Return" locates a passage the reader previously saved so the page can be scrolled to it. Return stores nothing it reads; it reports only whether the passage was found exactly, found by its wording, or not found. Automated tests in the public repository assert this dormancy (`tests/content.test.js`, "stays dormant"). Readers can also exclude sites in Settings.

## Remote code

None. All JavaScript ships inside the package. There is no eval, no remote script loading, and no network request in 2.0.0.

## Data usage disclosure (2.0.0)

- Personally identifiable information: not collected.
- Health, financial, authentication information: not collected.
- Personal communications: not collected.
- Location: not collected.
- Web history: **not collected**. A page URL is stored on the device only for a page the reader explicitly acts on: a tab they turned ReadTrail on for, a page they saved, a page they clipped a passage from, or the tab that clip is open in. The tab-of-origin record is session-only and erased when the tab closes or Chrome does. No list of visited pages is built, and nothing is ever transmitted.
- User activity: not collected. Click and pointer events are used live to draw the guide and are not logged.
- Website content: **stored on the device only when the reader explicitly saves a passage, writes a note, or writes a draft**. A draft's quotes carry the passage text the reader already saved; nothing further is read from the page to build them. Never transmitted.

Certifications: data is not sold, not used for purposes unrelated to the single purpose, and not used for creditworthiness or lending.

## For 1.1 (BYO-key AI), update to

- Website content: user-initiated transmission of the reader's own saved passages and notes to Anthropic's API using an API key the reader supplied. Off unless a key is added. The developer never receives the data.
