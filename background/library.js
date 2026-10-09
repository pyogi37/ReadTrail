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
  function draftKey(id) { return KEYS.DRAFT_PREFIX + id; }
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
      const library = { saved: [], passages: [], notes: [], pagemeta: [], drafts: [], keys: [] };
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
        } else if (key.startsWith(KEYS.DRAFT_PREFIX)) {
          if (S.isValidDraft(value) && key === draftKey(value.id)) {
            library.drafts.push(S.cloneDraft(value));
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
      library.drafts.sort((a, b) => b.updatedAt - a.updatedAt);
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

  // Refuses a new durable write once storage.local is nearly full, so the
  // reader can always delete their way back out. Removals, clearing, and
  // settings never pass through here. A browser without getBytesInUse (or the
  // test mock) is treated as having room.
  function guardStorage(callback) {
    const store = getLocalStore();
    if (!store || typeof store.getBytesInUse !== "function") {
      callback(null);
      return;
    }
    try {
      store.getBytesInUse(null, (bytes) => {
        if (chrome.runtime.lastError) {
          callback(null);
          return;
        }
        callback(typeof bytes === "number" && bytes >= LIMITS.STORAGE_SOFT_MAX ? ERRORS.STORAGE_FULL : null);
      });
    } catch (_) {
      callback(null);
    }
  }

  function recordSize(value) {
    try { return JSON.stringify(value).length; } catch (_) { return Number.MAX_SAFE_INTEGER; }
  }

  function guardGrowingWrite(previous, next, callback) {
    if (previous && recordSize(next) <= recordSize(previous)) {
      callback(null);
      return;
    }
    guardStorage(callback);
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
    if ((start !== null && !S.isValidSavedAnchor(start)) || (end !== null && !S.isValidSavedAnchor(end))) {
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
      guardStorage((fullError) => {
        if (fullError) { reply(sendResponse, fullError); return; }
        writeRecord(passageKey(record.id), S.clonePassage(record), (error) => {
          reply(sendResponse, error, { passage: S.clonePassage(record) });
        });
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
      guardGrowingWrite(record, next, (fullError) => {
        if (fullError) { reply(sendResponse, fullError); return; }
        writeRecord(passageKey(next.id), next, (error) => {
          reply(sendResponse, error, { passage: S.clonePassage(next) });
        });
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
      guardStorage((fullError) => {
        if (fullError) { reply(sendResponse, fullError); return; }
        writeRecord(noteKey(record.id), S.cloneNote(record), (error) => {
          reply(sendResponse, error, { note: S.cloneNote(record) });
        });
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
      guardGrowingWrite(record, next, (fullError) => {
        if (fullError) { reply(sendResponse, fullError); return; }
        writeRecord(noteKey(next.id), next, (error) => {
          reply(sendResponse, error, { note: S.cloneNote(next) });
        });
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

  function handleSetPageTags(msg, sender, sendResponse) {
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
    const next = { version: 1, tags, updatedAt: Date.now() };
    readOne(key, S.isValidPageMeta, (previous, readError) => {
      if (readError) { reply(sendResponse, readError); return; }
      guardGrowingWrite(previous, next, (fullError) => {
        if (fullError) { reply(sendResponse, fullError); return; }
        writeRecord(key, next, (error) => reply(sendResponse, error, { tags }));
      });
    });
  }

  // --- Drafts ---

  // Accepts only blocks that are already well formed. A quote's snapshot is
  // never taken from the caller's word: handleAppendQuote copies it from the
  // stored passage, and an edit may only keep or drop a quote, never invent one.
  // What a surface may never author: the passage a quote points at and the
  // snapshot of it. What a surface may change: `checked`, which is Return
  // reporting what it last found. Signing the whole block, `checked` included,
  // made every save after a Return look like tampering and silently rejected
  // the reader's writing from then on.
  function quoteProvenance(block) {
    return JSON.stringify({
      passageId: block.passageId,
      text: block.text,
      url: block.url,
      title: block.title
    });
  }

  function cleanBlocks(value, existingBlocks = []) {
    if (!Array.isArray(value)) return null;
    const allowedQuotes = new Map();
    for (const block of existingBlocks) {
      if (block.type !== "quote") continue;
      const signature = quoteProvenance(block);
      allowedQuotes.set(signature, (allowedQuotes.get(signature) || 0) + 1);
    }
    const out = [];
    for (const raw of value) {
      if (!S.isRecord(raw)) return null;
      if (raw.type === "text") {
        const text = typeof raw.text === "string" ? raw.text : "";
        if (text.length > LIMITS.TEXT_MAX) return null;
        out.push({ type: "text", text });
        continue;
      }
      if (raw.type !== "quote" || !S.isValidDraftBlock(raw)) return null;
      const quote = S.cloneDraftBlock(raw);
      const signature = quoteProvenance(quote);
      const remaining = allowedQuotes.get(signature) || 0;
      if (remaining === 0) return null;
      allowedQuotes.set(signature, remaining - 1);
      out.push(quote);
    }
    return S.isValidDraftBlocks(out) ? out : null;
  }

  function handleSaveDraft(msg, sendResponse) {
    const title = cleanTitle(msg.title);
    const tags = S.normalizeTags(msg.tags === undefined ? [] : msg.tags);
    const blocks = cleanBlocks(msg.blocks === undefined ? [] : msg.blocks);
    if (!S.isValidTitle(title) || tags === null || blocks === null) {
      reply(sendResponse, ERRORS.INVALID_INPUT);
      return;
    }
    readLibrary((library, readError) => {
      if (readError) {
        reply(sendResponse, readError);
        return;
      }
      if (library.drafts.length >= LIMITS.DRAFTS_MAX) {
        reply(sendResponse, ERRORS.DRAFT_FULL);
        return;
      }
      guardStorage((fullError) => {
        if (fullError) {
          reply(sendResponse, fullError);
          return;
        }
        const now = Date.now();
        const record = { version: 1, id: newId(), title, tags, blocks, createdAt: now, updatedAt: now };
        if (!S.isValidDraft(record)) {
          reply(sendResponse, ERRORS.INVALID_INPUT);
          return;
        }
        writeRecord(draftKey(record.id), S.cloneDraft(record), (error) => {
          reply(sendResponse, error, { draft: S.cloneDraft(record) });
        });
      });
    });
  }

  function handleUpdateDraft(msg, sendResponse) {
    if (!S.isValidId(msg.id)) {
      reply(sendResponse, ERRORS.INVALID_INPUT);
      return;
    }
    readOne(draftKey(msg.id), S.isValidDraft, (record, readError) => {
      if (readError) {
        reply(sendResponse, readError);
        return;
      }
      if (!record) {
        reply(sendResponse, ERRORS.NOT_FOUND);
        return;
      }
      const next = S.cloneDraft(record);
      if (msg.title !== undefined) {
        const title = cleanTitle(msg.title);
        if (!S.isValidTitle(title)) {
          reply(sendResponse, ERRORS.INVALID_INPUT);
          return;
        }
        next.title = title;
      }
      if (msg.tags !== undefined) {
        const tags = S.normalizeTags(msg.tags);
        if (tags === null) {
          reply(sendResponse, ERRORS.INVALID_INPUT);
          return;
        }
        next.tags = tags;
      }
      if (msg.blocks !== undefined) {
        const blocks = cleanBlocks(msg.blocks, record.blocks);
        if (blocks === null) {
          reply(sendResponse, ERRORS.INVALID_INPUT);
          return;
        }
        next.blocks = blocks;
      }
      next.updatedAt = Date.now();
      guardGrowingWrite(record, next, (fullError) => {
        if (fullError) { reply(sendResponse, fullError); return; }
        writeRecord(draftKey(next.id), next, (error) => {
          reply(sendResponse, error, { draft: S.cloneDraft(next) });
        });
      });
    });
  }

  function handleRemoveDraft(msg, sendResponse) {
    if (!S.isValidId(msg.id)) {
      reply(sendResponse, ERRORS.INVALID_INPUT);
      return;
    }
    removeKeys([draftKey(msg.id)], (error) => reply(sendResponse, error));
  }

  function handleListDrafts(sendResponse) {
    readLibrary((library, error) => {
      if (error) {
        reply(sendResponse, error);
        return;
      }
      reply(sendResponse, null, { drafts: library.drafts });
    });
  }

  // The snapshot in a quote block is copied here, from the stored passage, so
  // no surface can author provenance it never read.
  function handleAppendQuote(msg, sendResponse) {
    if (!S.isValidId(msg.draftId) || !S.isValidId(msg.passageId)) {
      reply(sendResponse, ERRORS.INVALID_INPUT);
      return;
    }
    readOne(passageKey(msg.passageId), S.isValidPassage, (passage, passageError) => {
      if (passageError) {
        reply(sendResponse, passageError);
        return;
      }
      if (!passage) {
        reply(sendResponse, ERRORS.NOT_FOUND);
        return;
      }
      readOne(draftKey(msg.draftId), S.isValidDraft, (draft, draftError) => {
        if (draftError) {
          reply(sendResponse, draftError);
          return;
        }
        if (!draft) {
          reply(sendResponse, ERRORS.NOT_FOUND);
          return;
        }
        const next = S.cloneDraft(draft);
        next.blocks.push({
          type: "quote",
          passageId: passage.id,
          text: passage.text,
          url: passage.url,
          title: passage.title
        });
        if (!S.isValidDraftBlocks(next.blocks)) {
          reply(sendResponse, ERRORS.DRAFT_FULL);
          return;
        }
        next.updatedAt = Date.now();
        guardStorage((fullError) => {
          if (fullError) {
            reply(sendResponse, fullError);
            return;
          }
          writeRecord(draftKey(next.id), next, (error) => {
            reply(sendResponse, error, { draft: S.cloneDraft(next) });
          });
        });
      });
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
      const counts = {
        passages: library.passages.length,
        notes: library.notes.length,
        saved: library.saved.length,
        drafts: library.drafts.length
      };
      reply(sendResponse, null, { ...rest, counts, limit: LIMITS.LIBRARY_MAX });
    });
  }

  const KIND_PREFIXES = {
    saved: KEYS.SAVED_PREFIX,
    passages: KEYS.PASSAGE_PREFIX,
    notes: KEYS.NOTE_PREFIX,
    pagemeta: KEYS.PAGEMETA_PREFIX,
    drafts: KEYS.DRAFT_PREFIX
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
          pagemeta: library.pagemeta,
          drafts: library.drafts
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
    const invalidRecord = payload.saved.some((item) => {
      const { url, ...record } = item || {};
      return !S.isValidPageUrl(url) || !S.isValidSavedRecord(record);
    }) || payload.passages.some((item) => !S.isValidPassage(item))
      || payload.notes.some((item) => !S.isValidNote(item))
      || payload.pagemeta.some((item) => {
        const { url, ...record } = item || {};
        return !S.isValidPageUrl(url) || !S.isValidPageMeta(record);
      })
      || (Array.isArray(payload.drafts) && payload.drafts.some((item) => !S.isValidDraft(item)));
    if (mode === "replace" && invalidRecord) {
      reply(sendResponse, ERRORS.INVALID_INPUT);
      return;
    }
    const proceed = (library) => {
      const existingSaved = new Set(library.saved.map((s) => s.url));
      const existingPassages = new Set(library.passages.map((p) => p.id));
      const existingNotes = new Set(library.notes.map((n) => n.id));
      const existingMeta = new Set(library.pagemeta.map((m) => m.url));
      const existingDrafts = new Set(library.drafts.map((d) => d.id));
      let draftCount = library.drafts.length;
      const writes = {};
      let imported = 0;
      let skipped = 0;
      let rejected = 0;
      let entries = library.passages.length + library.notes.length;
      // Every passage that will exist once this import lands: the ones already
      // stored, plus the ones this payload actually writes. A quote is checked
      // against these, because `isValidDraft` alone lets a payload pair a real
      // passage id with fabricated text, url or title, and Return would then
      // resolve the id and bless the fabrication as found exactly.
      const passageById = new Map();
      for (const stored of library.passages) passageById.set(stored.id, stored);

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
        passageById.set(item.id, S.clonePassage(item));
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
      const importedAt = Date.now();
      for (const item of (Array.isArray(payload.drafts) ? payload.drafts : [])) {
        if (!S.isValidDraft(item)) { rejected += 1; continue; }
        if (existingDrafts.has(item.id)) { skipped += 1; continue; }
        if (draftCount >= LIMITS.DRAFTS_MAX) { rejected += 1; continue; }
        const draft = S.cloneDraft(item);
        let vouched = true;
        for (const block of draft.blocks) {
          if (block.type !== "quote") continue;
          const passage = passageById.get(block.passageId);
          if (!passage) {
            // A quote whose clip is not in the library is legitimate: the
            // reader may have deleted it. It keeps the text they saved, and is
            // recorded as having no way back, so nothing can later claim it
            // resolved and Return is not offered on it.
            block.checked = { quality: "missing", at: importedAt, reason: "clip-gone" };
            continue;
          }
          if (passage.text !== block.text || passage.url !== block.url || passage.title !== block.title) {
            vouched = false;
            break;
          }
        }
        if (!vouched || !S.isValidDraft(draft)) { rejected += 1; continue; }
        writes[draftKey(draft.id)] = draft;
        existingDrafts.add(draft.id);
        draftCount += 1;
        imported += 1;
      }
      const store = getLocalStore();
      if (!store) {
        reply(sendResponse, ERRORS.STORAGE_UNAVAILABLE);
        return;
      }
      const finish = () => reply(sendResponse, null, { imported, skipped, rejected, mode });

      // Replace used to clear the library and then write. A failed write left
      // the reader with nothing and an error naming storage. The new records go
      // in first; only once they are stored do the old ones go, so a failure
      // anywhere leaves the existing library intact.
      const retireOldRecords = () => {
        const prefixes = Object.values(KIND_PREFIXES);
        store.get(null, (all) => {
          if (chrome.runtime.lastError) { reply(sendResponse, ERRORS.GET_STORAGE); return; }
          const stale = Object.keys(all || {}).filter((key) => prefixes.some((prefix) => key.startsWith(prefix))
            && !Object.prototype.hasOwnProperty.call(writes, key));
          if (stale.length === 0) { finish(); return; }
          removeKeys(stale, (removeError) => reply(sendResponse, removeError, { imported, skipped, rejected, mode }));
        });
      };

      if (Object.keys(writes).length === 0) {
        // Replacing with an empty export is still a replacement.
        if (mode === "replace") { retireOldRecords(); return; }
        finish();
        return;
      }
      const writeAll = () => store.set(writes, () => {
        if (chrome.runtime.lastError) { reply(sendResponse, ERRORS.SAVE_STORAGE); return; }
        if (mode === "replace") { retireOldRecords(); return; }
        finish();
      });
      if (mode === "replace") {
        writeAll();
        return;
      }
      guardStorage((fullError) => {
        if (fullError) { reply(sendResponse, fullError); return; }
        writeAll();
      });
    };

    if (mode === "replace") {
      // An empty starting library, so nothing is treated as a duplicate and
      // every record in the payload is written afresh.
      proceed({ saved: [], passages: [], notes: [], pagemeta: [], drafts: [], keys: [] });
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

  // --- Incognito: a durable record must be attributable to a tab ---

  // A content script's sender carries `incognito` itself. An extension page has
  // no `sender.tab`, so it names a tab id and the worker resolves it. Only `id`
  // and `incognito` are ever read: without the `tabs` permission Chrome leaves
  // `url` and `title` undefined, and decision 14 forbids depending on them.
  function resolveTabPrivacy(tabId, callback) {
    const tabs = chrome.tabs;
    if (!S.isValidTabId(tabId) || !tabs || typeof tabs.get !== "function") {
      callback(ERRORS.INVALID_SENDER);
      return;
    }
    try {
      tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab || tab.incognito === true) {
          callback(ERRORS.INVALID_SENDER);
          return;
        }
        callback(null);
      });
    } catch (_) {
      callback(ERRORS.INVALID_SENDER);
    }
  }

  // For a write that stores something read from a page. The incognito check
  // inside these handlers was reachable only from a content script, and the
  // side panel's own Save selection sends from an extension page, so the
  // product's primary save path was never checked at all. A named tab is
  // required here: a record about a page with no tab cannot be shown to be
  // outside an incognito window.
  function guardPageWrite(handler) {
    return (msg, sender, sendResponse) => {
      if (isContentSender(sender)) {
        if (sender.tab.incognito === true) {
          reply(sendResponse, ERRORS.INVALID_SENDER);
          return;
        }
        handler(msg, sender, sendResponse);
        return;
      }
      resolveTabPrivacy(msg && msg.tabId, (error) => {
        if (error) {
          reply(sendResponse, error);
          return;
        }
        handler(msg, sender, sendResponse);
      });
    };
  }

  // Tags are written by the reader, not read from a page, and the library view
  // tags pages that are open in no tab at all, so a tab id is optional. When
  // one is named it is still resolved and refused.
  function guardTagWrite(handler) {
    return (msg, sender, sendResponse) => {
      if (isContentSender(sender) && sender.tab.incognito === true) {
        reply(sendResponse, ERRORS.INVALID_SENDER);
        return;
      }
      if (msg && msg.tabId !== undefined) {
        resolveTabPrivacy(msg.tabId, (error) => {
          if (error) {
            reply(sendResponse, error);
            return;
          }
          handler(msg, sender, sendResponse);
        });
        return;
      }
      handler(msg, sender, sendResponse);
    };
  }

  // --- Context menu: save the current selection from any page ---

  const MENU_ID = "readtrail-save-selection";

  // Set by the worker so a context-menu clip also teaches Return which tab is
  // showing which URL.
  let onPassageSaved = null;
  function setPassageSavedHook(hook) {
    onPassageSaved = typeof hook === "function" ? hook : null;
  }

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
        if (typeof onPassageSaved === "function" && tab.incognito !== true) {
          onPassageSaved(tab.id, captured.url);
        }
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
    setPassageSavedHook,
    readLibrary,
    draftKey,
    passageKey,
    handlers: {
      savePassage: guardPageWrite(handleSavePassage),
      updatePassage: handleUpdatePassage,
      removePassage: handleRemovePassage,
      listPassages: handleListPassages,
      saveNote: guardPageWrite(handleSaveNote),
      updateNote: handleUpdateNote,
      removeNote: handleRemoveNote,
      listNotes: handleListNotes,
      setPageTags: guardTagWrite(handleSetPageTags),
      listLibrary: handleListLibrary,
      clearLibrary: handleClearLibrary,
      saveDraft: handleSaveDraft,
      updateDraft: handleUpdateDraft,
      removeDraft: handleRemoveDraft,
      listDrafts: handleListDrafts,
      appendQuote: handleAppendQuote,
      exportLibrary: handleExportLibrary,
      importLibrary: handleImportLibrary
    }
  };
})();
