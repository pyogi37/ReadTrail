// Drafts: the reader's own writing, and the only object that spans sources.
// A draft is a list of blocks; a text block is the reader's words, a quote
// block is a reference to a clip they saved plus a snapshot of its text.
//
// Structural changes (move, insert, remove) re-render the block list and then
// put focus back where the reader left it. Typing never re-renders, so a
// textarea is never rebuilt under the cursor.
(() => {
  "use strict";

  const NS = globalThis.ReadTrailSidePanel = globalThis.ReadTrailSidePanel || {};
  const shared = globalThis.ReadTrailShared || {};
  const LIMITS = shared.LIMITS || { TEXT_MAX: 4000, DRAFT_BLOCKS_MAX: 200, DRAFTS_MAX: 100 };
  const SAVE_DEBOUNCE_MS = 400;

  let els = null;
  let drafts = [];
  let current = null;      // the open draft, or null
  let saveTimer = null;
  let saving = false;
  let dirty = false;
  let pendingFocus = null; // { index, control } restored after a re-render

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

  function hostOf(url) {
    try {
      return new URL(url).hostname || "";
    } catch (_) {
      return "";
    }
  }

  function setStatus(message, role) {
    if (!els) return;
    els.status.textContent = message || "";
    els.status.setAttribute("role", role || "status");
    els.status.hidden = !message;
  }

  function setSaveState(text) {
    if (!els) return;
    els.saveState.textContent = text || "";
  }

  // --- Loading ---

  function load(callback) {
    sendMessage({ type: "listDrafts" }, (res) => {
      if (!res || !res.ok || !Array.isArray(res.drafts)) {
        setStatus("Your drafts could not be loaded. Reload this tab to try again.", "alert");
        if (callback) callback(false);
        return;
      }
      drafts = res.drafts;
      if (current) {
        const fresh = drafts.find((d) => d.id === current.id);
        // Keep the reader's in-progress edits; only adopt a record we do not
        // already have open.
        if (!fresh) current = null;
      }
      renderIndex();
      renderEditor();
      if (callback) callback(true);
    });
  }

  function openDraft(id) {
    const draft = drafts.find((d) => d.id === id);
    if (!draft) {
      current = null;
      renderIndex();
      renderEditor();
      return;
    }
    flushSave();
    current = JSON.parse(JSON.stringify(draft));
    dirty = false;
    setSaveState("");
    setStatus("", "status");
    renderIndex();
    renderEditor();
    if (els) els.title.focus();
  }

  function closeDraft() {
    flushSave();
    current = null;
    renderIndex();
    renderEditor();
  }

  // --- Saving ---

  function scheduleSave() {
    dirty = true;
    setSaveState("Saving…");
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      commit();
    }, SAVE_DEBOUNCE_MS);
  }

  function flushSave() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
      commit();
    }
  }

  function commit() {
    if (!current || saving || !dirty) return;
    saving = true;
    const snapshot = { id: current.id, title: current.title, tags: current.tags, blocks: current.blocks };
    sendMessage({ type: "updateDraft", ...snapshot }, (res) => {
      saving = false;
      if (res && res.ok && res.draft) {
        dirty = false;
        setSaveState("Saved");
        const index = drafts.findIndex((d) => d.id === res.draft.id);
        if (index >= 0) drafts[index] = res.draft;
        else drafts.unshift(res.draft);
        current.updatedAt = res.draft.updatedAt;
        renderIndex();
        return;
      }
      setSaveState("Not saved");
      setStatus(saveErrorText(res), "alert");
    });
  }

  function saveErrorText(res) {
    const code = res && res.error;
    if (code === "draft-full") return "This draft is full. Remove a block before adding more.";
    if (code === "storage-full") return "Your local storage is nearly full. Remove some clips or drafts first.";
    if (code === "invalid-input") return "That could not be saved. A draft needs a title, and each block is limited to 4,000 characters.";
    if (code === "not-found") return "This draft no longer exists.";
    return "That could not be saved. Please try again.";
  }

  // --- The drafts index ---

  function renderIndex() {
    if (!els) return;
    els.list.textContent = "";
    els.empty.hidden = drafts.length > 0;
    const frag = document.createDocumentFragment();
    for (const draft of drafts) {
      const li = document.createElement("li");
      li.className = "draft-row" + (current && current.id === draft.id ? " is-open" : "");
      li.dataset.id = draft.id;

      const open = document.createElement("button");
      open.type = "button";
      open.className = "draft-open";
      const title = document.createElement("span");
      title.className = "item-title";
      title.textContent = draft.title;
      const meta = document.createElement("span");
      meta.className = "item-meta";
      const quotes = draft.blocks.filter((b) => b.type === "quote").length;
      meta.textContent = quotes === 1 ? "1 quote" : `${quotes} quotes`;
      open.appendChild(title);
      open.appendChild(meta);
      open.addEventListener("click", () => openDraft(draft.id));
      li.appendChild(open);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn-danger btn-small btn-remove-draft";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => confirmRemoveDraft(li, draft));
      li.appendChild(remove);

      frag.appendChild(li);
    }
    els.list.appendChild(frag);
  }

  // An inline confirmation row, never a native dialog: the reader can read what
  // will happen and cancel with the keyboard.
  function confirmRemoveDraft(row, draft) {
    if (row.querySelector(".item-confirm")) return;
    const box = document.createElement("div");
    box.className = "item-confirm";
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-label", `Confirm removing ${draft.title}`);
    const text = document.createElement("span");
    text.className = "confirm-text";
    const quotes = draft.blocks.filter((b) => b.type === "quote").length;
    text.textContent = quotes > 0
      ? `Remove "${draft.title}"? Its ${quotes === 1 ? "quote goes" : "quotes go"} with it. The clips they came from stay.`
      : `Remove "${draft.title}"?`;
    const actions = document.createElement("div");
    actions.className = "confirm-actions";
    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "btn-danger-solid";
    yes.textContent = "Remove draft";
    yes.addEventListener("click", () => {
      sendMessage({ type: "removeDraft", id: draft.id }, (res) => {
        if (!res || !res.ok) {
          setStatus("That draft could not be removed. Please try again.", "alert");
          return;
        }
        if (current && current.id === draft.id) current = null;
        setStatus("Draft removed.", "status");
        load();
        renderEditor();
      });
    });
    const no = document.createElement("button");
    no.type = "button";
    no.className = "btn-ghost";
    no.textContent = "Cancel";
    no.addEventListener("click", () => {
      box.remove();
      const button = row.querySelector(".btn-remove-draft");
      if (button) button.focus();
    });
    actions.appendChild(yes);
    actions.appendChild(no);
    box.appendChild(text);
    box.appendChild(actions);
    row.appendChild(box);
    yes.focus();
  }

  function createDraft() {
    const title = (els.newTitle.value || "").trim();
    if (title.length === 0) {
      setStatus("Give the draft a title first. A question works well.", "alert");
      els.newTitle.focus();
      return;
    }
    if (drafts.length >= LIMITS.DRAFTS_MAX) {
      setStatus(`You have reached ${LIMITS.DRAFTS_MAX} drafts. Remove one before starting another.`, "alert");
      return;
    }
    els.newButton.disabled = true;
    sendMessage({ type: "saveDraft", title, blocks: [{ type: "text", text: "" }] }, (res) => {
      els.newButton.disabled = false;
      if (!res || !res.ok || !res.draft) {
        setStatus(saveErrorText(res), "alert");
        return;
      }
      els.newTitle.value = "";
      drafts.unshift(res.draft);
      setStatus("", "status");
      openDraft(res.draft.id);
    });
  }

  // --- The editor ---

  function renderEditor() {
    if (!els) return;
    const open = Boolean(current);
    els.editor.hidden = !open;
    els.editorEmpty.hidden = open;
    if (!open) return;
    els.title.value = current.title;
    els.tags.value = current.tags.join(", ");
    renderBlocks();
  }

  function renderBlocks() {
    els.blocks.textContent = "";
    const frag = document.createDocumentFragment();
    current.blocks.forEach((block, index) => {
      frag.appendChild(block.type === "quote" ? quoteBlockNode(block, index) : textBlockNode(block, index));
    });
    els.blocks.appendChild(frag);
    restoreFocus();
  }

  function restoreFocus() {
    if (!pendingFocus) return;
    const { index, control } = pendingFocus;
    pendingFocus = null;
    const item = els.blocks.children[index];
    if (!item) return;
    const target = control ? item.querySelector(control) : item.querySelector("textarea, button");
    if (target && typeof target.focus === "function") target.focus();
  }

  function blockLabel(block, index) {
    const position = `Block ${index + 1} of ${current.blocks.length}`;
    return block.type === "quote" ? `${position}, quote from ${block.title || hostOf(block.url)}` : `${position}, your text`;
  }

  function blockActions(block, index) {
    const actions = document.createElement("div");
    actions.className = "block-actions";

    const up = document.createElement("button");
    up.type = "button";
    up.className = "btn-ghost btn-small btn-move-up";
    up.textContent = "Move up";
    up.disabled = index === 0;
    up.addEventListener("click", () => moveBlock(index, -1));

    const down = document.createElement("button");
    down.type = "button";
    down.className = "btn-ghost btn-small btn-move-down";
    down.textContent = "Move down";
    down.disabled = index === current.blocks.length - 1;
    down.addEventListener("click", () => moveBlock(index, 1));

    const insert = document.createElement("button");
    insert.type = "button";
    insert.className = "btn-ghost btn-small btn-insert-below";
    insert.textContent = "Insert text below";
    insert.addEventListener("click", () => insertTextBlock(index + 1));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn-danger btn-small btn-remove-block";
    remove.textContent = block.type === "quote" ? "Remove quote" : "Remove block";
    remove.addEventListener("click", () => removeBlock(index));

    actions.appendChild(up);
    actions.appendChild(down);
    actions.appendChild(insert);
    actions.appendChild(remove);
    return actions;
  }

  function textBlockNode(block, index) {
    const li = document.createElement("li");
    li.className = "draft-block text-block";
    li.dataset.index = String(index);

    const area = document.createElement("textarea");
    area.className = "block-text";
    area.rows = 3;
    area.maxLength = LIMITS.TEXT_MAX;
    area.value = block.text;
    area.setAttribute("aria-label", blockLabel(block, index));
    area.placeholder = index === 0 ? "What do these sources tell you? Start a line with # for a heading." : "";
    area.addEventListener("input", () => {
      current.blocks[index].text = area.value;
      scheduleSave();
    });
    li.appendChild(area);
    li.appendChild(blockActions(block, index));
    return li;
  }

  function quoteBlockNode(block, index) {
    const li = document.createElement("li");
    li.className = "draft-block quote-block";
    li.dataset.index = String(index);
    li.dataset.passageId = block.passageId;
    li.setAttribute("aria-label", blockLabel(block, index));

    const quote = document.createElement("blockquote");
    quote.className = "passage-text";
    quote.textContent = block.text;
    li.appendChild(quote);

    const cite = document.createElement("p");
    cite.className = "quote-cite";
    cite.textContent = [block.title, hostOf(block.url)].filter(Boolean).join(" · ");
    li.appendChild(cite);

    const row = document.createElement("div");
    row.className = "quote-actions";

    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn-primary btn-small btn-return";
    back.textContent = "Return";
    back.addEventListener("click", () => returnToClip(block, back));
    row.appendChild(back);

    const open = document.createElement("button");
    open.type = "button";
    open.className = "btn-ghost btn-small btn-open-source";
    open.textContent = "Open page";
    open.addEventListener("click", () => {
      try {
        chrome.tabs.create({ url: block.url });
      } catch (_) {
        setStatus("That page could not be opened.", "alert");
      }
    });
    row.appendChild(open);
    li.appendChild(row);
    li.appendChild(blockActions(block, index));
    return li;
  }

  // Return says exactly what happened. An anchor that resolves is not enough:
  // the worker and content script compare the text before claiming "exactly".
  function returnToClip(block, button) {
    button.disabled = true;
    setStatus("Looking for the passage…", "status");
    sendMessage({ type: "revealPassage", id: block.passageId }, (res) => {
      button.disabled = false;
      if (!res || !res.ok) {
        setStatus(res && res.error === "not-found"
          ? "That clip is no longer in your library. The quote above keeps its text."
          : "ReadTrail could not open that page. Please try again.", "alert");
        focusStatus();
        return;
      }
      if (res.opened) {
        setStatus("Opened the page in a new tab and looked for the passage there.", "status");
        focusStatus();
        return;
      }
      setStatus(revealText(res.quality), res.quality === "missing" ? "alert" : "status");
      focusStatus();
    });
  }

  function revealText(quality) {
    if (quality === "exact") return "Found exactly. The passage is highlighted on the page.";
    if (quality === "approximate") return "Found by text. The page has changed since you saved this.";
    return "Not found. The page may have changed. Your saved text is above.";
  }

  function focusStatus() {
    if (els && els.status && typeof els.status.focus === "function") els.status.focus();
  }

  // --- Block operations ---

  function moveBlock(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= current.blocks.length) return;
    const [block] = current.blocks.splice(index, 1);
    current.blocks.splice(target, 0, block);
    pendingFocus = { index: target, control: delta < 0 ? ".btn-move-up" : ".btn-move-down" };
    renderBlocks();
    announce(`Moved to position ${target + 1} of ${current.blocks.length}.`);
    scheduleSave();
  }

  function insertTextBlock(index) {
    if (current.blocks.length >= LIMITS.DRAFT_BLOCKS_MAX) {
      setStatus("This draft has as many blocks as it can hold.", "alert");
      return;
    }
    current.blocks.splice(index, 0, { type: "text", text: "" });
    pendingFocus = { index, control: "textarea" };
    renderBlocks();
    scheduleSave();
  }

  function removeBlock(index) {
    const block = current.blocks[index];
    current.blocks.splice(index, 1);
    if (current.blocks.length === 0) current.blocks.push({ type: "text", text: "" });
    pendingFocus = { index: Math.max(0, index - 1), control: null };
    renderBlocks();
    announce(block && block.type === "quote"
      ? "Quote removed from this draft. The clip it came from is still in your library."
      : "Block removed.");
    scheduleSave();
  }

  function announce(message) {
    if (!els) return;
    els.live.textContent = message;
  }

  // --- Quoting a clip from the Sources pane ---

  function quoteInto(passageId, callback) {
    if (!current) {
      setStatus("Open a draft first, then quote a clip into it.", "alert");
      if (callback) callback(false);
      return;
    }
    flushSave();
    sendMessage({ type: "appendQuote", draftId: current.id, passageId }, (res) => {
      if (!res || !res.ok || !res.draft) {
        setStatus(saveErrorText(res), "alert");
        if (callback) callback(false);
        return;
      }
      current = JSON.parse(JSON.stringify(res.draft));
      dirty = false;
      const index = drafts.findIndex((d) => d.id === res.draft.id);
      if (index >= 0) drafts[index] = res.draft;
      pendingFocus = { index: current.blocks.length - 1, control: ".btn-return" };
      setSaveState("Saved");
      setStatus(`Quoted into "${current.title}".`, "status");
      renderIndex();
      renderBlocks();
      if (callback) callback(true);
    });
  }

  function currentDraft() {
    return current ? { id: current.id, title: current.title } : null;
  }

  // --- Init ---

  function init() {
    const $ = (id) => document.getElementById(id);
    els = {
      list: $("draftList"),
      empty: $("draftsEmpty"),
      newTitle: $("newDraftTitle"),
      newButton: $("newDraftButton"),
      newForm: $("newDraftForm"),
      editor: $("draftEditor"),
      editorEmpty: $("draftEditorEmpty"),
      title: $("draftTitle"),
      tags: $("draftTags"),
      blocks: $("draftBlocks"),
      status: $("draftStatus"),
      saveState: $("draftSaveState"),
      live: $("draftLive"),
      close: $("closeDraftButton")
    };
    if (!els.list) return;

    els.newForm.addEventListener("submit", (event) => {
      event.preventDefault();
      createDraft();
    });
    els.title.addEventListener("input", () => {
      if (!current) return;
      current.title = els.title.value;
      scheduleSave();
    });
    els.tags.addEventListener("input", () => {
      if (!current) return;
      current.tags = els.tags.value.split(",").map((value) => value.trim()).filter(Boolean);
      scheduleSave();
    });
    els.close.addEventListener("click", closeDraft);
    window.addEventListener("pagehide", flushSave);

    load();
  }

  NS.draftView = { init, load, openDraft, quoteInto, currentDraft, flushSave };
})();
