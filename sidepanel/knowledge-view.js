// Knowledge view: passages, notes, tags, search, connections, export and
// import. Everything durable goes through worker messages; this module keeps
// a local mirror, builds the search index in memory, and renders with
// textContent only.
(() => {
  "use strict";

  const NS = globalThis.ReadTrailSidePanel = globalThis.ReadTrailSidePanel || {};
  const shared = globalThis.ReadTrailShared || {};
  const LIMITS = shared.LIMITS || { TEXT_MAX: 4000, LIBRARY_MAX: 1500, IMPORT_MAX_BYTES: 8 * 1024 * 1024 };

  let els = null;
  let library = { saved: [], passages: [], notes: [], pagemeta: [], counts: { passages: 0, notes: 0, saved: 0 }, limit: LIMITS.LIBRARY_MAX };
  let records = [];
  let index = null;
  let query = "";
  let expanded = new Set(); // ids with the editor or connections open
  let busy = new Set();
  let statusText = "";
  let statusRole = "status";
  let reloadTimer = null;

  function sendMessage(message, callback) {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          callback(null);
          return;
        }
        callback(response);
      });
    } catch (_) {
      callback(null);
    }
  }

  function searchIndex() { return NS.searchIndex || null; }
  function connections() { return NS.connections || null; }
  function exportImport() { return NS.exportImport || null; }

  function domainFromUrl(url) {
    try {
      return new URL(url).hostname || "";
    } catch (_) {
      return "";
    }
  }

  function setStatus(message, role) {
    statusText = message || "";
    statusRole = role || "status";
    if (!els) return;
    els.status.textContent = statusText;
    els.status.setAttribute("role", statusRole);
    els.status.hidden = statusText.length === 0;
  }

  // --- Data ---

  function load(callback) {
    sendMessage({ type: "listLibrary" }, (res) => {
      if (!res || !res.ok) {
        setStatus("Your library could not be loaded. Close and reopen this panel to try again.", "alert");
        if (callback) callback(false);
        return;
      }
      library = {
        saved: Array.isArray(res.saved) ? res.saved : [],
        passages: Array.isArray(res.passages) ? res.passages : [],
        notes: Array.isArray(res.notes) ? res.notes : [],
        pagemeta: Array.isArray(res.pagemeta) ? res.pagemeta : [],
        counts: res.counts || { passages: 0, notes: 0, saved: 0 },
        limit: Number.isInteger(res.limit) ? res.limit : LIMITS.LIBRARY_MAX
      };
      const SI = searchIndex();
      records = SI ? SI.recordsFromLibrary(library) : [];
      index = SI ? SI.buildIndex(records) : null;
      render();
      if (callback) callback(true);
    });
  }

  // Storage changes arrive in bursts (a save touches several keys); coalesce.
  function scheduleReload() {
    if (reloadTimer !== null) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      load();
    }, 150);
  }

  function countsFor(url) {
    return {
      passages: library.passages.filter((p) => p.url === url).length,
      notes: library.notes.filter((n) => n.url === url).length
    };
  }

  function pageTagsFor(url) {
    const meta = library.pagemeta.find((m) => m.url === url);
    return meta ? meta.tags : [];
  }

  function usedEntries() {
    return library.passages.length + library.notes.length;
  }

  // --- Rendering ---

  function render() {
    if (!els) return;
    const used = usedEntries();
    els.usage.textContent = `${used} of ${library.limit} passages and notes used`;
    els.usage.classList.toggle("is-full", used >= library.limit);

    const hasContent = library.passages.length > 0 || library.notes.length > 0;
    els.empty.hidden = hasContent;
    els.searchWrap.hidden = !hasContent && library.saved.length === 0;

    if (query.trim().length > 0 && index) {
      renderSearch();
      els.passageList.hidden = true;
      els.noteList.hidden = true;
      els.passageHeading.hidden = true;
      els.noteHeading.hidden = true;
      els.searchResults.hidden = false;
      return;
    }
    els.searchResults.hidden = true;
    els.searchResults.textContent = "";
    els.passageHeading.hidden = library.passages.length === 0;
    els.passageList.hidden = library.passages.length === 0;
    els.noteHeading.hidden = library.notes.length === 0;
    els.noteList.hidden = library.notes.length === 0;
    renderList(els.passageList, library.passages.map((p) => buildPassageNode(p)));
    renderList(els.noteList, library.notes.map((n) => buildNoteNode(n)));
  }

  function renderList(list, nodes) {
    list.textContent = "";
    const frag = document.createDocumentFragment();
    for (const node of nodes) frag.appendChild(node);
    list.appendChild(frag);
  }

  function renderSearch() {
    const SI = searchIndex();
    const results = SI ? SI.search(index, query, 40) : [];
    els.searchResults.textContent = "";
    if (results.length === 0) {
      const p = document.createElement("p");
      p.className = "empty-text";
      p.textContent = "No matches in your library.";
      els.searchResults.appendChild(p);
      return;
    }
    const frag = document.createDocumentFragment();
    for (const result of results) {
      const record = result.record;
      if (record.kind === "passage") {
        const passage = library.passages.find((p) => p.id === record.id);
        if (passage) frag.appendChild(buildPassageNode(passage));
      } else if (record.kind === "note") {
        const note = library.notes.find((n) => n.id === record.id);
        if (note) frag.appendChild(buildNoteNode(note));
      } else if (record.kind === "saved") {
        frag.appendChild(buildSavedResultNode(record));
      }
    }
    els.searchResults.appendChild(frag);
  }

  function chip(text) {
    const span = document.createElement("span");
    span.className = "tag-chip";
    span.textContent = text;
    return span;
  }

  function metaLine(item) {
    const meta = document.createElement("span");
    meta.className = "item-meta";
    meta.textContent = [item.title, domainFromUrl(item.url)].filter(Boolean).join(" · ") || domainFromUrl(item.url);
    return meta;
  }

  function tagRow(item, kind) {
    const row = document.createElement("div");
    row.className = "tag-row";
    for (const tag of item.tags) row.appendChild(chip(tag));
    for (const tag of pageTagsFor(item.url)) {
      if (!item.tags.includes(tag)) {
        const c = chip(tag);
        c.classList.add("tag-chip-page");
        c.title = "Page tag";
        row.appendChild(c);
      }
    }
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "link-button btn-edit-tags";
    edit.textContent = item.tags.length ? "Edit tags" : "Add tags";
    edit.addEventListener("click", () => toggleExpanded(item.id));
    row.appendChild(edit);
    void kind;
    return row;
  }

  function editor(item, kind) {
    const form = document.createElement("form");
    form.className = "item-editor";
    form.hidden = !expanded.has(item.id);

    const tagsLabel = document.createElement("label");
    tagsLabel.textContent = "Tags (comma separated)";
    const tagsInput = document.createElement("input");
    tagsInput.type = "text";
    tagsInput.className = "tags-input";
    tagsInput.value = item.tags.join(", ");
    tagsLabel.appendChild(tagsInput);
    form.appendChild(tagsLabel);

    let noteInput = null;
    if (kind === "passage") {
      const noteLabel = document.createElement("label");
      noteLabel.textContent = "Note";
      noteInput = document.createElement("textarea");
      noteInput.className = "note-input";
      noteInput.rows = 3;
      noteInput.maxLength = LIMITS.TEXT_MAX;
      noteInput.value = item.note || "";
      noteLabel.appendChild(noteInput);
      form.appendChild(noteLabel);
    } else {
      const textLabel = document.createElement("label");
      textLabel.textContent = "Note";
      noteInput = document.createElement("textarea");
      noteInput.className = "note-input";
      noteInput.rows = 3;
      noteInput.maxLength = LIMITS.TEXT_MAX;
      noteInput.value = item.text || "";
      textLabel.appendChild(noteInput);
      form.appendChild(textLabel);
    }

    const actions = document.createElement("div");
    actions.className = "confirm-actions";
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "btn-primary btn-small";
    save.textContent = busy.has(item.id) ? "Saving…" : "Save";
    save.disabled = busy.has(item.id);
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn-ghost btn-small";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => {
      expanded.delete(item.id);
      render();
    });
    actions.appendChild(save);
    actions.appendChild(cancel);
    form.appendChild(actions);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const tags = tagsInput.value.split(",").map((t) => t.trim()).filter(Boolean);
      const message = kind === "passage"
        ? { type: "updatePassage", id: item.id, tags, note: noteInput.value }
        : { type: "updateNote", id: item.id, tags, text: noteInput.value };
      submitUpdate(item.id, message);
    });
    return form;
  }

  function submitUpdate(id, message) {
    if (busy.has(id)) return;
    busy.add(id);
    render();
    sendMessage(message, (res) => {
      busy.delete(id);
      if (res && res.ok) {
        expanded.delete(id);
        setStatus("Saved.", "status");
        load();
        return;
      }
      setStatus(res && res.error === "invalid-input"
        ? "That could not be saved. Notes are limited to 4,000 characters and 20 tags of 40 characters."
        : "That could not be saved. Please try again.", "alert");
      render();
    });
  }

  function connectionsBlock(item) {
    const C = connections();
    if (!C) return null;
    const related = C.connectionsFor(records, item.id, 5);
    const total = related.sameTag.length + related.sameDomain.length + related.backlinks.length;
    if (total === 0) return null;
    const details = document.createElement("details");
    details.className = "connections";
    const summary = document.createElement("summary");
    summary.textContent = `Related (${total})`;
    details.appendChild(summary);
    const groups = [
      ["Shared tags", related.sameTag],
      ["Same site", related.sameDomain],
      ["Linked", related.backlinks]
    ];
    for (const [label, entries] of groups) {
      if (entries.length === 0) continue;
      const heading = document.createElement("p");
      heading.className = "connections-heading";
      heading.textContent = label;
      details.appendChild(heading);
      const ul = document.createElement("ul");
      ul.className = "connections-list";
      for (const entry of entries) {
        const li = document.createElement("li");
        const record = entry.record;
        const text = record.kind === "saved" ? record.title : (record.text || record.title);
        li.textContent = (text || domainFromUrl(record.url)).slice(0, 120);
        if (Array.isArray(entry.via) && entry.via.length) {
          const via = document.createElement("span");
          via.className = "item-meta";
          via.textContent = ` · ${entry.via.join(", ")}`;
          li.appendChild(via);
        }
        ul.appendChild(li);
      }
      details.appendChild(ul);
    }
    return details;
  }

  function actionRow(item, kind) {
    const actions = document.createElement("div");
    actions.className = "item-actions";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "btn-ghost btn-small btn-open-page";
    open.textContent = "Open page";
    open.addEventListener("click", () => {
      try { chrome.tabs.create({ url: item.url }); } catch (_) { setStatus("Could not open the page.", "alert"); }
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn-danger btn-small btn-remove-item";
    remove.textContent = busy.has(item.id) ? "Removing…" : "Remove";
    remove.disabled = busy.has(item.id);
    remove.addEventListener("click", () => removeItem(item.id, kind));
    actions.appendChild(open);
    actions.appendChild(remove);
    return actions;
  }

  function removeItem(id, kind) {
    if (busy.has(id)) return;
    busy.add(id);
    render();
    sendMessage({ type: kind === "passage" ? "removePassage" : "removeNote", id }, (res) => {
      busy.delete(id);
      if (res && res.ok) {
        expanded.delete(id);
        load();
        return;
      }
      setStatus("Could not remove that item. Please try again.", "alert");
      render();
    });
  }

  function buildPassageNode(passage) {
    const li = document.createElement("li");
    li.className = "knowledge-item passage-item";
    li.dataset.id = passage.id;
    const quote = document.createElement("blockquote");
    quote.className = "passage-text";
    quote.textContent = passage.text;
    li.appendChild(quote);
    li.appendChild(metaLine(passage));
    if (passage.note) {
      const note = document.createElement("p");
      note.className = "passage-note";
      note.textContent = passage.note;
      li.appendChild(note);
    }
    li.appendChild(tagRow(passage, "passage"));
    li.appendChild(editor(passage, "passage"));
    const related = connectionsBlock(passage);
    if (related) li.appendChild(related);
    li.appendChild(actionRow(passage, "passage"));
    return li;
  }

  function buildNoteNode(note) {
    const li = document.createElement("li");
    li.className = "knowledge-item note-item";
    li.dataset.id = note.id;
    const text = document.createElement("p");
    text.className = "note-text";
    text.textContent = note.text;
    li.appendChild(text);
    const meta = metaLine(note);
    if (note.source === "ai") meta.textContent += " · AI draft";
    li.appendChild(meta);
    li.appendChild(tagRow(note, "note"));
    li.appendChild(editor(note, "note"));
    const related = connectionsBlock(note);
    if (related) li.appendChild(related);
    li.appendChild(actionRow(note, "note"));
    return li;
  }

  function buildSavedResultNode(record) {
    const li = document.createElement("li");
    li.className = "knowledge-item saved-result";
    const title = document.createElement("span");
    title.className = "item-title";
    title.textContent = record.title;
    const meta = document.createElement("span");
    meta.className = "item-meta";
    meta.textContent = `Saved page · ${domainFromUrl(record.url)}`;
    li.appendChild(title);
    li.appendChild(meta);
    return li;
  }

  function toggleExpanded(id) {
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    render();
  }

  // --- Page-level actions used by the page view ---

  // Saves the current selection of the tracked tab as a passage.
  function savePassageFromTab(tab, callback) {
    if (!tab || !Number.isInteger(tab.tabId) || !tab.url) {
      callback({ ok: false, error: "inactive" });
      return;
    }
    try {
      chrome.tabs.sendMessage(tab.tabId, { type: "capturePassage" }, (captured) => {
        if (chrome.runtime.lastError || !captured) {
          callback({ ok: false, error: "runtime-unavailable" });
          return;
        }
        if (!captured.ok) {
          callback(captured);
          return;
        }
        sendMessage({
          type: "savePassage",
          url: captured.url || tab.url,
          title: captured.title || tab.title || "",
          text: captured.text,
          start: captured.start,
          end: captured.end
        }, (res) => {
          if (res && res.ok) load();
          callback(res || { ok: false, error: "runtime-unavailable" });
        });
      });
    } catch (_) {
      callback({ ok: false, error: "runtime-unavailable" });
    }
  }

  function saveNoteForTab(tab, text, callback) {
    if (!tab || !tab.url) {
      callback({ ok: false, error: "inactive" });
      return;
    }
    sendMessage({ type: "saveNote", url: tab.url, title: tab.title || "", text }, (res) => {
      if (res && res.ok) load();
      callback(res || { ok: false, error: "runtime-unavailable" });
    });
  }

  // --- Export / import ---

  function onExport() {
    sendMessage({ type: "exportLibrary" }, (res) => {
      const EI = exportImport();
      if (!res || !res.ok || !EI) {
        setStatus("Export failed. Please try again.", "alert");
        return;
      }
      try {
        const name = EI.downloadPayload(res.payload, document);
        setStatus(`Exported ${name}. The file contains your saved pages, passages, and notes in plain text.`, "status");
      } catch (_) {
        setStatus("Export failed. Please try again.", "alert");
      }
    });
  }

  function onImportFile(file) {
    const EI = exportImport();
    if (!EI || !file) return;
    const mode = els.importReplace.checked ? "replace" : "merge";
    setStatus("Importing…", "status");
    EI.readPayloadFile(file, LIMITS.IMPORT_MAX_BYTES).then((payload) => {
      sendMessage({ type: "importLibrary", payload, mode }, (res) => {
        if (!res || !res.ok) {
          setStatus(res && res.error === "invalid-input"
            ? "That file is not a ReadTrail export."
            : "Import failed. Nothing was changed.", "alert");
          return;
        }
        setStatus(`Imported ${res.imported}, skipped ${res.skipped}, rejected ${res.rejected}.`, "status");
        load();
      });
    }).catch((error) => {
      const code = error && error.message;
      setStatus(code === "too-large" ? "That file is too large to import." : "That file could not be read as JSON.", "alert");
    }).finally(() => {
      els.importInput.value = "";
    });
  }

  // --- Init ---

  function init() {
    const $ = (id) => document.getElementById(id);
    els = {
      searchWrap: $("librarySearchWrap"),
      search: $("librarySearch"),
      searchResults: $("searchResults"),
      passageHeading: $("passageHeading"),
      passageList: $("passageList"),
      noteHeading: $("noteHeading"),
      noteList: $("noteList"),
      empty: $("knowledgeEmpty"),
      usage: $("libraryUsage"),
      status: $("knowledgeStatus"),
      exportButton: $("exportButton"),
      importInput: $("importInput"),
      importReplace: $("importReplace")
    };
    els.search.addEventListener("input", () => {
      query = els.search.value;
      render();
    });
    els.exportButton.addEventListener("click", onExport);
    els.importInput.addEventListener("change", () => {
      const file = els.importInput.files && els.importInput.files[0];
      if (file) onImportFile(file);
    });
    setStatus("", "status");
    load();
  }

  NS.knowledgeView = {
    init,
    reload: load,
    scheduleReload,
    countsFor,
    savePassageFromTab,
    saveNoteForTab,
    getLibrary: () => library
  };
})();
