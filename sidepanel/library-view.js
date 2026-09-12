// Saved pages list for the side panel (the former Reading Space). The view
// never reads or writes storage itself; every durable interaction goes
// through the service worker's validated messages, and every rendered value
// is inserted as text, never HTML.
(() => {
  "use strict";

  const NS = globalThis.ReadTrailSidePanel = globalThis.ReadTrailSidePanel || {};
  const shared = globalThis.ReadTrailShared || {};

  let els = null;
  let items = []; // { url, title, savedAt, continueBusy, removeBusy, confirmRemove, status, statusRole }
  let listState = "loading"; // "loading" | "error" | "empty" | "list"
  let pendingClear = false;
  let clearing = false;

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

  function isValidUrl(value) {
    if (typeof shared.isValidPageUrl === "function") return shared.isValidPageUrl(value);
    if (typeof value !== "string" || value.length === 0 || value.length > 8192) return false;
    try {
      const parsed = new URL(value);
      return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.href === value;
    } catch (_) {
      return false;
    }
  }

  function validateItem(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (!isValidUrl(raw.url)) return null;
    if (typeof raw.title !== "string" || raw.title.trim().length === 0) return null;
    if (typeof raw.savedAt !== "number" || !Number.isFinite(raw.savedAt) || raw.savedAt < 0) return null;
    return { url: raw.url, title: raw.title.trim(), savedAt: raw.savedAt };
  }

  function domainFromUrl(url) {
    try {
      return new URL(url).hostname || "";
    } catch (_) {
      return "";
    }
  }

  function formatSavedTime(savedAt) {
    const date = new Date(savedAt);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function setStatus(message) {
    els.statusMessage.textContent = message;
    els.statusMessage.hidden = !message;
  }

  function setError(message) {
    els.errorMessage.textContent = message;
    els.errorMessage.hidden = !message;
  }

  function sortNewestFirst(list) {
    return [...list].sort((a, b) => b.savedAt - a.savedAt);
  }

  // `silent` keeps the current view while a refresh happens after a
  // successful remove, clear-all, or an external storage change.
  function loadItems(silent = false) {
    if (!silent) {
      listState = "loading";
      items = [];
      pendingClear = false;
      render();
    }
    sendMessage({ type: "listSavedResumePoints" }, (res) => {
      if (!res || !res.ok || !Array.isArray(res.items)) {
        if (!silent && listState !== "list") listState = "error";
        setError("Your saved pages could not be loaded. Close and reopen this panel to try again.");
        if (!silent) render();
        return;
      }
      const valid = [];
      for (const raw of res.items) {
        const item = validateItem(raw);
        if (item) valid.push(item);
      }
      // Preserve transient row state (busy flags, confirmations) across a
      // silent refresh so an in-flight action is not visually reset.
      const previous = new Map(items.map((item) => [item.url, item]));
      items = sortNewestFirst(valid).map((item) => {
        const old = previous.get(item.url);
        return old ? { ...old, ...item } : item;
      });
      listState = items.length === 0 ? "empty" : "list";
      if (!silent) pendingClear = false;
      setError("");
      render();
    });
  }

  function render() {
    if (!els) return;
    const hasItems = listState === "list" && items.length > 0;
    els.clearAllButton.disabled = !hasItems || clearing;
    els.clearAllButton.setAttribute("aria-disabled", String(els.clearAllButton.disabled));
    els.clearConfirm.hidden = !pendingClear;

    els.loadingState.hidden = listState !== "loading";
    els.emptyState.hidden = listState !== "empty";
    els.loadErrorState.hidden = listState !== "error";
    els.savedList.hidden = listState !== "list";

    if (listState === "list") {
      renderList();
    } else {
      els.savedList.textContent = "";
    }
  }

  function buildItemNode(item) {
    const li = document.createElement("li");
    li.className = "saved-item";
    li.dataset.url = item.url;

    const main = document.createElement("div");
    main.className = "item-main";

    const text = document.createElement("div");
    text.className = "item-text";

    const title = document.createElement("span");
    title.className = "item-title";
    title.textContent = item.title;

    const meta = document.createElement("span");
    meta.className = "item-meta";
    const metaParts = [domainFromUrl(item.url), formatSavedTime(item.savedAt)].filter(Boolean);
    meta.textContent = metaParts.join(" · ") || "Saved page";

    text.appendChild(title);
    text.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "item-actions";

    const continueBtn = document.createElement("button");
    continueBtn.type = "button";
    continueBtn.className = "btn-primary btn-continue";
    continueBtn.textContent = item.continueBusy ? "Opening…" : "Continue reading";
    continueBtn.addEventListener("click", () => onContinue(item.url));

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn-danger btn-remove";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => onRemove(item.url));

    actions.appendChild(continueBtn);
    actions.appendChild(removeBtn);
    main.appendChild(text);
    main.appendChild(actions);
    li.appendChild(main);

    const confirmRow = document.createElement("div");
    confirmRow.className = "item-confirm";
    confirmRow.hidden = !item.confirmRemove;

    const confirmText = document.createElement("span");
    confirmText.className = "confirm-text";
    confirmText.textContent = "Remove this saved page?";

    const confirmActions = document.createElement("div");
    confirmActions.className = "confirm-actions";

    const confirmYes = document.createElement("button");
    confirmYes.type = "button";
    confirmYes.className = "btn-danger-solid";
    confirmYes.textContent = item.removeBusy ? "Removing…" : "Remove";
    confirmYes.addEventListener("click", () => confirmRemove(item.url, false));

    // When the page also has passages or notes, offer to remove those too.
    const KV = NS.knowledgeView;
    const counts = KV && typeof KV.countsFor === "function" ? KV.countsFor(item.url) : { passages: 0, notes: 0 };
    const extra = counts.passages + counts.notes;
    let confirmAll = null;
    if (extra > 0) {
      confirmAll = document.createElement("button");
      confirmAll.type = "button";
      confirmAll.className = "btn-danger-solid btn-remove-all";
      confirmAll.textContent = `Remove page and ${extra} ${extra === 1 ? "note" : "notes"}`;
      confirmAll.addEventListener("click", () => confirmRemove(item.url, true));
      confirmText.textContent = `Remove this saved page? It also has ${extra} saved ${extra === 1 ? "passage or note" : "passages or notes"}.`;
    }

    const cancelRemoveBtn = document.createElement("button");
    cancelRemoveBtn.type = "button";
    cancelRemoveBtn.className = "btn-ghost";
    cancelRemoveBtn.textContent = "Cancel";
    cancelRemoveBtn.addEventListener("click", () => cancelRemove(item.url));

    confirmActions.appendChild(confirmYes);
    if (confirmAll) confirmActions.appendChild(confirmAll);
    confirmActions.appendChild(cancelRemoveBtn);
    confirmRow.appendChild(confirmText);
    confirmRow.appendChild(confirmActions);
    li.appendChild(confirmRow);

    const anyBusy = item.continueBusy || item.removeBusy;
    continueBtn.disabled = anyBusy;
    removeBtn.disabled = anyBusy;
    continueBtn.setAttribute("aria-disabled", String(continueBtn.disabled));
    removeBtn.setAttribute("aria-disabled", String(removeBtn.disabled));
    confirmYes.disabled = item.removeBusy;
    cancelRemoveBtn.disabled = item.removeBusy;

    if (item.status) {
      const statusP = document.createElement("p");
      statusP.className = "item-status";
      statusP.setAttribute("role", item.statusRole || "status");
      statusP.textContent = item.status;
      li.appendChild(statusP);
    }
    return li;
  }

  function renderList() {
    const frag = document.createDocumentFragment();
    for (const item of items) frag.appendChild(buildItemNode(item));
    els.savedList.textContent = "";
    els.savedList.appendChild(frag);
  }

  // --- Actions ---

  function onContinue(url) {
    const item = items.find((i) => i.url === url);
    if (!item || item.continueBusy || item.removeBusy) return;
    item.continueBusy = true;
    item.status = "Opening your saved page…";
    item.statusRole = "status";
    pendingClear = false;
    render();

    sendMessage({ type: "continueSavedResumePoint", url }, (res) => {
      const current = items.find((i) => i.url === url);
      if (!current) return;
      current.continueBusy = false;
      if (res && res.ok) {
        current.status = "Opened in a new tab.";
        current.statusRole = "status";
      } else if (res && res.error === "session-storage-error") {
        current.status = "Opened, but your place could not be restored. Your saved place has not been affected.";
        current.statusRole = "alert";
      } else {
        current.status = "Could not open this page. Your saved place has not been affected.";
        current.statusRole = "alert";
      }
      render();
    });
  }

  function onRemove(url) {
    const item = items.find((i) => i.url === url);
    if (!item || item.continueBusy || item.removeBusy) return;
    item.confirmRemove = true;
    pendingClear = false;
    render();
  }

  function cancelRemove(url) {
    const item = items.find((i) => i.url === url);
    if (!item || item.removeBusy) return;
    item.confirmRemove = false;
    render();
  }

  function confirmRemove(url, includePageData) {
    const item = items.find((i) => i.url === url);
    if (!item || item.removeBusy || item.continueBusy) return;
    item.removeBusy = true;
    item.confirmRemove = true;
    item.status = "Removing…";
    item.statusRole = "status";
    pendingClear = false;
    render();

    sendMessage({ type: "removeSavedResumePoint", url }, (res) => {
      if (res && res.ok) {
        if (includePageData) {
          sendMessage({ type: "removePageData", url }, (pageRes) => {
            const KV = NS.knowledgeView;
            if (KV && typeof KV.reload === "function") KV.reload();
            if (!pageRes || !pageRes.ok) {
              setError("The page was removed, but its passages and notes could not be. Remove them from the library below.");
            }
            loadItems(true);
          });
          return;
        }
        loadItems(true);
        return;
      }
      const current = items.find((i) => i.url === url);
      if (current) {
        current.removeBusy = false;
        current.confirmRemove = false;
        current.status = "Could not remove this page. Please try again.";
        current.statusRole = "alert";
        render();
      }
    });
  }

  function onClearAll() {
    if (clearing || listState !== "list" || items.length === 0) return;
    pendingClear = true;
    render();
  }

  function cancelClearAll() {
    if (clearing) return;
    pendingClear = false;
    render();
  }

  function confirmClearAll() {
    if (clearing || listState !== "list") return;
    clearing = true;
    pendingClear = true;
    setStatus("Removing all saved pages…");
    render();
    els.clearConfirmYes.disabled = true;
    els.clearConfirmCancel.disabled = true;

    sendMessage({ type: "clearSavedResumePoints" }, (res) => {
      clearing = false;
      els.clearConfirmYes.disabled = false;
      els.clearConfirmCancel.disabled = false;
      pendingClear = false;
      if (res && res.ok) {
        setStatus("All saved pages were removed from this device.");
        setError("");
        loadItems(true);
        return;
      }
      setStatus("");
      setError("Could not clear your saved pages. Please try again.");
      render();
    });
  }

  function init() {
    const $ = (id) => document.getElementById(id);
    els = {
      clearAllButton: $("clearAllButton"),
      clearConfirm: $("clearConfirm"),
      clearConfirmYes: $("clearConfirmYes"),
      clearConfirmCancel: $("clearConfirmCancel"),
      statusMessage: $("statusMessage"),
      errorMessage: $("errorMessage"),
      loadingState: $("loadingState"),
      emptyState: $("emptyState"),
      loadErrorState: $("loadErrorState"),
      savedList: $("savedList")
    };
    els.clearAllButton.addEventListener("click", onClearAll);
    els.clearConfirmYes.addEventListener("click", confirmClearAll);
    els.clearConfirmCancel.addEventListener("click", cancelClearAll);
    loadItems();
  }

  NS.libraryView = { init, reload: loadItems };
})();
