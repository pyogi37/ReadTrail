# Manual QA Checklist

Automated tests run in JSDOM and cannot prove Chrome behavior. Run this checklist before every store submission and after any change to the worker, content script, or side panel. Log each run in `docs/qa/runs/<YYYY-MM-DD>-<version>.md` using the template at the bottom.

**Setup.** Fresh Chrome profile (114 or newer), Developer mode on, load the packaged zip or the unpacked repo. Open the extension's service-worker console from `chrome://extensions` and keep it visible.

**Test pages.** Use at least four: an arXiv HTML paper, a Wikipedia article, an MDN reference page, and a news site with a cookie banner. Add an SPA documentation site (for example a React docs page) for route-change cases.

Each case lists Steps and Expected. Record Pass, Fail, or Skip with evidence (screenshot name or console excerpt).

## QA-1 Activation and reading lock

- **QA-1.1 Dormant page.** Open a test page, open the side panel. Expected: "Use on this page", no marker on the page, no session write in the worker console.
- **QA-1.2 Activate.** Turn the toggle on. Expected: marker follows the pointer over text; the reading-lock notice disappeared; the page title shows in the panel.
- **QA-1.3 Pause and resume.** Click a line. Expected: marker freezes, centered on that line; pointer movement does not move it; scrolling keeps it attached to the text; a second click resumes following.
- **QA-1.4 Links under lock.** Click a link inside the article text. Expected: the marker pauses there; the link does not open.
- **QA-1.5 Selection.** Select a sentence with the mouse. Expected: selection works; the marker does not toggle.
- **QA-1.6 Off restores clicks.** Turn the toggle off, click a link. Expected: marker gone; link opens normally.
- **QA-1.7 On again restores place.** Navigate back, turn on. Expected: the earlier paused line is restored and scrolled into view.

## QA-2 Per-tab state

- **QA-2.1 Two tabs same URL.** Open the same article in tabs A and B. Activate in A only. Expected: B shows "Use on this page" and has no marker; reloading B keeps it dormant.
- **QA-2.2 Off in A leaves B.** Activate both, pause at different lines, turn A off. Expected: B stays active at its own line; clicking a link in A opens it; in B it pauses.
- **QA-2.3 Reload restores per tab.** Pause at different lines in A and B, reload both. Expected: each tab restores its own line.
- **QA-2.4 Navigate away.** In an active tab, navigate to a different article in the same tab. Expected: new page is dormant; going back is dormant too (documented behavior).
- **QA-2.5 Close tab.** Close B. Expected: the worker console shows no error; `readtrail.tab.v1:<B>` is gone (inspect `chrome.storage.session.get(null)` in the worker console).

## QA-3 Save for later and Continue reading

- **QA-3.1 Save.** Pause, choose Save for later. Expected: button reads Saved; the marker turns to the saved treatment; the page appears under Saved pages with title and domain.
- **QA-3.2 Update.** Read further, pause again, reopen the panel. Expected: "Update saved position" is offered; after choosing it, Saved.
- **QA-3.3 Restart.** Quit Chrome completely, reopen, open the panel. Expected: the saved page is still listed; the tab itself is dormant.
- **QA-3.4 Continue.** Choose Continue reading. Expected: a new tab opens at the exact URL, ReadTrail is active there, the saved line is restored and shown in the saved treatment.
- **QA-3.5 Continue while open elsewhere.** With the URL already open in a dormant tab C, choose Continue reading. Expected: a new tab D opens active; C stays dormant.
- **QA-3.6 Direct navigation stays dormant.** Type the saved URL in a new tab. Expected: dormant.
- **QA-3.7 Restore quality.** Save on a page, then change it (append a paragraph via DevTools or use a page whose banner differs), reload via Continue. Expected: the panel shows the restore note when the anchor could not be matched exactly.
- **QA-3.8 Remove and Clear all.** Remove one page (confirm), then Clear all (confirm). Expected: list updates; Settings unchanged.

## QA-4 Side panel and recently closed

- **QA-4.1 Follows tabs.** Switch between an active and a dormant tab. Expected: the panel updates within a moment without reopening.
- **QA-4.2 Unsupported tab.** Switch to `chrome://extensions` or the Web Store. Expected: "Not available on this page".
- **QA-4.3 Ask.** With Settings on Ask, activate a page, pause, close the tab. Expected: badge shows 1; the panel lists it under Recently closed; Save place moves it to Saved pages; badge clears.
- **QA-4.4 Always.** Set Always, repeat. Expected: the page appears directly under Saved pages; nothing under Recently closed.
- **QA-4.5 Never.** Set Never, repeat. Expected: nothing saved, nothing listed.
- **QA-4.6 Incognito.** Allow the extension in incognito, activate a page there, close it. Expected: never listed, never saved.
- **QA-4.7 Open in a tab.** Choose Open in a tab. Expected: the library opens as a full page without the This page section.
- **QA-4.8 Keyboard.** Tab through the panel. Expected: visible focus on every control; toggle and buttons work with Space or Enter.
- **QA-4.9 Reduced motion.** Enable reduced motion in the OS. Expected: no transitions in the panel.

## QA-5 Knowledge layer

- **QA-5.1 Save passage (context menu).** Select text on an active or dormant page, right-click, Save selection to ReadTrail. Expected: the passage appears in the library with the page title; the page shows a highlight if ReadTrail is active.
- **QA-5.2 Save passage (panel).** Select text, use the panel's Save selection. Expected: same result.
- **QA-5.3 Note and tags.** Add a note and two tags to the passage. Expected: saved immediately; visible after closing and reopening the panel.
- **QA-5.4 Search.** Search a word from the passage and from the note. Expected: ranked results; title matches rank above text matches.
- **QA-5.5 Connections.** Save a second passage from another page with a shared tag. Expected: each shows the other under Connections.
- **QA-5.6 Export and import.** Export, Clear all, Import in replace mode. Expected: identical library.
- **QA-5.7 Full library.** Not practical manually; covered by tests.

## QA-6 Settings and exclusions

- **QA-6.1 Appearance.** Change style, color, size. Expected: the active page updates live.
- **QA-6.2 Reset.** Reset to defaults. Expected: defaults restored, announced.
- **QA-6.3 Exclude site.** Exclude the current site. Expected: the panel reports the site is excluded and the toggle is unavailable; the content script does nothing there.

## QA-7 Package and install

- **QA-7.1 Install from zip.** Drag `dist/readtrail-<version>.zip` onto `chrome://extensions`. Expected: installs; worker console clean.
- **QA-7.2 Update.** Load a newer build over it. Expected: settings and saved pages preserved; console clean.
- **QA-7.3 Uninstall.** Remove the extension. Expected: no residue in other extensions or pages.

## Run template

```
# QA run <YYYY-MM-DD> <version>

Chrome: <version>  OS: <os>  Build: <zip sha256 or commit>
Tester: <name / agent>

| Case | Result | Evidence |
|---|---|---|
| QA-1.1 | Pass | 01-dormant.png |
| ... | ... | ... |

Exceptions approved by owner: <list or none>
```
