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
  const UNDO_WINDOW_MS = 12000;
  const STATUS_LIFETIME_MS = 9000;

  let els = null;
  let drafts = [];
  let current = null;      // the open draft, or null
  let saveTimer = null;
  let dirty = false;
  let activeSave = null;
  let saveQueue = [];
  let saveWaiters = [];
  let failedSaveIds = new Set();
  let pendingFocus = null; // { index, control } restored after a re-render
  let removed = null;      // { block, index } while the undo offer stands
  let undoTimer = null;
  let reloadTimer = null;
  let statusTimer = null;
  // A verdict is evidence about one press on one block. The same clip can be
  // quoted more than once, so a verdict cannot be keyed by its passage: doing
  // that put an answer on a quote nobody checked, which asserts a fact the
  // product was never told. Nor by position, which shifts under every edit.
  // Each block carries a key that travels with it instead, held outside the
  // record so nothing new is persisted.
  let verdicts = new Map();
  let blockKeys = [];
  let keySeed = 0;

  function newBlockKey() {
    keySeed += 1;
    return `b${keySeed}`;
  }

  // Called whenever the block list is adopted wholesale. `keep` preserves the
  // keys of the blocks that carried over, by position.
  function resetBlockKeys(length, keep = []) {
    blockKeys = [];
    for (let i = 0; i < length; i += 1) blockKeys.push(keep[i] || newBlockKey());
  }

  function verdictKey(index) {
    return blockKeys[index];
  }
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

  function hostOf(url) {
    try {
      return new URL(url).hostname || "";
    } catch (_) {
      return "";
    }
  }

  function setStatus(message, role) {
    if (!els) return;
    if (statusTimer !== null) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    if (message && role !== "alert") {
      statusTimer = setTimeout(() => {
        statusTimer = null;
        if (els && els.status.getAttribute("role") !== "alert") {
          els.status.textContent = "";
          els.status.hidden = true;
        }
      }, STATUS_LIFETIME_MS);
    }
    els.status.textContent = message || "";
    els.status.setAttribute("role", role || "status");
    els.status.hidden = !message;
  }

  function setSaveState(text) {
    if (!els) return;
    els.saveState.textContent = text || "";
  }

  // --- Loading ---

  // Storage changes arrive in bursts; a replace-mode import rewrites every
  // draft at once.
  function scheduleReload() {
    if (reloadTimer !== null) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      load();
    }, 150);
  }

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

  function openDraft(id, options = {}) {
    flushSave();
    stashCurrent();
    clearVerdicts();
    const draft = drafts.find((d) => d.id === id);
    if (!draft) {
      // A deep link can name a draft made after this tab loaded. Read through
      // to storage once before concluding it is gone.
      if (!options.reloaded) {
        load(() => openDraft(id, { ...options, reloaded: true }));
        return;
      }
      current = null;
      renderIndex();
      renderEditor();
      setStatus("That draft no longer exists. Choose one from the list, or start a new question.", "alert");
      return;
    }
    current = JSON.parse(JSON.stringify(draft));
    resetBlockKeys(current.blocks.length);
    dirty = false;
    setSaveState("");
    setStatus("", "status");
    renderIndex();
    renderEditor();
    if (els && !options.silent) els.title.focus();
    if (!options.silent && typeof navigationHandler === "function") navigationHandler(current.id);
  }

  function closeDraft(options = {}) {
    flushSave();
    stashCurrent();
    current = null;
    renderIndex();
    renderEditor();
    if (!options.silent && typeof navigationHandler === "function") navigationHandler(null);
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

  function flushSave(callback) {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (dirty) commit();
    if (typeof callback !== "function") return;
    if (!activeSave && saveQueue.length === 0) callback(true);
    else saveWaiters.push({ draftId: current ? current.id : null, callback });
  }

  function commit() {
    if (!current || !dirty) return;
    const snapshot = JSON.parse(JSON.stringify({ id: current.id, title: current.title, tags: current.tags, blocks: current.blocks }));
    dirty = false;
    const queuedIndex = saveQueue.findIndex((job) => job.id === snapshot.id);
    if (queuedIndex >= 0) saveQueue[queuedIndex] = snapshot;
    else saveQueue.push(snapshot);
    processSaveQueue();
  }

  function stashCurrent() {
    if (!current) return;
    const index = drafts.findIndex((draft) => draft.id === current.id);
    if (index >= 0) drafts[index] = JSON.parse(JSON.stringify(current));
  }

  function processSaveQueue() {
    if (activeSave || saveQueue.length === 0) return;
    const snapshot = saveQueue.shift();
    activeSave = snapshot;
    sendMessage({ type: "updateDraft", ...snapshot }, (res) => {
      activeSave = null;
      if (res && res.ok && res.draft) {
        const hasNewer = saveQueue.some((job) => job.id === snapshot.id)
          || (current && current.id === snapshot.id && dirty);
        const index = drafts.findIndex((draft) => draft.id === res.draft.id);
        if (!hasNewer) {
          if (index >= 0) drafts[index] = res.draft;
          else drafts.unshift(res.draft);
        }
        if (current && current.id === res.draft.id) {
          current.updatedAt = res.draft.updatedAt;
          if (!dirty && !saveQueue.some((job) => job.id === current.id)) setSaveState("Saved");
        }
        renderIndex();
      } else {
        failedSaveIds.add(snapshot.id);
        if (current && current.id === snapshot.id) dirty = true;
        setSaveState("Not saved");
        setStatus(saveErrorText(res), "alert");
      }
      if (saveQueue.length > 0) {
        processSaveQueue();
        return;
      }
      const waiters = saveWaiters;
      saveWaiters = [];
      for (const waiter of waiters) waiter.callback(!failedSaveIds.has(waiter.draftId));
      failedSaveIds = new Set();
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

  // The reason to keep the outcomes: a reader can see how much of their
  // argument still stands before they send it anywhere.
  function renderSummary() {
    if (!els || !els.summary) return;
    const quotes = current ? current.blocks.filter((b) => b.type === "quote") : [];
    const checked = quotes.filter((b) => b.checked);
    if (checked.length === 0) {
      els.summary.hidden = true;
      els.summary.textContent = "";
      return;
    }
    const held = checked.filter((b) => b.checked.quality === "exact").length;
    const byWording = checked.filter((b) => b.checked.quality === "approximate").length;
    const lost = checked.filter((b) => b.checked.quality === "missing").length;
    const unchecked = quotes.length - checked.length;

    // Say what was actually checked. Counting checked quotes against every
    // quote reported on ones nobody examined, and hid the approximate ones in
    // neither number.
    const parts = [];
    if (held > 0) parts.push(`${held} found exactly`);
    if (byWording > 0) parts.push(`${byWording} found by wording`);
    if (lost > 0) parts.push(`${lost} not found`);
    const noun = quotes.length === 1 ? "quote" : "quotes";
    let text = `${checked.length} of ${quotes.length} ${noun} checked: ${parts.join(", ")}.`;
    if (unchecked > 0) text += ` ${unchecked} not checked yet.`;
    els.summary.textContent = text;
    // Gold is what the reader kept, so it is only right when everything the
    // reader checked still holds and nothing is outstanding.
    els.summary.dataset.state = (lost === 0 && byWording === 0 && unchecked === 0) ? "held" : "mixed";
    els.summary.hidden = false;
  }

  function renderBlocks() {
    els.blocks.textContent = "";
    const frag = document.createDocumentFragment();
    current.blocks.forEach((block, index) => {
      frag.appendChild(block.type === "quote" ? quoteBlockNode(block, index) : textBlockNode(block, index));
    });
    els.blocks.appendChild(frag);
    renderSummary();
    restoreFocus();
  }

  function restoreFocus() {
    if (!pendingFocus) return;
    const { index, control } = pendingFocus;
    pendingFocus = null;
    const item = els.blocks.children[index];
    if (!item) return;
    // The whole list was rebuilt; mark just this one so the reader can see
    // which block moved or arrived.
    item.classList.add("just-changed");
    const target = control ? item.querySelector(control) : item.querySelector("textarea, button");
    if (target && typeof target.focus === "function") target.focus();
  }

  function blockLabel(block, index) {
    const position = `Block ${index + 1} of ${current.blocks.length}`;
    return block.type === "quote" ? `${position}, quote from ${block.title || hostOf(block.url)}` : `${position}, your text`;
  }

  function bindBlockKeys(node, index) {
    node.addEventListener("keydown", (event) => {
      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      event.preventDefault();
      moveBlock(index, event.key === "ArrowUp" ? -1 : 1, true);
    });
  }

  function blockActions(block, index) {
    const actions = document.createElement("div");
    actions.className = "block-actions";

    // Without a per-block name a screen reader hears "Move up, button" once
    // per block with nothing telling them apart.
    const position = `block ${index + 1} of ${current.blocks.length}`;

    const up = document.createElement("button");
    up.type = "button";
    up.className = "btn-ghost btn-small btn-move-up";
    up.textContent = "Move up";
    up.setAttribute("aria-label", `Move ${position} up`);
    up.disabled = index === 0;
    up.addEventListener("click", () => moveBlock(index, -1));

    const down = document.createElement("button");
    down.type = "button";
    down.className = "btn-ghost btn-small btn-move-down";
    down.textContent = "Move down";
    down.setAttribute("aria-label", `Move ${position} down`);
    down.disabled = index === current.blocks.length - 1;
    down.addEventListener("click", () => moveBlock(index, 1));

    const insert = document.createElement("button");
    insert.type = "button";
    insert.className = "btn-ghost btn-small btn-insert-below";
    insert.textContent = "Insert text below";
    insert.setAttribute("aria-label", `Insert a text block below ${position}`);
    insert.addEventListener("click", () => insertTextBlock(index + 1));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn-danger btn-small btn-remove-block";
    remove.textContent = block.type === "quote" ? "Remove quote" : "Remove block";
    remove.setAttribute("aria-label", block.type === "quote"
      ? `Remove the quote in ${position}`
      : `Remove ${position}`);
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
    const semanticHeading = document.createElement("h3");
    semanticHeading.className = "visually-hidden draft-semantic-heading";
    const syncHeading = () => {
      const heading = area.value.startsWith("# ");
      area.classList.toggle("heading-block-text", heading);
      area.setAttribute("aria-label", `${blockLabel(current.blocks[index], index)}${heading ? ", heading" : ""}`);
      semanticHeading.hidden = !heading;
      semanticHeading.textContent = heading ? (area.value.split("\n")[0].slice(2).trim() || "Untitled heading") : "";
    };
    // The only accelerators on this surface. Placing a quote used to mean
    // pressing "Move up" once per position with the mouse.
    area.addEventListener("keydown", (event) => {
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        moveBlock(index, event.key === "ArrowUp" ? -1 : 1, true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        insertTextBlock(index + 1);
      }
    });
    area.addEventListener("input", () => {
      current.blocks[index].text = area.value;
      syncHeading();
      scheduleSave();
    });
    syncHeading();
    li.appendChild(semanticHeading);
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
    cite.textContent = block.title || hostOf(block.url);
    if (block.title && hostOf(block.url)) {
      const host = document.createElement("span");
      host.className = "quote-cite-host";
      host.textContent = ` · ${hostOf(block.url)}`;
      cite.appendChild(host);
    }
    li.appendChild(cite);

    // Return's answer belongs on the quote it is about, not in a line above
    // the whole document where it is off-screen in any real draft.
    const verdict = document.createElement("p");
    verdict.className = "quote-verdict";
    verdict.id = `verdict-${block.passageId}-${index}`;
    verdict.setAttribute("role", "status");
    verdict.tabIndex = -1;
    const remembered = verdicts.get(verdictKey(index));
    if (remembered) {
      verdict.textContent = revealText(remembered.quality, remembered.opened);
      verdict.dataset.quality = remembered.quality;
      verdict.hidden = false;
    } else if (block.checked) {
      verdict.textContent = rememberedText(block.checked);
      verdict.dataset.quality = block.checked.quality;
      verdict.hidden = false;
    } else {
      verdict.hidden = true;
    }
    li.appendChild(verdict);

    const row = document.createElement("div");
    row.className = "quote-actions";

    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn-small btn-return";
    back.textContent = "Return";
    back.addEventListener("click", () => returnToClip(block, index, back, verdict));
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
    // A quote block has no textarea, so without this the only block class that
    // always lands at the end had no keyboard move.
    bindBlockKeys(li, index);
    return li;
  }

  // Return says exactly what happened. An anchor that resolves is not enough:
  // the worker and content script compare the text before claiming "exactly".
  function showVerdict(verdict, text, quality) {
    verdict.textContent = text;
    verdict.dataset.quality = quality;
    verdict.hidden = false;
    if (typeof verdict.focus === "function") verdict.focus();
  }

  function returnToClip(block, index, button, verdict) {
    button.disabled = true;
    showVerdict(verdict, "Looking for the passage…", "checking");
    sendMessage({ type: "revealPassage", id: block.passageId }, (res) => {
      button.disabled = false;
      if (!res || !res.ok) {
        verdicts.delete(verdictKey(index));
        showVerdict(verdict, res && res.error === "not-found"
          ? "That clip is no longer in your library. This quote keeps the text you saved."
          : "ReadTrail could not open that page. Please try again.", "missing");
        return;
      }
      verdicts.set(verdictKey(index), { quality: res.quality, opened: Boolean(res.opened) });
      // Persist what was found, so the draft can still say which quotes held
      // after the tab is closed. The tab clause is deliberately not stored: it
      // describes this moment, not the quote.
      if (current && current.blocks[index] && current.blocks[index].type === "quote") {
        current.blocks[index].checked = { quality: res.quality, at: Date.now() };
        scheduleSave();
        renderSummary();
      }
      showVerdict(verdict, revealText(res.quality, res.opened), res.quality);
    });
  }

  // Return answers about one particular tab. When it had to open a fresh one,
  // the reader is still looking at the tab they came from, where nothing moved,
  // so a bare "found it" would be a true sentence about the wrong window.
  // How long ago, in the words a person would use.
  function agoText(at) {
    const ms = Date.now() - at;
    if (!Number.isFinite(ms) || ms < 0) return "earlier";
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return minutes === 1 ? "a minute ago" : `${minutes} minutes ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? "yesterday" : `${days} days ago`;
  }

  // A remembered outcome describes the quote, not the tab it was found in, so
  // it never repeats the clause about which window was open.
  function rememberedText(checked) {
    const when = agoText(checked.at);
    if (checked.quality === "exact") return `Found exactly when you last checked, ${when}.`;
    if (checked.quality === "approximate") return `Found by its wording when you last checked, ${when}. The page had changed.`;
    return `Not found when you last checked, ${when}. This quote keeps the text you saved.`;
  }

  function revealText(quality, opened) {
    if (opened) {
      if (quality === "exact") return "Opened the page in a new tab and found the passage there.";
      if (quality === "approximate") return "Opened the page in a new tab and found it by its wording. The page has changed since you saved this.";
      return "Opened the page in a new tab and could not find the passage. The page may have changed. This quote keeps the text you saved.";
    }
    if (quality === "exact") return "Found exactly, in the tab you already had open.";
    if (quality === "approximate") return "Found by its wording in the tab you had open. The page has changed since you saved this.";
    return "Not found in the tab you had open. The page may have changed. This quote keeps the text you saved.";
  }

  // A draft the reader opens fresh should not show verdicts from the last one.
  function clearVerdicts() {
    verdicts = new Map();
  }

  // --- Block operations ---

  function moveBlock(index, delta, movedByKeyboard = false) {
    const target = index + delta;
    if (target < 0 || target >= current.blocks.length) return;
    const [movedKey] = blockKeys.splice(index, 1);
    blockKeys.splice(target, 0, movedKey);
    const [block] = current.blocks.splice(index, 1);
    current.blocks.splice(target, 0, block);
    // The control for repeating the same move is disabled at an edge, so put
    // focus on the enabled inverse control after the block is rebuilt.
    pendingFocus = { index: target, control: movedByKeyboard ? "textarea" : (delta < 0 ? ".btn-move-down" : ".btn-move-up") };
    renderBlocks();
    announce(`Moved to position ${target + 1} of ${current.blocks.length}.`);
    scheduleSave();
  }

  function appendTextBlock() {
    if (!current) return;
    insertTextBlock(current.blocks.length);
  }

  function insertTextBlock(index) {
    if (current.blocks.length >= LIMITS.DRAFT_BLOCKS_MAX) {
      setStatus("This draft has as many blocks as it can hold.", "alert");
      return;
    }
    current.blocks.splice(index, 0, { type: "text", text: "" });
    blockKeys.splice(index, 0, newBlockKey());
    pendingFocus = { index, control: "textarea" };
    renderBlocks();
    scheduleSave();
  }

  function removeBlock(index) {
    const block = current.blocks[index];
    const [removedKey] = blockKeys.splice(index, 1);
    verdicts.delete(removedKey);
    current.blocks.splice(index, 1);
    if (current.blocks.length === 0) {
      current.blocks.push({ type: "text", text: "" });
      blockKeys.push(newBlockKey());
    }
    pendingFocus = { index: Math.max(0, index - 1), control: null };
    renderBlocks();
    const note = block && block.type === "quote"
      ? "Quote removed from this draft. The clip it came from is still in your library."
      : "Block removed.";
    announce(note);
    offerUndo(block, index, note);
    scheduleSave();
  }

  // A removal is the only destructive action in the editor and it autosaves
  // within 400ms, so the way back has to be offered immediately and has to be
  // visible: the live region alone tells a sighted reader nothing.
  function offerUndo(block, index, note) {
    if (!block || !els) return;
    removed = { block, index };
    if (undoTimer !== null) clearTimeout(undoTimer);
    setStatus(note, "status");
    els.undo.hidden = false;
    // Put the way back where the block was, not at the top of a document the
    // reader may be a thousand pixels down.
    const at = Math.min(index, els.blocks.children.length - 1);
    const neighbour = els.blocks.children[at];
    if (neighbour && neighbour.parentNode) {
      neighbour.parentNode.insertBefore(els.undo, neighbour);
    }
    els.undo.focus();
    undoTimer = setTimeout(() => {
      undoTimer = null;
      removed = null;
      retireUndo();
    }, UNDO_WINDOW_MS);
  }

  function retireUndo() {
    if (!els || !els.undo) return;
    els.undo.hidden = true;
    if (els.undoHome && els.undo.parentNode !== els.undoHome) els.undoHome.appendChild(els.undo);
  }

  function undoRemove() {
    if (!removed || !current) return;
    const { block, index } = removed;
    removed = null;
    if (undoTimer !== null) {
      clearTimeout(undoTimer);
      undoTimer = null;
    }
    retireUndo();
    const at = Math.min(index, current.blocks.length);
    // Removing the last block inserts an empty one to write in; drop it again
    // rather than leaving a stray blank above the restored block.
    if (current.blocks.length === 1 && current.blocks[0].type === "text" && current.blocks[0].text === "") {
      current.blocks = [];
      blockKeys = [];
    }
    current.blocks.splice(at, 0, block);
    blockKeys.splice(at, 0, newBlockKey());
    pendingFocus = { index: at, control: null };
    renderBlocks();
    setStatus("Block restored.", "status");
    announce("Block restored.");
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
    const draftId = current.id;
    flushSave((saved) => {
      if (!saved) {
        if (callback) callback(false);
        return;
      }
      sendMessage({ type: "appendQuote", draftId, passageId }, (res) => {
        if (!res || !res.ok || !res.draft) {
          setStatus(saveErrorText(res), "alert");
          if (callback) callback(false);
          return;
        }
        const index = drafts.findIndex((d) => d.id === res.draft.id);
        if (index >= 0) drafts[index] = res.draft;
        if (current && current.id === draftId) {
          const carried = blockKeys.slice(0, current ? current.blocks.length : 0);
          current = JSON.parse(JSON.stringify(res.draft));
          resetBlockKeys(current.blocks.length, carried);
          dirty = false;
          pendingFocus = { index: current.blocks.length - 1, control: ".btn-return" };
          setSaveState("Saved");
          setStatus(`Quoted into "${current.title}".`, "status");
          renderBlocks();
        }
        renderIndex();
        if (callback) callback(true);
      });
    });
  }

  function currentDraft() {
    return current ? { id: current.id, title: current.title } : null;
  }

  // --- Init ---

  function setNavigationHandler(handler) {
    navigationHandler = typeof handler === "function" ? handler : null;
  }

  function init(callback) {
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
      close: $("closeDraftButton"),
      append: $("draftAppend"),
      summary: $("draftSummary"),
      undo: $("draftUndo"),
      undoHome: $("draftUndo") ? $("draftUndo").parentNode : null
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
    els.append.addEventListener("click", appendTextBlock);
    els.undo.addEventListener("click", undoRemove);
    window.addEventListener("pagehide", flushSave);

    load(callback);
  }

  NS.draftView = { init, load, scheduleReload, openDraft, quoteInto, currentDraft, flushSave, closeDraft, setNavigationHandler };
})();
