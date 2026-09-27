# Architecture

Stable reference for surfaces, the message protocol, and storage schemas. Update this file in the same commit as any protocol or schema change.

## Surfaces

| Directory | Runs in | Responsibility |
|---|---|---|
| `background/service-worker.js` | Extension service worker | Single trust boundary. Validates every message and record. Owns all storage writes. |
| `shared/` | Every surface (classic scripts) | `constants.js` (DEFAULTS, ERRORS, LIMITS, KEYS), `validators.js`, `page-controls.js` (pure UI state machine). |
| `content/` | Every http(s) page at `document_idle` | Dormant until activated for this tab. `position.js` anchors, `renderer.js` canvas, `content.js` lifecycle, `passage.js` explicit selection capture. |
| `sidepanel/` | Chrome side panel | The margin of the current page: controls, recently closed, and the page-first library. Replaces `popup/` and `reading-space/` from Phase 3. |
| `sidepanel/desk.html` | A full tab (Phase A, in progress) | The Desk: sources beside drafts. Its own document, not a mode of the panel (DECISIONS 25). |
| `options/` | Options page | Appearance and behavior preferences via `setSettings`. |

The worker holds no in-memory state; every handler reads its key, acts, writes its key. All listeners are registered at top level so they wake the worker.

## Trust rule for tab identity

- Message from a content script (`sender.tab` present): tab id is `sender.tab.id`; any `msg.tabId` is ignored.
- Message from an extension page (`sender.tab` absent and `sender.url` inside `chrome.runtime.getURL("")`): `msg.tabId` is accepted.
- Anything else: `invalid-sender`.
- A tab record counts only when `record.url === msg.url`.

## Message protocol

All messages are `{ type, ... }` sent with `chrome.runtime.sendMessage`. Handlers reply asynchronously and return `true`. Unknown types return `false`.

| Type | From | Payload | Reply |
|---|---|---|---|
| `getSettings` | any | none | settings object |
| `setSettings` | options | `{settings}` | `{ok}` or `{ok:false,error}` |
| `getPageState` | content / page | `{url}` / `{tabId,url}` | `{ok,state}` |
| `setPageActive` | page | `{tabId,url,active}` | `{ok,state}` |
| `savePagePosition` | content | `{url,mode,position,title?,restoreQuality?}` | `{ok,state}` or `page-inactive` |
| `getTabInfo` | page | `{tabId}` | `{ok,url,title,incognito,supported}` |
| `persistResumePoint` | content | `{url,title,position}` | `{ok}` |
| `getSavedResumePoint` | page | `{url}` | `{ok,record}` (record may be null) |
| `listSavedResumePoints` | page | none | `{ok,items}` newest first |
| `removeSavedResumePoint` | page | `{url}` | `{ok}` |
| `clearSavedResumePoints` | page | none | `{ok}` |
| `continueSavedResumePoint` | page | `{url}` | `{ok,tabId}` |
| `listRecentlyClosed` | page | none | `{ok,items:[{url,title,closedAt}]}` |
| `saveRecentlyClosed` / `dismissRecentlyClosed` | page | `{url}` | `{ok}` |
| `savePassage` | page / content | `{tabId,url,title,text,start?,end?,tags?,note?}` (content sender's tab URL wins; `tabId` required from a page) | `{ok,passage}`, `library-full`, or `invalid-sender` |
| `updatePassage` | page | `{id,note?,tags?}` | `{ok,passage}` |
| `removePassage` / `removeNote` | page | `{id}` | `{ok}` |
| `listPassages` / `listNotes` | page / content | `{url?}` | `{ok,passages}` / `{ok,notes}` newest first |
| `saveNote` | page | `{tabId,url,title,text,tags?,source?}` (`tabId` required) | `{ok,note}` or `invalid-sender` |
| `updateNote` | page | `{id,text?,tags?}` | `{ok,note}` |
| `setPageTags` | page | `{url,tags,tabId?}` (`tabId` when tagging the open tab) | `{ok,tags}` or `invalid-sender` |
| `listLibrary` | page | none | `{ok,saved,passages,notes,pagemeta,counts,limit}` |
| `clearLibrary` | page | `{kinds?:["saved","passages","notes","pagemeta"]}` | `{ok,removed}` (never touches settings) |
| `removePageData` | page | `{url}` | `{ok,removed}` passages, notes, tags of one page |
| `saveDraft` | page | `{title,tags?,blocks?}` | `{ok,draft}` or `draft-full` |
| `updateDraft` | page | `{id,title?,tags?,blocks?}` | `{ok,draft}` |
| `removeDraft` / `listDrafts` | page | `{id}` / none | `{ok}` / `{ok,drafts}` newest first |
| `appendQuote` | page | `{draftId,passageId}` | `{ok,draft}` (snapshot copied from the passage) |
| `revealPassage` | page | `{id}` | `{ok,tabId,opened,quality}` or `not-found` |
| `takeSeededReveal` | content | `{url}` | `{ok,passage}` (authoritative `sender.tab.url` must match the one-time seed) |
| `completeSeededReveal` | content | `{quality}` | `{ok}`; completes the originating `revealPassage` reply |
| `exportLibrary` | page | none | `{ok,payload}` |
| `importLibrary` | page | `{payload,mode:"merge"|"replace"}` | `{ok,imported,skipped,rejected,mode}` |

Messages delivered to a content script with `chrome.tabs.sendMessage(tabId, ...)`:

| Type | Payload | Reply |
|---|---|---|
| `setPageActive` | `{active, state?}` | `{ok}` or `{ok:false,error:"superseded" or "save-failed"}` |
| `saveForLater` | none | `{ok}` or error code |
| `pageInfo` | none | `{url,title}` |
| `capturePassage` | none | `{ok,text,start,end,url,title}` or `{ok:false,error:"no-selection"|"too-long"}` |
| `revealPassage` | `{start,end,text}` | `{ok,quality:"exact"|"approximate"|"missing"}` |

### Return

A durable record about a page must be attributable to a tab. A content script's sender carries `incognito` itself; the side panel sends from an extension page, where there is no `sender.tab`, so it names a `tabId` and the worker resolves it with `chrome.tabs.get`, reading only `id` and `incognito`. Without the `tabs` permission Chrome leaves `url` and `title` undefined, which is why the worker never depends on them. `savePassage` and `saveNote` require the tab, because they persist something read from the page; `setPageTags` does not, because the library tags pages that are open in no tab, and a named tab is still resolved and refused.

`revealPassage` reads the clip, looks for a tab previously associated with its URL (`readtrail.seen.v1:<tabId>`, written only when the reader saved a clip from that tab), asks that candidate for `pageInfo`, and reuses it only when the exact live URL still matches. Stale records are removed. With no matching tab it opens one and seeds `reveal` in the new tab's record; the original Desk request stays pending until that content script returns `completeSeededReveal`, so every path reports an honest quality. The seed is released only to the non-incognito content sender whose authoritative tab URL matches, and only after the seed-clearing write succeeds.

The content script resolves both anchors and **compares the resolved text with the stored clip text** before reporting `exact`; otherwise it searches the page's text with the same whitespace normalisation capture uses, including separators between block elements, and reports `approximate`, or `missing`. The flash is a second named highlight removed on a timer, because CSS transitions do not apply to `::highlight`.

The worker's `background/library.js` owns the knowledge-layer handlers and the "Save selection to ReadTrail" context menu. `content/passage.js` captures the selection on request and draws saved passages with the CSS Custom Highlight API (no DOM mutation).

Error codes live in `shared/constants.js` (`ERRORS`). Do not invent new strings inline.

## Storage schema

### `chrome.storage.session` (cleared with the browser session)

```
"readtrail.tab.v1:<tabId>" = {
  version:1, url, title, active:boolean, mode:"following"|"frozen",
  position: null | { anchor, viewportOffset, scrollY, scrollRatio, savedAt },
  incognito:boolean, origin:"user"|"continue", restoreQuality?, updatedAt
}
"readtrail.recent.v1" = { version:1, items:[{tabId,url,title,position,closedAt}] }   // Phase 3, max 10, 30 min
"readtrail.seen.v1:<tabId>" = { version:1, url, updatedAt }   // written when a clip is saved from that tab, so Return can reuse it
```

A tab record may carry `reveal: {passageId}` when the tab was opened by Return, and `origin` may then be `"reveal"`. The content script consumes it once at bootstrap through `takeSeededReveal`, and the worker clears it so a reload never repeats the jump.

### `chrome.storage.local` (durable, this device only)

```
settings = { style, color, size, opacity, dotCount, fadeSpeed, highlightLine, highlightColor,
             closeSave:"ask"|"always"|"never", excludedHosts:string[] }   // hosts lowercase, no www., subdomains match
"readtrail.saved.v1:<exactUrl>" = { version:1, title, position, savedAt }
"readtrail.passage.v1:<uuid>"   = { version:1, id, url, title, text(<=4000), start, end, note, tags, createdAt, updatedAt }
"readtrail.note.v1:<uuid>"      = { version:1, id, url, title, text, tags, source?:"ai", createdAt, updatedAt }
"readtrail.pagemeta.v1:<url>"   = { version:1, tags, updatedAt }
"readtrail.draft.v1:<uuid>"     = { version:1, id, title, tags, blocks:[
                                      {type:"text", text} | {type:"quote", passageId, text, url, title}
                                    ], createdAt, updatedAt }
Draft bounds: 100 drafts, 200 blocks, 24,000 characters in total. Drafts do not count against the 1,500 clip limit.
A new durable write is refused past 9 MB of storage.local ("storage-full"); removals, clearing, and settings are never refused.
Bounds: 1,500 passages plus notes in total (refused with "library-full"), 20 tags of 40 characters, counts computed by listing keys.
"readtrail.ai.v1"               = { version:1, apiKey, model, updatedAt }                                            // 1.1 only
```

The 1.0 interface treats `pagemeta.tags` as the organizing tags. Passage and note `tags` remain in schema v1 for lossless import/export compatibility but are not exposed as controls. Library search can read page tags, titles, URLs, passage text, and note text; results are grouped by exact page URL.

`storage.sync` is never used.

### Anchor

```
v1: { version:1, path:number[], offset:number }
v2: { version:2, path:number[], offset:number,
      landmark: null | { id:string, path:number[] },
      check: { tag:string, textLength:number } }
```

No anchor contains page text. `clonePosition` and `cloneSavedRecord` in `shared/validators.js` must copy every field a version defines.

## Injection

Content scripts are statically injected on `*://*/*` and stay inert until activated. On-demand injection was rejected because side-panel clicks do not grant `activeTab` and "Continue reading" opens tabs programmatically. The `tabs` permission is never added. See `docs/DECISIONS.md`.
