// Knowledge layer: passages, notes, page tags, counters, clear, export and
// import. Loaded into the service worker with importScripts after
// shared/constants.js and shared/validators.js. Every record is validated on
// the way in and cloned on the way out; the URL of a passage or note lives in
// the record because ids are random.
//
// Exposes globalThis.ReadTrailLibrary = { handlers, helpers } for the worker.
(() => {
  "use strict";

  const S = globalThis.ReadTrailShared;
  const { KEYS, LIMITS, ERRORS, VERSIONS } = S;

  function getLocalStore() {
    return chrome.storage && chrome.storage.local ? chrome.storage.local : null;
  }

  // An extension page is identified by its URL inside this extension. It may
  // also carry sender.tab when it is open in a tab (?mode=page), so this check
  // must run before any "is it a content script" check. Chrome sets
  // sender.url; a content script cannot claim an extension URL.
  function isExtensionPageSender(sender) {
    if (!sender || typeof sender.url !== "string") return false;
    try {
      const origin = chrome.runtime && typeof chrome.runtime.getURL === "function" ? chrome.runtime.getURL("") : null;
      return Boolean(origin) && sender.url.startsWith(origin);
    } catch (_) {
      return false;
    }
  }

  function isContentSender(sender) {
    return Boolean(sender && sender.tab) && !isExtensionPageSender(sender);
  }

  function passageKey(id) { return KEYS.PASSAGE_PREFIX + id; }
  function noteKey(id) { return KEYS.NOTE_PREFIX + id; }
  function pageMetaKey(url) { return KEYS.PAGEMETA_PREFIX + url; }
  function savedKey(url) { return KEYS.SAVED_PREFIX + url; }

  function urlFromKey(key, prefix) {
    if (typeof key !== "string" || !key.startsWith(prefix)) return null;
    const url = key.slice(prefix.length);
    return S.isValidPageUrl(url) ? url : null;
  }

  function newId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    // Fallback for environments without crypto.randomUUID: still a v4 shape.
    const hex = "0123456789abcdef";
    let out = "";
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
      else if (i === 14) out += "4";
      else if (i === 19) out += hex[(Math.random() * 4) | 8];
      else out += hex[(Math.random() * 16) | 0];
    }
    return out;
  }

  function cleanTitle(value) {
    const title = typeof value === "string" ? value.trim() : "";
    return title.length <= LIMITS.TITLE_MAX ? title : title.slice(0, LIMITS.TITLE_MAX);
  }

  function cleanText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  // Reads everything the library owns in one round trip. Callers get validated
  // clones grouped by kind, plus the raw key list for deletion.
  function readLibrary(callback) {
    const store = getLocalStore();
    if (!store) {
      callback(null, ERRORS.STORAGE_UNAVAILABLE);
      return;
    }
    store.get(null, (result) => {
      if (chrome.runtime.lastError) {
        callback(null, ERRORS.GET_STORAGE);
        return;
      }
      const library = { saved: [], passages: [], notes: [], pagemeta: [], keys: [] };
      for (const [key, value] of Object.entries(result || {})) {
        if (key.startsWith(KEYS.SAVED_PREFIX)) {
          const url = urlFromKey(key, KEYS.SAVED_PREFIX);
          if (url && S.isValidSavedRecord(value)) {
            library.saved.push({ url, ...S.cloneSavedRecord(value) });
            library.keys.push(key);
          }
        } else if (key.startsWith(KEYS.PASSAGE_PREFIX)) {
          if (S.isValidPassage(value) && key === passageKey(value.id)) {
            library.passages.push(S.clonePassage(value));
            library.keys.push(key);
          }
        } else if (key.startsWith(KEYS.NOTE_PREFIX)) {
          if (S.isValidNote(value) && key === noteKey(value.id)) {
            library.notes.push(S.cloneNote(value));
            library.keys.push(key);
          }
        } else if (key.startsWith(KEYS.PAGEMETA_PREFIX)) {
          const url = urlFromKey(key, KEYS.PAGEMETA_PREFIX);
          if (url && S.isValidPageMeta(value)) {
            library.pagemeta.push({ url, ...S.clonePageMeta(value) });
            library.keys.push(key);
          }
        }
      }
      library.saved.sort((a, b) => b.savedAt - a.savedAt);
      library.passages.sort((a, b) => b.updatedAt - a.updatedAt);
      library.notes.sort((a, b) => b.updatedAt - a.updatedAt);
      callback(library, null);
    });
  }

  function countEntries(callback) {
    readLibrary((library, error) => {
      if (error) {
        callback(null, error);
        return;
      }
      callback(library.passages.length + library.notes.length, null);
    });
  }

  function writeRecord(key, record, callback) {
    const store = getLocalStore();
    if (!store) {
      callback(ERRORS.STORAGE_UNAVAILABLE);
      return;
    }
    store.set({ [key]: record }, () => {
      callback(chrome.runtime.lastError ? ERRORS.SAVE_STORAGE : null);
    });
  }

  function removeKeys(keys, callback) {
    const store = getLocalStore();
    if (!store) {
      callback(ERRORS.STORAGE_UNAVAILABLE);
      return;
    }
    if (keys.length === 0) {
      callback(null);
      return;
    }
    store.remove(keys, () => {
      callback(chrome.runtime.lastError ? ERRORS.REMOVE_STORAGE : null);
    });
  }

  function readOne(key, validate, callback) {
    const store = getLocalStore();
    if (!store) {
      callback(null, ERRORS.STORAGE_UNAVAILABLE);
      return;
    }
    store.get([key], (result) => {
      if (chrome.runtime.lastError) {
        callback(null, ERRORS.GET_STORAGE);
        return;
      }
      const value = result && result[key];
      callback(validate(value) ? value : null, null);
    });
  }

  function reply(sendResponse, error, payload) {
    if (error) sendResponse({ ok: false, error });
    else sendResponse({ ok: true, ...(payload || {}) });
  }

  // --- Passages ---

  function handleSavePassage(msg, sender, sendResponse) {
    // A content script's sender URL is authoritative; extension pages name it.
    const fromContent = isContentSender(sender);
    const url = fromContent ? sender.tab.url : msg.url;
    const text = cleanText(msg.text);
    const tags = S.normalizeTags(msg.tags === undefined ? [] : msg.tags);
    if (!S.isValidPageUrl(url) || !S.isValidText(text, false) || tags === null) {
      reply(sendResponse, ERRORS.INVALID_INPUT);
      return;
    }
    if (fromContent && sender.tab.incognito === true) {
      reply(sendResponse, ERRORS.INVALID_SENDER);
      return;
    }
    const start = msg.start === undefined || msg.start === null ? null : msg.start;
    const end = msg.end === undefined || msg.end === null ? null : msg.end;
    if ((start !== null && !S.isValidAnchor(start)) || (end !== null && !S.isValidAnchor(end))) {
      reply(sendResponse, ERRORS.INVALID_INPUT);
      return;
    }
    countEntries((count, countError) => {
      if (countError) {
        reply(sendResponse, countError);
        return;
      }
      if (count >= LIMITS.LIBRARY_MAX) {
        reply(sendResponse, ERRORS.LIBRARY_FULL);
        return;
      }
      const now = Date.now();
      const record = {
        version: 1,
        id: newId(),
        url,
        title: cleanTitle(msg.title),
        text,
        start,
        end,
        note: cleanText(msg.note),
        tags,
        createdAt: now,
        updatedAt: now
      };
      if (!S.isValidPassage(record)) {
        reply(sendResponse, ERRORS.INVALID_INPUT);
        return;
      }
      writeRecord(passageKey(record.id), S.clonePassage(record), (error) => {
        reply(sendResponse, error, { passage: S.clonePassage(record) });
      });
    });
  }

  function handleUpdatePassage(msg, sendResponse) {
    if (!S.isValidId(msg.id)) {
      reply(sendResponse, ERRORS.INVALID_INPUT);
      return;
    }
    readOne(passageKey(msg.id), S.isValidPassage, (record, readError) => {
      if (readError) {
        reply(sendResponse, readError);
        return;
      }
      if (!record) {
        reply(sendResponse, ERRORS.NOT_FOUND);
        return;
      }
      const next = S.clonePassage(record);
      if (msg.note !== undefined) {
        const note = cleanText(msg.note);
        if (!S.isValidText(note, true)) {
          reply(sendResponse, ERRORS.INVALID_INPUT);
          return;
        }
        next.note = note;
      }
      if (msg.tags !== undefined) {
        const tags = S.normalizeTags(msg.tags);
        if (tags === null) {
          reply(sendResponse, ERRORS.INVALID_INPUT);
          return;
        }
        next.tags = tags;
      }
      next.updatedAt = Date.now();
      writeRecord(passageKey(next.id), next, (error) => {
        reply(sendResponse, error, { passage: S.clonePassage(next) });
      });
    });
  }

  function handleRemovePassage(msg, sendResponse) {
    if (!S.isValidId(msg.id)) {
      reply(sendResponse, ERRORS.INVALID_INPUT);
      return;
    }
    removeKeys([passageKey(msg.id)], (error) => reply(sendResponse, error));
  }

  function handleListPassages(msg, sendResponse) {
    readLibrary((library, error) => {
      if (error) {
        reply(sendResponse, error);
        return;
      }
      const url = msg && msg.url;
      const passages = S.isValidPageUrl(url)
        ? library.passages.filter((p) => p.url === url)
        : library.passages;
      reply(sendResponse, null, { passages });
    });
  }

  // --- Notes ---

  function handleSaveNote(msg, sender, sendResponse) {
    const fromContent = isContentSender(sender);
    const url = fromContent ? sender.tab.url : msg.url;
    const text = cleanText(msg.text);
    const tags = S.normalizeTags(msg.tags === undefined ? [] : msg.tags);
    if (!S.isValidPageUrl(url) || !S.isValidText(text, false) || tags === null) {
      reply(sendResponse, ERRORS.INVALID_INPUT);
      return;
    }
    if (fromContent && sender.tab.incognito === true) {
      reply(sendResponse, ERRORS.INVALID_SENDER);
      return;
    }
    countEntries((count, countError) => {
      if (countError) {
        reply(sendResponse, countError);
        return;
      }
      if (count >= LIMITS.LIBRARY_MAX) {
        reply(sendResponse, ERRORS.LIBRARY_FULL);
        return;
      }
      const now = Date.now();
      const record = {
        version: 1,
        id: newId(),
        url,
        title: cleanTitle(msg.title),
        text,
        tags,
        createdAt: now,
        updatedAt: now
      };
      if (msg.source === "ai") record.source = "ai";
      if (!S.isValidNote(record)) {
        reply(sendResponse, ERRORS.INVALID_INPUT);
        return;
      }
      writeRecord(noteKey(record.id), S.cloneNote(record), (error) => {
        reply(sendResponse, error, { note: S.cloneNote(record) });
      });
    });
  }

  function handleUpdateNote(msg, sendResponse) {
    if (!S.isValidId(msg.id)) {
      reply(sendResponse, ERRORS.INVALID_INPUT);
      return;
    }
    readOne(noteKey(msg.id), S.isValidNote, (record, readError) => {
      if (readError) {
        reply(sendResponse, readError);
        return;
      }
      if (!record) {
        reply(sendResponse, ERRORS.NOT_FOUND);
        return;
      }
      const next = S.cloneNote(record);
      if (msg.text !== undefined) {
        const text = cleanText(msg.text);
        if (!S.isValidText(text, false)) {
          reply(sendResponse, ERRORS.INVALID_INPUT);
          return;
        }
        next.text = text;
      }
      if (msg.tags !== undefined) {
        const tags = S.normalizeTags(msg.tags);
        if (tags === null) {
          reply(sendResponse, ERRORS.INVALID_INPUT);
          return;
        }
        next.tags = tags;
      }
      next.updatedAt = Date.now();
      writeRecord(noteKey(next.id), next, (error) => {
        reply(sendResponse, error, { note: S.cloneNote(next) });
      });
    });
  }

  function handleRemoveNote(msg, sendResponse) {
    if (!S.isValidId(msg.id)) {
      reply(sendResponse, ERRORS.INVALID_INPUT);
      return;
    }
    removeKeys([noteKey(msg.id)], (error) => reply(sendResponse, error));
  }

  function handleListNotes(msg, sendResponse) {
    readLibrary((library, error) => {
      if (error) {
        reply(sendResponse, error);
        return;
      }
      const url = msg && msg.url;
      const notes = S.isValidPageUrl(url) ? library.notes.filter((n) => n.url === url) : library.notes;
      reply(sendResponse, null, { notes });
    });
  }

  // --- Page tags ---

  function handleSetPageTags(msg, sendResponse) {
    const tags = S.normalizeTags(msg.tags);
    if (!S.isValidPageUrl(msg.url) || tags === null) {
      reply(sendResponse, ERRORS.INVALID_INPUT);
      return;
    }
    const key = pageMetaKey(msg.url);
    if (tags.length === 0) {
      removeKeys([key], (error) => reply(sendResponse, error, { tags: [] }));
      return;
    }
    writeRecord(key, { version: 1, tags, updatedAt: Date.now() }, (error) => {
      reply(sendResponse, error, { tags });
    });
  }

  // --- Whole library ---

  function handleListLibrary(sendResponse) {
    readLibrary((library, error) => {
      if (error) {
        reply(sendResponse, error);
        return;
      }
      const { keys: _keys, ...rest } = library;
      const counts = { passages: library.passages.length, notes: library.notes.length, saved: library.saved.length };
      reply(sendResponse, null, { ...rest, counts, limit: LIMITS.LIBRARY_MAX });
    });
  }

  const KIND_PREFIXES = {
    saved: KEYS.SAVED_PREFIX,
    passages: KEYS.PASSAGE_PREFIX,
    notes: KEYS.NOTE_PREFIX,
    pagemeta: KEYS.PAGEMETA_PREFIX
  };

  // Removes only the chosen kinds. Settings and everything outside the
  // library prefixes are never touched.
  function handleClearLibrary(msg, sendResponse) {
    const kinds = Array.isArray(msg.kinds) ? msg.kinds : Object.keys(KIND_PREFIXES);
    if (!kinds.every((kind) => Object.prototype.hasOwnProperty.call(KIND_PREFIXES, kind))) {
      reply(sendResponse, ERRORS.INVALID_INPUT);
      return;
    }
    const store = getLocalStore();
    if (!store) {
      reply(sendResponse, ERRORS.STORAGE_UNAVAILABLE);
      return;
    }
    store.get(null, (result) => {
      if (chrome.runtime.lastError) {
        reply(sendResponse, ERRORS.GET_STORAGE);
        return;
      }
      const prefixes = kinds.map((kind) => KIND_PREFIXES[kind]);
      const keys = Object.keys(result || {}).filter((key) => prefixes.some((prefix) => key.startsWith(prefix)));
      removeKeys(keys, (error) => reply(sendResponse, error === ERRORS.REMOVE_STORAGE ? ERRORS.CLEAR_STORAGE : error, { removed: keys.length }));
    });
  }

  // Removes passages, notes, and tags that belong to one page.
  function handleRemovePageData(msg, sendResponse) {
    if (!S.isValidPageUrl(msg.url)) {
      reply(sendResponse, ERRORS.INVALID_INPUT);
      return;
    }
    readLibrary((library, error) => {
      if (error) {
        reply(sendResponse, error);
        return;
      }
      const keys = [
        ...library.passages.filter((p) => p.url === msg.url).map((p) => passageKey(p.id)),
        ...library.notes.filter((n) => n.url === msg.url).map((n) => noteKey(n.id)),
        ...library.pagemeta.filter((m) => m.url === msg.url).map((m) => pageMetaKey(m.url))
      ];
      removeKeys(keys, (removeError) => reply(sendResponse, removeError, { removed: keys.length }));
    });
  }

  function handleExportLibrary(sendResponse) {
    readLibrary((library, error) => {
      if (error) {
        reply(sendResponse, error);
        return;
      }
      reply(sendResponse, null, {
        payload: {
          format: "readtrail-export",
          version: 1,
          exportedAt: Date.now(),
          saved: library.saved,
          passages: library.passages,
          notes: library.notes,
          pagemeta: library.pagemeta
        }
      });
    });
  }

  // Import validates every record with the shared validators. `merge` skips
  // records whose id or URL already exists; `replace` clears the library
  // first. Records that fail validation are counted and dropped.
  function handleImportLibrary(msg, sendResponse) {
    const payload = msg.payload;
    const mode = msg.mode === "replace" ? "replace" : "merge";
    if (!S.isValidExport(payload)) {
      reply(sendResponse, ERRORS.INVALID_INPUT);
      return;
    }
    let size = 0;
    try {
      size = JSON.stringify(payload).length;
    } catch (_) {
      reply(sendResponse, ERRORS.INVALID_INPUT);
      return;
    }
    if (size > LIMITS.IMPORT_MAX_BYTES) {
      reply(sendResponse, ERRORS.INVALID_INPUT);
      return;
    }
    const proceed = (library) => {
      const existingSaved = new Set(library.saved.map((s) => s.url));
      const existingPassages = new Set(library.passages.map((p) => p.id));
      const existingNotes = new Set(library.notes.map((n) => n.id));
      const existingMeta = new Set(library.pagemeta.map((m) => m.url));
      const writes = {};
      let imported = 0;
      let skipped = 0;
      let rejected = 0;
      let entries = library.passages.length + library.notes.length;

      for (const item of payload.saved) {
        const { url, ...record } = item || {};
        if (!S.isValidPageUrl(url) || !S.isValidSavedRecord(record)) { rejected += 1; continue; }
        if (existingSaved.has(url)) { skipped += 1; continue; }
        writes[savedKey(url)] = S.cloneSavedRecord(record);
        existingSaved.add(url);
        imported += 1;
      }
      for (const item of payload.passages) {
        if (!S.isValidPassage(item)) { rejected += 1; continue; }
        if (existingPassages.has(item.id)) { skipped += 1; continue; }
        if (entries >= LIMITS.LIBRARY_MAX) { rejected += 1; continue; }
        writes[passageKey(item.id)] = S.clonePassage(item);
        existingPassages.add(item.id);
        entries += 1;
        imported += 1;
      }
      for (const item of payload.notes) {
        if (!S.isValidNote(item)) { rejected += 1; continue; }
        if (existingNotes.has(item.id)) { skipped += 1; continue; }
        if (entries >= LIMITS.LIBRARY_MAX) { rejected += 1; continue; }
        writes[noteKey(item.id)] = S.cloneNote(item);
        existingNotes.add(item.id);
        entries += 1;
        imported += 1;
      }
      for (const item of payload.pagemeta) {
        const { url, ...record } = item || {};
        if (!S.isValidPageUrl(url) || !S.isValidPageMeta(record)) { rejected += 1; continue; }
        if (existingMeta.has(url)) { skipped += 1; continue; }
        writes[pageMetaKey(url)] = S.clonePageMeta(record);
        existingMeta.add(url);
        imported += 1;
      }
      const store = getLocalStore();
      if (!store) {
        reply(sendResponse, ERRORS.STORAGE_UNAVAILABLE);
        return;
      }
      const finish = () => reply(sendResponse, null, { imported, skipped, rejected, mode });
      if (Object.keys(writes).length === 0) {
        finish();
        return;
      }
      store.set(writes, () => {
        if (chrome.runtime.lastError) {
          reply(sendResponse, ERRORS.SAVE_STORAGE);
          return;
        }
        finish();
      });
    };

    if (mode === "replace") {
      handleClearLibrary({ kinds: Object.keys(KIND_PREFIXES) }, (cleared) => {
        if (!cleared.ok) {
          sendResponse(cleared);
          return;
        }
        proceed({ saved: [], passages: [], notes: [], pagemeta: [] });
      });
      return;
    }
    readLibrary((library, error) => {
      if (error) {
        reply(sendResponse, error);
        return;
      }
      proceed(library);
    });
  }

  // --- Context menu: save the current selection from any page ---

  const MENU_ID = "readtrail-save-selection";

  function registerContextMenu() {
    const menus = chrome.contextMenus;
    if (!menus || typeof menus.create !== "function") return;
    try {
      menus.removeAll(() => {
        void chrome.runtime.lastError;
        menus.create({
          id: MENU_ID,
          title: "Save selection to ReadTrail",
          contexts: ["selection"],
          documentUrlPatterns: ["http://*/*", "https://*/*"]
        }, () => { void chrome.runtime.lastError; });
      });
    } catch (_) { /* context menus unavailable */ }
  }

  function onContextMenuClick(info, tab) {
    if (!info || info.menuItemId !== MENU_ID || !tab || !S.isValidTabId(tab.id)) return;
    if (tab.incognito === true) return;
    const tabs = chrome.tabs;
    if (!tabs || typeof tabs.sendMessage !== "function") return;
    try {
      tabs.sendMessage(tab.id, { type: "capturePassage" }, (captured) => {
        if (chrome.runtime.lastError || !captured || !captured.ok) return;
        handleSavePassage(
          { title: captured.title, text: captured.text, start: captured.start, end: captured.end },
          { tab: { id: tab.id, url: captured.url, incognito: Boolean(tab.incognito) } },
          () => {}
        );
      });
    } catch (_) { /* tab gone */ }
  }

  globalThis.ReadTrailLibrary = {
    MENU_ID,
    isExtensionPageSender,
    isContentSender,
    registerContextMenu,
    onContextMenuClick,
    readLibrary,
    handlers: {
      savePassage: handleSavePassage,
      updatePassage: handleUpdatePassage,
      removePassage: handleRemovePassage,
      listPassages: handleListPassages,
      saveNote: handleSaveNote,
      updateNote: handleUpdateNote,
      removeNote: handleRemoveNote,
      listNotes: handleListNotes,
      setPageTags: handleSetPageTags,
      listLibrary: handleListLibrary,
      clearLibrary: handleClearLibrary,
      removePageData: handleRemovePageData,
      exportLibrary: handleExportLibrary,
      importLibrary: handleImportLibrary
    }
  };
})();
