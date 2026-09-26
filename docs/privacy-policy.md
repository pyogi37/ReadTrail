# ReadTrail Privacy Policy

_Last updated: 2026-09-27. Describes ReadTrail as it currently behaves; the release it ships with is named in the changelog._

ReadTrail is a Chrome extension that helps you follow the current line while reading, pause at an exact place, and return to pages you deliberately save. It is built local-first: everything it stores stays in your Chrome profile on your device.

## What ReadTrail stores

| Data | When | Where | Why |
|---|---|---|---|
| Appearance and behavior preferences (marker style, color, size, what to do when a tab closes) | When you change them in Settings | `chrome.storage.local` on this device | To draw the reading guide the way you chose |
| Temporary reading position for a tab (a structural anchor, scroll offset, the tab's page URL and title) | Only after you turn ReadTrail on for that tab, while it is on | `chrome.storage.session` on this device; erased when Chrome closes | To restore your line after a reload and to offer saving when the tab closes |
| Saved pages (exact page URL, page title, reading position) | Only when you choose **Save for later** or when you chose "Always save my place" in Settings | `chrome.storage.local` on this device | So you can continue reading later |
| Recently closed list (page URL, title, position) | Only when a tab closes with unsaved progress and your setting is "Ask me" | `chrome.storage.session`; each entry expires after 30 minutes | To let you save that place from the side panel |
| Saved passages, notes, and tags (the text you selected, notes you typed, tags you added) | Only when you explicitly save a passage, write a note, or add a tag | `chrome.storage.local` on this device | Your reading library |
| Drafts you write (their title, your text, and the passages you quoted) | Only when you create or edit a draft | `chrome.storage.local` on this device | Your own writing, with each quote still pointing at the passage it came from |
| Which page a tab is showing (its URL only) | Only when you save a clip from that tab | `chrome.storage.session` on this device; removed when the tab closes and erased when Chrome closes | So **Return** can bring you back to the tab you are already using instead of opening a second one |

The reading position never contains page text. It stores a path of child-node indexes, the id of a nearby element, the tag name and length of the text node, and scroll offsets.

## What ReadTrail never does

- It never reads a page on its own. Before you turn ReadTrail on for a page it attaches no listeners, follows nothing you do, draws nothing, and records no reading position.
- Two actions read a page because you asked them to, and only at the moment you ask. **Save selection** reads the text you have selected. **Return** looks for a passage you already saved, so it can scroll you to it. Return keeps nothing it sees: it reports only whether it found the passage exactly, found it by its wording because the page changed, or could not find it.
- It does not collect browsing history. A page URL is stored only for tabs you activated, and durably only for pages you saved.
- It does not send any data anywhere. ReadTrail makes no network requests at all.
- It does not use analytics, telemetry, accounts, or cloud sync. `chrome.storage.sync` is never used.
- It does not store anything from incognito tabs durably, and it never offers to save them.

## Permissions

- **storage**: keep your preferences and saved pages on this device.
- **activeTab**: learn the URL and title of the tab you are looking at when you use the side panel.
- **sidePanel**: show the ReadTrail side panel.
- **contextMenus**: offer "Save selection to ReadTrail" in the right-click menu.
- **Access to all http and https sites** (declared as a content script): the reading guide has to be able to run on whichever page you choose. The script is inert until you turn ReadTrail on for that exact page; it attaches no listeners, draws nothing, and writes nothing before then. This is covered by automated tests in the source repository.

## Deleting your data

- Remove one saved page, passage, or note from the side panel.
- **Clear all** removes every saved page (and, when you choose, passages and notes) from this device.
- Reset to defaults in Settings restores default preferences.
- Uninstalling ReadTrail removes everything it stored.

## Export

You can export your library as a JSON file from the side panel. The export contains your saved pages, passages, notes, and tags in plain text. Keep it somewhere safe.

## Changes

Changes to this policy are recorded in the project changelog. If a future version adds any network feature, it will be optional, off by default, and described here before it ships.

## Contact

Questions: open an issue at https://github.com/pyogi37/ReadTrail or email amits12081994@gmail.com.
