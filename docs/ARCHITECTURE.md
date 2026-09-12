# Architecture

Stable reference for surfaces, the message protocol, and storage schemas. Update this file in the same commit as any protocol or schema change.

## Surfaces

| Directory | Runs in | Responsibility |
|---|---|---|
| `background/service-worker.js` | Extension service worker | Single trust boundary. Validates every message and record. Owns all storage writes. |
| `shared/` | Every surface (classic scripts) | `constants.js` (DEFAULTS, ERRORS, LIMITS, KEYS), `validators.js`, `page-controls.js` (pure UI state machine). |
| `content/` | Every http(s) page at `document_idle` | Dormant until activated for this tab. `position.js` anchors, `renderer.js` canvas, `content.js` lifecycle, `passage.js` explicit selection capture. |
| `sidepanel/` | Chrome side panel, or a full tab with `?mode=page` | Current-tab controls, library, recently closed, search. Replaces `popup/` and `reading-space/` from Phase 3. |
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
| `listRecentlyClosed`, `saveRecentlyClosed`, `dismissRecentlyClosed` | page | none / `{url}` / `{url}` | Phase 3 |
| `savePassage`, `updatePassage`, `removePassage`, `listPassages`, `saveNote`, `updateNote`, `removeNote`, `listNotes`, `setPageTags`, `listLibrary`, `clearLibrary`, `exportLibrary`, `importLibrary` | page | see Phase 4 sprint | Phase 4 |

Messages delivered to a content script with `chrome.tabs.sendMessage(tabId, ...)`:

| Type | Payload | Reply |
|---|---|---|
| `setPageActive` | `{active, state?}` | `{ok}` or `{ok:false,error:"superseded" or "save-failed"}` |
| `saveForLater` | none | `{ok}` or error code |
| `pageInfo` | none | `{url,title}` |
| `capturePassage` | none | `{ok,text,start,end}` (Phase 4) |

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
```

### `chrome.storage.local` (durable, this device only)

```
settings = { style, color, size, opacity, dotCount, fadeSpeed, highlightLine, highlightColor,
             closeSave:"ask"|"always"|"never", excludedHosts:string[] }
"readtrail.saved.v1:<exactUrl>" = { version:1, title, position, savedAt }
"readtrail.passage.v1:<uuid>"   = { version:1, id, url, title, text, start, end, note, tags, createdAt, updatedAt }   // Phase 4
"readtrail.note.v1:<uuid>"      = { version:1, id, url, title, text, tags, createdAt, updatedAt }                    // Phase 4
"readtrail.pagemeta.v1:<url>"   = { version:1, tags, updatedAt }                                                     // Phase 4
"readtrail.library.v1"          = { version:1, counts:{passages,notes}, updatedAt }                                  // Phase 4
"readtrail.ai.v1"               = { version:1, apiKey, model, updatedAt }                                            // 1.1 only
```

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
