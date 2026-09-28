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
  // The last snapshot of each draft that did not save. Kept per draft, because
  // a failure used to be recorded only while its draft was still on screen: the
  // reader could edit A, switch to B, watch A's save fail, and lose everything
  // A held on the next reload with nothing ever retried.
  let failedSnapshots = new Map();
  let pendingFocus = null; // { index, control } restored after a re-render
  let removed = null;      // { block, index } while the undo offer stands
  let undoTimer = null;
  let undoSlot = null;     // the list item the undo offer sits in
  // Which block's options are open, by its stable key. Held here and rendered
  // from state, because the block list is rebuilt on every move and anything
  // kept only in the DOM would be wiped by the next render.
  let openOptionsKey = null;
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

  function sameDraftContent(a, b) {
    return a.title === b.title
      && JSON.stringify(a.tags) === JSON.stringify(b.tags)
      && JSON.stringify(a.blocks) === JSON.stringify(b.blocks);
  }

  function load(callback) {
    sendMessage({ type: "listDrafts" }, (res) => {
      if (!res || !res.ok || !Array.isArray(res.drafts)) {
        setStatus("Your drafts could not be loaded. Reload this tab to try again.", "alert");
        if (callback) callback(false);
        return;
      }
      drafts = res.drafts;
      let rebuildEditor = true;
      if (current) {
        const fresh = drafts.find((d) => d.id === current.id);
        if (!fresh) {
          current = null;
        } else if (dirty || sameDraftContent(fresh, current)) {
          // Either this page is mid-edit, or the change that woke us is the
          // one we just wrote. Rebuilding here would take the caret out of the
          // block the reader is typing in.
          rebuildEditor = false;
        }
      }
      renderIndex();
      if (rebuildEditor) renderEditor();
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
      withdrawUndo();
      current = null;
      renderIndex();
      renderEditor();
      setStatus("That draft no longer exists. Choose one from the list, or start a new question.", "alert");
      return;
    }
    // An undo offer is about a block in the draft being left. Carried over, it
    // appeared in the next draft and restored the old draft's block into it.
    withdrawUndo();
    current = JSON.parse(JSON.stringify(draft));
    resetBlockKeys(current.blocks.length);
    openOptionsKey = null;
    dirty = false;
    setSaveState("");
    retryFailedSave(id);
    setStatus("", "status");
    renderIndex();
    renderEditor();
    if (els && !options.silent) els.title.focus();
    if (!options.silent && typeof navigationHandler === "function") navigationHandler(current.id);
  }

  function closeDraft(options = {}) {
    flushSave();
    stashCurrent();
    withdrawUndo();
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

  // Re-queues a snapshot that never reached storage. Called when the reader
  // comes back to that draft, so a retry follows their attention rather than
  // spinning in a loop against a storage error that is not going away.
  function retryFailedSave(id) {
    const snapshot = failedSnapshots.get(id);
    if (!snapshot) return;
    failedSnapshots.delete(id);
    const queuedIndex = saveQueue.findIndex((job) => job.id === id);
    if (queuedIndex >= 0) saveQueue[queuedIndex] = snapshot;
    else saveQueue.push(snapshot);
    setSaveState("Saving…");
    processSaveQueue();
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
        failedSnapshots.delete(res.draft.id);
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
        failedSnapshots.set(snapshot.id, snapshot);
        if (current && current.id === snapshot.id) {
          dirty = true;
          setSaveState("Not saved");
          setStatus(saveErrorText(res), "alert");
        } else {
          // Say which draft, because the reader is looking at another one and
          // "Not saved" about nothing visible is worse than silence.
          const name = snapshot.title || "that draft";
          setStatus(`${saveErrorText(res)} This was "${name}", which is still open in your drafts and not saved yet.`, "alert");
        }
        renderIndex();
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
      if (failedSnapshots.has(draft.id)) {
        meta.textContent += " · not saved";
        li.dataset.unsaved = "true";
      }
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
    box.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      box.remove();
      const button = row.querySelector(".btn-remove-draft");
      if (button) button.focus();
    });
    row.appendChild(box);
    // Focus the way out, as every other confirmation in this product does.
    no.focus();
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
    // A quote whose clip was deleted is not the same as one the page lost: the
    // first is the reader's own doing and cannot be retried.
    const unlinked = checked.filter((b) => b.checked.quality === "missing" && b.checked.reason === "clip-gone").length;
    const lost = checked.filter((b) => b.checked.quality === "missing" && b.checked.reason !== "clip-gone").length;
    const unchecked = quotes.length - checked.length;

    // Say what was actually checked. Counting checked quotes against every
    // quote reported on ones nobody examined, and hid the approximate ones in
    // neither number.
    const parts = [];
    if (held > 0) parts.push(`${held} found exactly`);
    if (byWording > 0) parts.push(`${byWording} found by wording`);
    if (lost > 0) parts.push(`${lost} not found`);
    if (unlinked > 0) parts.push(`${unlinked} no longer linked to a clip`);
    const noun = quotes.length === 1 ? "quote" : "quotes";
    let text = `${checked.length} of ${quotes.length} ${noun} checked: ${parts.join(", ")}.`;
    if (unchecked > 0) text += ` ${unchecked} not checked yet.`;
    els.summary.textContent = text;
    // Gold is what the reader kept, so it is only right when everything the
    // reader checked still holds and nothing is outstanding.
    els.summary.dataset.state = (lost === 0 && unlinked === 0 && byWording === 0 && unchecked === 0) ? "held" : "mixed";
    els.summary.hidden = false;
  }

  function renderBlocks() {
    els.blocks.textContent = "";
    const frag = document.createDocumentFragment();
    current.blocks.forEach((block, index) => {
      frag.appendChild(block.type === "quote" ? quoteBlockNode(block, index) : textBlockNode(block, index));
    });
    els.blocks.appendChild(frag);
    placeUndo();
    renderSummary();
    restoreFocus();
  }

  // The rendered block at a position. The list can also hold the undo slot, so
  // counting raw children put focus, and a Return answer, on the wrong block
  // whenever an undo was on offer above it.
  function blockNode(index) {
    if (!els || !els.blocks) return null;
    let seen = -1;
    for (const child of els.blocks.children) {
      if (!child.classList.contains("draft-block")) continue;
      seen += 1;
      if (seen === index) return child;
    }
    return null;
  }

  function restoreFocus() {
    if (!pendingFocus) return;
    const { index, control } = pendingFocus;
    pendingFocus = null;
    const item = blockNode(index);
    if (!item) return;
    // The whole list was rebuilt; mark just this one so the reader can see
    // which block moved or arrived.
    item.classList.add("just-changed");
    // A quote block has no textarea, so a keyboard move asked for one and found
    // nothing, and focus fell to the page. Fall back to the block's first
    // control rather than losing the reader's place.
    // The fallback prefers what the block is for: the writing area, then
    // Return. The citation link opens a page, so landing there by default
    // turned the next Enter into a new tab.
    const target = (control && item.querySelector(`${control}:not(:disabled)`))
      || item.querySelector("textarea")
      || item.querySelector(".btn-return:not(:disabled)")
      || item.querySelector("a[href], button:not(:disabled)");
    if (target && typeof target.focus === "function") target.focus();
  }

  // The control a keyboard move should come back to, so Alt+Up pressed on
  // Return leaves the reader on Return in the block's new place.
  const RETURNABLE = ["btn-return", "btn-open-source", "block-options-toggle",
    "btn-move-up", "btn-move-down", "btn-insert-below", "btn-remove-block"];
  function controlSelector(element) {
    if (!element || !element.classList) return null;
    const name = RETURNABLE.find((cls) => element.classList.contains(cls));
    return name ? `.${name}` : null;
  }

  const ON_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
  function shortcutLabel(kind) {
    if (kind === "up") return "Alt ↑";
    if (kind === "down") return "Alt ↓";
    return ON_MAC ? "⌘ ↵" : "Ctrl ↵";
  }

  function blockLabel(block, index) {
    const position = `Block ${index + 1} of ${current.blocks.length}`;
    return block.type === "quote" ? `${position}, quote from ${block.title || hostOf(block.url)}` : `${position}, your text`;
  }

  // Moves and inserts from any control in a block, so the shortcuts the options
  // row advertises are true wherever focus is. A textarea handles and stops its
  // own keys, so nothing it owns arrives here.
  function bindBlockKeys(node, index) {
    node.addEventListener("keydown", (event) => {
      if (event.defaultPrevented) return;
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        moveBlock(index, event.key === "ArrowUp" ? -1 : 1, true, controlSelector(event.target));
        return;
      }
      // On a link, Ctrl or Command with Enter opens it in a background tab.
      // The source title is a link now, and that gesture belongs to the reader.
      if (event.target && event.target.closest && event.target.closest("a[href]")) return;
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        insertTextBlock(index + 1);
      }
    });
  }

  // One quiet control per block holds the list plumbing. A quote block used to
  // carry six equal chips and a text block four, so the product's two verbs
  // were outnumbered by reordering, and "Remove" computed identically to the
  // control beside it. The row opens on request, names each shortcut so it can
  // be learned where it is used, and keeps Remove apart in the colour that
  // means it. Each visible label starts its accessible name, so a reader who
  // says "Move up" to voice control is heard.
  function blockOptions(block, index) {
    const key = blockKeys[index];
    const total = current.blocks.length;
    const position = `block ${index + 1} of ${total}`;
    const rowId = `block-options-${key}`;
    const open = openOptionsKey === key;
    const subject = block.type === "quote" ? `the quote in ${position}` : position;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "block-options-toggle";
    toggle.setAttribute("aria-label", `Options for ${subject}`);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-controls", rowId);
    const glyph = document.createElement("span");
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = "⋯";
    toggle.appendChild(glyph);

    const row = document.createElement("div");
    row.className = "block-options";
    row.id = rowId;
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", `Options for ${subject}`);
    row.hidden = !open;

    const action = (className, label, name, shortcut, keys, onClick) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = className;
      button.setAttribute("aria-label", name);
      const text = document.createElement("span");
      text.textContent = label;
      button.appendChild(text);
      if (shortcut) {
        const kbd = document.createElement("kbd");
        kbd.setAttribute("aria-hidden", "true");
        kbd.textContent = shortcut;
        button.appendChild(kbd);
        button.setAttribute("aria-keyshortcuts", keys);
      }
      button.addEventListener("click", onClick);
      row.appendChild(button);
      return button;
    };

    const up = action("btn-ghost btn-move-up", "Move up", `Move up, ${position}`,
      shortcutLabel("up"), "Alt+ArrowUp", () => moveBlock(index, -1));
    up.disabled = index === 0;
    const down = action("btn-ghost btn-move-down", "Move down", `Move down, ${position}`,
      shortcutLabel("down"), "Alt+ArrowDown", () => moveBlock(index, 1));
    down.disabled = index === total - 1;
    action("btn-ghost btn-insert-below", "Add text below", `Add text below ${position}`,
      shortcutLabel("insert"), "Control+Enter Meta+Enter", () => insertTextBlock(index + 1));
    action("btn-danger btn-remove-block",
      block.type === "quote" ? "Remove quote" : "Remove block",
      block.type === "quote" ? `Remove quote in ${position}` : `Remove block ${index + 1} of ${total}`,
      null, null, () => removeBlock(index));

    const close = (returnFocus) => {
      if (openOptionsKey === key) openOptionsKey = null;
      toggle.setAttribute("aria-expanded", "false");
      row.hidden = true;
      if (returnFocus) toggle.focus();
    };
    toggle.addEventListener("click", () => {
      if (openOptionsKey === key) {
        close(false);
        return;
      }
      // One block's options at a time: a column of open rows is the clutter
      // this replaced.
      for (const other of els.blocks.querySelectorAll('.block-options-toggle[aria-expanded="true"]')) {
        other.setAttribute("aria-expanded", "false");
        const otherRow = document.getElementById(other.getAttribute("aria-controls"));
        if (otherRow) otherRow.hidden = true;
      }
      openOptionsKey = key;
      toggle.setAttribute("aria-expanded", "true");
      // Set here and never during a render, so a row rebuilt already open by a
      // move does not drop in again on every press.
      row.classList.add("just-opened");
      row.hidden = false;
    });
    const onEscape = (event) => {
      if (event.key !== "Escape" || row.hidden) return;
      event.preventDefault();
      close(true);
    };
    toggle.addEventListener("keydown", onEscape);
    row.addEventListener("keydown", onEscape);
    return { toggle, row };
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
    // The textarea owns these keys. Its handler rebuilds the list, and the same
    // event still bubbling to the block would move or insert a second time, so
    // the owner stops it rather than the block guessing where it came from.
    area.addEventListener("keydown", (event) => {
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        event.stopPropagation();
        moveBlock(index, event.key === "ArrowUp" ? -1 : 1, true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
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
    const { toggle, row } = blockOptions(block, index);
    li.appendChild(toggle);
    li.appendChild(row);
    bindBlockKeys(li, index);
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

    // Where it came from and the way back to it, together. The source title is
    // the link to the page, which is what a citation is; that took a chip away.
    // Return is then the one framed button a quote carries, so it leads the
    // block by what surrounds it rather than by being louder.
    const source = document.createElement("div");
    source.className = "quote-source";
    const cite = document.createElement("p");
    cite.className = "quote-cite";
    const label = block.title || hostOf(block.url);
    if (/^https?:\/\//i.test(block.url)) {
      const link = document.createElement("a");
      link.className = "quote-source-link btn-open-source";
      link.href = block.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.appendChild(document.createTextNode(label));
      const arrow = document.createElement("span");
      arrow.className = "quote-source-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "↗";
      link.appendChild(arrow);
      const hint = document.createElement("span");
      hint.className = "visually-hidden";
      hint.textContent = " (opens the page in a new tab)";
      link.appendChild(hint);
      cite.appendChild(link);
    } else {
      cite.appendChild(document.createTextNode(label));
    }
    if (block.title && hostOf(block.url)) {
      const host = document.createElement("span");
      host.className = "quote-cite-host";
      host.textContent = ` · ${hostOf(block.url)}`;
      cite.appendChild(host);
    }
    source.appendChild(cite);

    if (!(block.checked && block.checked.reason === "clip-gone")) {
      const back = document.createElement("button");
      back.type = "button";
      back.className = "btn-return";
      // Two quotes of one page used to be two buttons both named "Return".
      back.setAttribute("aria-label", `Return to the passage quoted in block ${index + 1} of ${current.blocks.length}`);
      const mark = document.createElement("span");
      mark.className = "return-glyph";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = "↩";
      back.appendChild(mark);
      back.appendChild(document.createTextNode("Return"));
      back.addEventListener("click", () => returnToClip(block, index, back, verdict));
      source.appendChild(back);
    }
    li.appendChild(source);
    li.appendChild(verdict);

    const { toggle, row } = blockOptions(block, index);
    li.appendChild(toggle);
    li.appendChild(row);
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
    // Captured now, because an index is a position and not an identity. The
    // reader can move this quote or open another draft while the worker is
    // looking, and the answer must follow the quote that asked for it or be
    // dropped. Resolving `current.blocks[index]` on the way back once handed
    // one quote's result to whichever quote had taken its place.
    const draftId = current ? current.id : null;
    const key = verdictKey(index);
    const passageId = block.passageId;
    button.disabled = true;
    showVerdict(verdict, "Looking for the passage…", "checking");
    sendMessage({ type: "revealPassage", id: passageId }, (res) => {
      button.disabled = false;
      if (!current || current.id !== draftId) return;
      const at = blockKeys.indexOf(key);
      const target = at >= 0 ? current.blocks[at] : null;
      if (!target || target.type !== "quote" || target.passageId !== passageId) return;
      // The block list may have been rebuilt, which leaves the element captured
      // above detached, so write to the one on screen now.
      const row = blockNode(at);
      const live = (row && row.querySelector(".quote-verdict")) || verdict;
      if (!res || !res.ok) {
        verdicts.delete(key);
        const clipGone = Boolean(res && res.error === "not-found");
        showVerdict(live, clipGone
          ? "That clip is no longer in your library. This quote keeps the text you saved."
          : "ReadTrail could not open that page. Please try again.", "missing");
        // A gone clip is a durable fact about this quote, so it replaces
        // whatever the last successful check said. Writing nothing here left
        // the old "found exactly" standing, and the next render read it back
        // and told the reader their evidence was intact. A page that failed to
        // open is different: it says nothing about the quote, so the last real
        // outcome is left alone.
        if (clipGone) {
          target.checked = { quality: "missing", at: Date.now(), reason: "clip-gone" };
          scheduleSave();
          renderSummary();
          // Leave no control that is now certain to fail. The row keeps
          // "Open page", which still works.
          if (button && button.parentElement) button.remove();
        }
        return;
      }
      verdicts.set(key, { quality: res.quality, opened: Boolean(res.opened) });
      // Persist what was found, so the draft can still say which quotes held
      // after the tab is closed. The tab clause is deliberately not stored: it
      // describes this moment, not the quote.
      target.checked = { quality: res.quality, at: Date.now() };
      scheduleSave();
      renderSummary();
      showVerdict(live, revealText(res.quality, res.opened), res.quality);
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
    // The clip being gone is true now and stays true, so it is not dated the
    // way an observation about a page is.
    if (checked.reason === "clip-gone") {
      return "The clip this came from is no longer in your library. This quote keeps the text you saved.";
    }
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

  function moveBlock(index, delta, movedByKeyboard = false, focusControl = null) {
    const target = index + delta;
    if (target < 0 || target >= current.blocks.length) return;
    const [movedKey] = blockKeys.splice(index, 1);
    blockKeys.splice(target, 0, movedKey);
    const [block] = current.blocks.splice(index, 1);
    current.blocks.splice(target, 0, block);
    const atEdge = delta < 0 ? target === 0 : target === current.blocks.length - 1;
    let control;
    if (movedByKeyboard) {
      control = focusControl || "textarea";
      // The control that made the move is disabled at an edge, and focus would
      // otherwise fall out of the open row to the block's first control.
      if (atEdge && control === ".btn-move-up") control = ".btn-move-down";
      else if (atEdge && control === ".btn-move-down") control = ".btn-move-up";
    } else {
      // A move made from the options row keeps that row open on the block it
      // moved, so the same control can be pressed again. At an edge that
      // control is disabled, so focus goes to its inverse instead.
      openOptionsKey = movedKey;
      const same = delta < 0 ? ".btn-move-up" : ".btn-move-down";
      const inverse = delta < 0 ? ".btn-move-down" : ".btn-move-up";
      control = atEdge ? inverse : same;
    }
    pendingFocus = { index: target, control };
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
    // The reader is writing now, so the options they came from close.
    openOptionsKey = null;
    pendingFocus = { index, control: "textarea" };
    renderBlocks();
    scheduleSave();
  }

  function removeBlock(index) {
    const block = current.blocks[index];
    const [removedKey] = blockKeys.splice(index, 1);
    verdicts.delete(removedKey);
    if (openOptionsKey === removedKey) openOptionsKey = null;
    current.blocks.splice(index, 1);
    // Emptying the list inserts somewhere to write. Remember that we did, so
    // undo can drop it again without mistaking an empty block the reader
    // already had for one of ours.
    let placeholderAdded = false;
    if (current.blocks.length === 0) {
      current.blocks.push({ type: "text", text: "" });
      blockKeys.push(newBlockKey());
      placeholderAdded = true;
    }
    pendingFocus = { index: Math.max(0, index - 1), control: null };
    renderBlocks();
    const note = block && block.type === "quote"
      ? "Quote removed from this draft. The clip it came from is still in your library."
      : "Block removed.";
    announce(note);
    offerUndo(block, index, note, placeholderAdded);
    scheduleSave();
  }

  // The way back belongs in the gap the block left, but the block list is
  // rebuilt often, so it is placed from state on every render rather than
  // moved once and hoped for.
  function placeUndo() {
    if (!els || !els.undo) return;
    if (!removed) return;
    // A list may only contain list items. The offer used to sit in the <ol> as
    // a bare button, so a screen reader walking the list met a non-item.
    if (!undoSlot) {
      undoSlot = document.createElement("li");
      undoSlot.className = "draft-undo-slot";
    }
    undoSlot.appendChild(els.undo);
    const at = Math.min(removed.index, current ? current.blocks.length : 0);
    els.blocks.insertBefore(undoSlot, blockNode(at));
    els.undo.hidden = false;
  }

  // A removal is the only destructive action in the editor and it autosaves
  // within 400ms, so the way back has to be offered immediately and has to be
  // visible: the live region alone tells a sighted reader nothing.
  function offerUndo(block, index, note, placeholderAdded) {
    if (!block || !els) return;
    removed = { block, index, placeholderAdded: Boolean(placeholderAdded) };
    if (undoTimer !== null) clearTimeout(undoTimer);
    setStatus(note, "status");
    placeUndo();
    els.undo.focus();
    undoTimer = setTimeout(() => {
      undoTimer = null;
      const index = removed ? removed.index : 0;
      removed = null;
      // Hiding the offer while it held focus dropped the reader to the top of
      // the page, with nothing said. Land them beside the gap instead.
      if (retireUndo()) focusNear(index);
    }, UNDO_WINDOW_MS);
  }

  // Ends the offer outright, for when the draft it belongs to is left.
  function withdrawUndo() {
    if (undoTimer !== null) {
      clearTimeout(undoTimer);
      undoTimer = null;
    }
    removed = null;
    retireUndo();
  }

  // Returns whether the offer held focus when it was withdrawn.
  function retireUndo() {
    if (!els || !els.undo) return false;
    const hadFocus = document.activeElement === els.undo;
    els.undo.hidden = true;
    if (els.undoHome && els.undo.parentNode !== els.undoHome) els.undoHome.appendChild(els.undo);
    if (undoSlot && undoSlot.parentNode) undoSlot.parentNode.removeChild(undoSlot);
    return hadFocus;
  }

  function focusNear(index) {
    const count = current ? current.blocks.length : 0;
    const node = blockNode(Math.min(index, count - 1)) || blockNode(index - 1);
    const target = (node && node.querySelector(".block-options-toggle")) || (els && els.append);
    if (target && typeof target.focus === "function") target.focus();
  }

  function undoRemove() {
    if (!removed || !current) return;
    const { block, index, placeholderAdded } = removed;
    removed = null;
    if (undoTimer !== null) {
      clearTimeout(undoTimer);
      undoTimer = null;
    }
    retireUndo();
    // Drop the placeholder only if we are the ones who added it, and do it
    // before the index is clamped, or the restored block is appended past the
    // end of an empty list and the placeholder is what survives.
    if (placeholderAdded && current.blocks.length === 1) {
      current.blocks = [];
      blockKeys = [];
    }
    const at = Math.min(index, current.blocks.length);
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
