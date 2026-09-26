// Page-first library: saved places, passages, notes, page tags, search, export,
// and import. Everything durable goes through worker messages; this module
// keeps a local mirror and renders with textContent only.
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
  let viewMode = "pages";
  let selectedTag = "";
  let expandedPages = new Set();
  let expanded = new Set(); // item ids and page-tag editor keys
  let busy = new Set();
  let statusText = "";
  let statusRole = "status";
  let reloadTimer = null;
  let quoteHandler = null;
  let navigationHandler = null;

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
      if (NS.pageView && typeof NS.pageView.syncPageTags === "function") NS.pageView.syncPageTags();
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

  function pagesFromLibrary() {
    const byUrl = new Map();
    const ensure = (url, title = "") => {
      let page = byUrl.get(url);
      if (!page) {
        page = { url, title: title || domainFromUrl(url), saved: null, passages: [], notes: [], tags: [], updatedAt: 0 };
        byUrl.set(url, page);
      } else if (title && (!page.title || page.title === domainFromUrl(url))) {
        page.title = title;
      }
      return page;
    };
    for (const saved of library.saved) {
      const page = ensure(saved.url, saved.title);
      page.saved = saved;
      page.updatedAt = Math.max(page.updatedAt, saved.savedAt || 0);
    }
    for (const passage of library.passages) {
      const page = ensure(passage.url, passage.title);
      page.passages.push(passage);
      page.updatedAt = Math.max(page.updatedAt, passage.updatedAt || passage.createdAt || 0);
    }
    for (const note of library.notes) {
      const page = ensure(note.url, note.title);
      page.notes.push(note);
      page.updatedAt = Math.max(page.updatedAt, note.updatedAt || note.createdAt || 0);
    }
    for (const meta of library.pagemeta) {
      const page = ensure(meta.url);
      page.tags = [...meta.tags];
      page.updatedAt = Math.max(page.updatedAt, meta.updatedAt || 0);
    }
    return [...byUrl.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title));
  }

  // --- Rendering ---

  function render() {
    if (!els) return;
    const used = usedEntries();
    const pages = pagesFromLibrary();
    els.usage.textContent = `${used} of ${library.limit} passages and notes used`;
    els.usage.classList.toggle("is-full", used >= library.limit);
    els.clearSavedButton.disabled = library.saved.length === 0;
    els.clearButton.disabled = used === 0 && library.pagemeta.length === 0;

    const hasContent = pages.length > 0;
    els.empty.hidden = hasContent || viewMode === "tags" || query.trim().length > 0;
    els.pagesButton.classList.toggle("is-active", viewMode === "pages");
    els.tagsButton.classList.toggle("is-active", viewMode === "tags");
    els.pagesButton.setAttribute("aria-selected", String(viewMode === "pages"));
    els.tagsButton.setAttribute("aria-selected", String(viewMode === "tags"));
    els.pagesButton.tabIndex = viewMode === "pages" ? 0 : -1;
    els.tagsButton.tabIndex = viewMode === "tags" ? 0 : -1;

    if (query.trim().length > 0 && index) {
      renderSearch(pages);
      els.pageList.hidden = true;
      els.tagBrowser.hidden = true;
      els.searchResults.hidden = false;
      return;
    }
    els.searchResults.hidden = true;
    els.searchResults.textContent = "";
    if (viewMode === "tags") {
      els.pageList.hidden = true;
      els.tagBrowser.hidden = false;
      renderTags(pages);
      return;
    }
    els.tagBrowser.hidden = true;
    els.pageList.hidden = !hasContent;
    renderList(els.pageList, pages.map((page) => buildPageNode(page)));
  }

  function renderList(list, nodes) {
    list.textContent = "";
    const frag = document.createDocumentFragment();
    for (const node of nodes) frag.appendChild(node);
    list.appendChild(frag);
  }

  function renderSearch(pages) {
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
    const matchingUrls = [...new Set(results.map((result) => result.record.url))];
    const pagesByUrl = new Map(pages.map((page) => [page.url, page]));
    const frag = document.createDocumentFragment();
    for (const url of matchingUrls) {
      const page = pagesByUrl.get(url);
      if (page) frag.appendChild(buildPageNode(page, true));
    }
    els.searchResults.appendChild(frag);
  }

  function renderTags(pages) {
    els.tagBrowser.textContent = "";
    const counts = new Map();
    for (const page of pages) for (const tag of page.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    if (counts.size === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-text";
      empty.textContent = "No page tags yet. Add tags from the current-page controls.";
      els.tagBrowser.appendChild(empty);
      return;
    }
    const cloud = document.createElement("div");
    cloud.className = "tag-cloud";
    for (const [tag, count] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tag-filter" + (selectedTag === tag ? " is-active" : "");
      button.setAttribute("aria-pressed", String(selectedTag === tag));
      button.setAttribute("aria-label", `${tag}, ${count} ${count === 1 ? "page" : "pages"}`);
      button.textContent = `${tag} ${count}`;
      button.addEventListener("click", () => {
        selectedTag = selectedTag === tag ? "" : tag;
        render();
        notifyNavigation(selectedTag
          ? { view: "tags", tag: selectedTag, query: "" }
          : { view: "tags", tag: "", query: "" });
      });
      cloud.appendChild(button);
    }
    els.tagBrowser.appendChild(cloud);
    if (selectedTag) {
      const list = document.createElement("ul");
      list.className = "list page-list tag-page-list";
      list.setAttribute("aria-label", `Pages tagged ${selectedTag}`);
      renderList(list, pages.filter((page) => page.tags.includes(selectedTag)).map((page) => buildPageNode(page)));
      els.tagBrowser.appendChild(list);
    }
  }

  function chip(text) {
    const span = document.createElement("span");
    span.className = "tag-chip";
    span.textContent = text;
    return span;
  }

  function tagRow(item, kind) {
    const row = document.createElement("div");
    row.className = "tag-row";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "link-button btn-edit-tags";
    edit.textContent = kind === "passage" ? "Edit passage note" : "Edit note";
    edit.addEventListener("click", () => toggleExpanded(item.id));
    row.appendChild(edit);
    return row;
  }

  function editor(item, kind) {
    const form = document.createElement("form");
    form.className = "item-editor";
    form.hidden = !expanded.has(item.id);

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
      const message = kind === "passage"
        ? { type: "updatePassage", id: item.id, note: noteInput.value }
        : { type: "updateNote", id: item.id, text: noteInput.value };
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
        ? "That could not be saved. Notes are limited to 4,000 characters."
        : "That could not be saved. Please try again.", "alert");
      render();
    });
  }

  function actionRow(item, kind) {
    const actions = document.createElement("div");
    actions.className = "item-actions";
    if (kind === "passage" && quoteHandler) {
      const quote = document.createElement("button");
      quote.type = "button";
      quote.className = "btn-primary btn-small btn-quote";
      quote.textContent = "Quote";
      quote.addEventListener("click", () => {
        quote.disabled = true;
        quote.textContent = "Quoting…";
        quoteHandler(item, (ok) => {
          quote.disabled = false;
          if (!ok) {
            quote.textContent = "Quote";
            return;
          }
          // Confirm quietly, then return the control to the reader: the same
          // passage can belong in another draft.
          quote.textContent = "Quoted";
          quote.classList.add("is-done");
          setTimeout(() => {
            quote.classList.remove("is-done");
            quote.textContent = "Quote";
          }, 1800);
        });
      });
      actions.appendChild(quote);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn-danger btn-small btn-remove-item";
    remove.textContent = busy.has(item.id) ? "Removing…" : "Remove";
    remove.disabled = busy.has(item.id);
    remove.addEventListener("click", () => removeItem(item.id, kind));
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
    if (passage.note) {
      const note = document.createElement("p");
      note.className = "passage-note";
      note.textContent = passage.note;
      li.appendChild(note);
    }
    li.appendChild(tagRow(passage, "passage"));
    li.appendChild(editor(passage, "passage"));
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
    if (note.source === "ai") {
      const meta = document.createElement("span");
      meta.className = "item-meta";
      meta.textContent = "AI draft";
      li.appendChild(meta);
    }
    li.appendChild(tagRow(note, "note"));
    li.appendChild(editor(note, "note"));
    li.appendChild(actionRow(note, "note"));
    return li;
  }

  function pageActionRow(page) {
    const actions = document.createElement("div");
    actions.className = "item-actions page-actions-row";
    const open = document.createElement("button");
    open.type = "button";
    open.className = page.saved ? "btn-primary btn-small btn-continue-page" : "btn-ghost btn-small btn-open-page";
    open.textContent = page.saved ? "Continue reading" : "Open page";
    const busyKey = `page:${page.url}`;
    open.disabled = busy.has(busyKey);
    open.addEventListener("click", () => {
      if (busy.has(busyKey)) return;
      if (!page.saved) {
        try { chrome.tabs.create({ url: page.url }); } catch (_) { setStatus("Could not open the page.", "alert"); }
        return;
      }
      busy.add(busyKey);
      render();
      sendMessage({ type: "continueSavedResumePoint", url: page.url }, (res) => {
        busy.delete(busyKey);
        setStatus(res && res.ok ? "Opened your saved place in a new tab." : "Could not open that saved place.", res && res.ok ? "status" : "alert");
        render();
      });
    });
    actions.appendChild(open);

    if (page.saved) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn-danger btn-small btn-remove-saved-position";
      remove.textContent = "Remove saved place";
      remove.addEventListener("click", () => {
        if (!globalThis.confirm("Remove the saved reading position? Passages, notes, and page tags will stay.")) return;
        sendMessage({ type: "removeSavedResumePoint", url: page.url }, (res) => {
          if (res && res.ok) {
            setStatus("Saved reading position removed.", "status");
            load();
          } else {
            setStatus("Could not remove the saved reading position.", "alert");
          }
        });
      });
      actions.appendChild(remove);
    }
    return actions;
  }

  function pageTagsEditor(page) {
    const wrap = document.createElement("div");
    wrap.className = "page-tags-editor";
    const key = `tags:${page.url}`;
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "link-button btn-edit-page-tags";
    edit.textContent = page.tags.length ? "Edit page tags" : "Add page tags";
    edit.setAttribute("aria-expanded", String(expanded.has(key)));
    edit.addEventListener("click", () => toggleExpanded(key));
    wrap.appendChild(edit);

    const form = document.createElement("form");
    form.className = "inline-page-tags-form";
    form.hidden = !expanded.has(key);
    const label = document.createElement("label");
    label.textContent = "Page tags (comma separated)";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "page-card-tags-input";
    input.value = page.tags.join(", ");
    label.appendChild(input);
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "btn-primary btn-small";
    save.textContent = "Save tags";
    form.appendChild(label);
    form.appendChild(save);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const tags = input.value.split(",").map((value) => value.trim()).filter(Boolean);
      save.disabled = true;
      sendMessage({ type: "setPageTags", url: page.url, tags }, (res) => {
        if (res && res.ok) {
          expanded.delete(key);
          setStatus("Page tags saved.", "status");
          load();
        } else {
          save.disabled = false;
          setStatus(res && res.error === "invalid-input" ? "Use up to 20 tags of 40 characters each." : "Could not save page tags.", "alert");
        }
      });
    });
    wrap.appendChild(form);
    return wrap;
  }

  function buildPageNode(page, forceOpen = false) {
    const li = document.createElement("li");
    li.className = "page-card";
    li.dataset.url = page.url;
    const details = document.createElement("details");
    details.className = "page-details";
    details.open = forceOpen || expandedPages.has(page.url);
    details.addEventListener("toggle", () => {
      if (details.open) {
        expandedPages.add(page.url);
        body.classList.add("just-opened");
      } else {
        expandedPages.delete(page.url);
      }
    });

    const summary = document.createElement("summary");
    summary.className = "page-summary";
    const text = document.createElement("span");
    text.className = "page-summary-text";
    const title = document.createElement("span");
    title.className = "item-title";
    title.textContent = page.title || domainFromUrl(page.url);
    const meta = document.createElement("span");
    meta.className = "item-meta";
    const counts = [];
    if (page.saved) counts.push("saved place");
    if (page.passages.length) counts.push(`${page.passages.length} ${page.passages.length === 1 ? "passage" : "passages"}`);
    if (page.notes.length) counts.push(`${page.notes.length} ${page.notes.length === 1 ? "note" : "notes"}`);
    meta.textContent = [domainFromUrl(page.url), counts.join(" · ")].filter(Boolean).join(" · ");
    text.appendChild(title);
    text.appendChild(meta);
    summary.appendChild(text);
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "page-body";
    if (page.tags.length) {
      const tags = document.createElement("div");
      tags.className = "tag-row page-tag-row";
      for (const tag of page.tags) tags.appendChild(chip(tag));
      body.appendChild(tags);
    }
    body.appendChild(pageTagsEditor(page));
    body.appendChild(pageActionRow(page));
    if (page.passages.length) {
      const heading = document.createElement("h3");
      heading.className = "sub-heading";
      heading.textContent = "Passages";
      body.appendChild(heading);
      const list = document.createElement("ul");
      list.className = "list nested-list passage-group";
      renderList(list, page.passages.map((passage) => buildPassageNode(passage)));
      body.appendChild(list);
    }
    if (page.notes.length) {
      const heading = document.createElement("h3");
      heading.className = "sub-heading";
      heading.textContent = "Notes";
      body.appendChild(heading);
      const list = document.createElement("ul");
      list.className = "list nested-list note-group";
      renderList(list, page.notes.map((note) => buildNoteNode(note)));
      body.appendChild(list);
    }
    details.appendChild(body);
    li.appendChild(details);
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

  function setPageTagsForTab(tab, tags, callback) {
    if (!tab || !tab.url) {
      callback({ ok: false, error: "inactive" });
      return;
    }
    sendMessage({ type: "setPageTags", url: tab.url, tags }, (res) => {
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

  function onClearKnowledge() {
    const confirmed = globalThis.confirm("Clear all passages, notes, and page tags? Saved reading positions and settings will stay intact.");
    if (!confirmed) return;
    els.clearButton.disabled = true;
    sendMessage({ type: "clearLibrary", kinds: ["passages", "notes", "pagemeta"] }, (res) => {
      if (!res || !res.ok) {
        setStatus("Could not clear passages and notes. Please try again.", "alert");
        render();
        return;
      }
      setStatus("Passages, notes, and page tags cleared.", "status");
      load();
    });
  }

  function onClearSavedPlaces() {
    if (!library.saved.length) return;
    const confirmed = globalThis.confirm("Clear every saved reading position? Passages, notes, and page tags will stay.");
    if (!confirmed) return;
    els.clearSavedButton.disabled = true;
    sendMessage({ type: "clearSavedResumePoints" }, (res) => {
      if (!res || !res.ok) {
        setStatus("Could not clear saved reading positions. Please try again.", "alert");
        render();
        return;
      }
      setStatus("Saved reading positions cleared.", "status");
      load();
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

  function notifyNavigation(state) {
    if (typeof navigationHandler === "function") navigationHandler(state);
  }

  function navigate(state, options = {}) {
    const next = state || {};
    query = typeof next.query === "string" ? next.query : "";
    viewMode = next.view === "tags" ? "tags" : "pages";
    selectedTag = viewMode === "tags" && typeof next.tag === "string" ? next.tag : "";
    if (els) els.search.value = query;
    render();
    if (!options.silent) notifyNavigation({ view: viewMode, tag: selectedTag, query });
  }

  function setQuoteHandler(handler) {
    quoteHandler = typeof handler === "function" ? handler : null;
  }

  function setNavigationHandler(handler) {
    navigationHandler = typeof handler === "function" ? handler : null;
  }

  function init() {
    const $ = (id) => document.getElementById(id);
    els = {
      search: $("librarySearch"),
      searchResults: $("searchResults"),
      pagesButton: $("pagesViewButton"),
      tagsButton: $("tagsViewButton"),
      pageList: $("pageList"),
      tagBrowser: $("tagBrowser"),
      empty: $("knowledgeEmpty"),
      usage: $("libraryUsage"),
      status: $("knowledgeStatus"),
      exportButton: $("exportButton"),
      clearSavedButton: $("clearSavedPlacesButton"),
      clearButton: $("clearKnowledgeButton"),
      importInput: $("importInput"),
      importReplace: $("importReplace")
    };
    els.search.addEventListener("input", () => {
      query = els.search.value;
      render();
      notifyNavigation({ view: viewMode, tag: selectedTag, query });
    });
    const selectView = (mode, focus) => {
      viewMode = mode;
      if (mode === "pages") selectedTag = "";
      render();
      notifyNavigation({ view: viewMode, tag: selectedTag, query });
      if (focus) (mode === "pages" ? els.pagesButton : els.tagsButton).focus();
    };
    els.pagesButton.addEventListener("click", () => selectView("pages", false));
    els.tagsButton.addEventListener("click", () => selectView("tags", false));
    for (const button of [els.pagesButton, els.tagsButton]) {
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        selectView(viewMode === "pages" ? "tags" : "pages", true);
      });
    }
    els.exportButton.addEventListener("click", onExport);
    els.clearSavedButton.addEventListener("click", onClearSavedPlaces);
    els.clearButton.addEventListener("click", onClearKnowledge);
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
    pageTagsFor,
    savePassageFromTab,
    saveNoteForTab,
    setPageTagsForTab,
    getLibrary: () => library,
    navigate,
    setQuoteHandler,
    setNavigationHandler
  };
})();
