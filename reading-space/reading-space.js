const $ = (id) => document.getElementById(id);

const els = {
  clearAllButton: $("clearAllButton"),
  clearConfirm: $("clearConfirm"),
  clearConfirmYes: $("clearConfirmYes"),
  clearConfirmCancel: $("clearConfirmCancel"),
  statusMessage: $("statusMessage"),
  errorMessage: $("errorMessage"),
  contentRegion: $("contentRegion"),
  loadingState: $("loadingState"),
  emptyState: $("emptyState"),
  loadErrorState: $("loadErrorState"),
  savedList: $("savedList")
};

// The page never reads or writes storage itself; every durable interaction goes
// through the service worker's validated messages. Display state is a local
// mirror built only from validated responses.
let items = []; // { url, title, savedAt, continueBusy, removeBusy, confirmRemove, status, statusRole }
let listState = "loading"; // "loading" | "error" | "empty" | "list"
let pendingClear = false; // True when the clear-all confirmation is open.
let clearing = false; // True while a clear-all round-trip is in flight.

// Callback-compatible wrapper surfaces "no receiver / messaging failure" as a
// null response, distinct from an explicit {ok:false} reply. It also checks
// chrome.runtime.lastError so a missing receiver never throws.
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
  if (typeof value !== "string" || value.length === 0 || value.length > 8192) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.href === value;
  } catch (_) {
    return false;
  }
}

// Accepts only the fields the Reading Space renders; any other shape is ignored,
// never trusted as HTML, and never stored.
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
  // The service worker already sorts, but sorting here guarantees a stable
  // newest-first order even if that contract ever changes.
  return [...list].sort((a, b) => b.savedAt - a.savedAt);
}

// --- Load / render ---

// `silent` avoids dropping the current view to the loading state when a list
// refresh happens after a successful remove or clear-all, preventing a flash.
function loadItems(silent = false) {
  if (!silent) {
    listState = "loading";
    items = [];
    pendingClear = false;
    render();
  }
  sendMessage({ type: "listSavedResumePoints" }, (res) => {
    if (!res || !res.ok || !Array.isArray(res.items)) {
      // On a silent refresh that fails, keep whatever is already displayed and
      // surface the failure without discarding the list.
      if (!silent && listState !== "list") {
        listState = "error";
      }
      setError("Your saved pages could not be loaded. Close and reopen this page to try again.");
      if (!silent) render();
      return;
    }
    const valid = [];
    for (const raw of res.items) {
      const item = validateItem(raw);
      if (item) valid.push(item);
    }
    items = sortNewestFirst(valid);
    listState = items.length === 0 ? "empty" : "list";
    pendingClear = false;
    setError("");
    render();
  });
}

function render() {
  // Clear-all visibility depends on having something to clear and not already
  // in the middle of some confirmation/round-trip.
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
  const domain = domainFromUrl(item.url);
  const when = formatSavedTime(item.savedAt);
  const metaParts = [domain, when].filter(Boolean);
  meta.textContent = metaParts.join(" · ") || "Saved page";

  text.appendChild(title);
  text.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "item-actions";

  const continueBtn = document.createElement("button");
  continueBtn.type = "button";
  continueBtn.className = "btn-primary btn-continue";
  continueBtn.textContent = "Continue reading";
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

  // Deliberate per-item removal confirmation, revealed only after the reader
  // chooses Remove.
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
  confirmYes.addEventListener("click", () => confirmRemove(item.url));

  const cancelRemoveBtn = document.createElement("button");
  cancelRemoveBtn.type = "button";
  cancelRemoveBtn.className = "btn-ghost";
  cancelRemoveBtn.textContent = "Cancel";
  cancelRemoveBtn.addEventListener("click", () => cancelRemove(item.url));

  confirmActions.appendChild(confirmYes);
  confirmActions.appendChild(cancelRemoveBtn);
  confirmRow.appendChild(confirmText);
  confirmRow.appendChild(confirmActions);
  li.appendChild(confirmRow);

  // Continue and remove are mutually exclusive in-flight operations; the row
  // dims its text block and disables buttons while either is pending.
  const anyBusy = item.continueBusy || item.removeBusy;
  continueBtn.disabled = anyBusy;
  removeBtn.disabled = anyBusy;
  continueBtn.setAttribute("aria-disabled", String(continueBtn.disabled));
  removeBtn.setAttribute("aria-disabled", String(removeBtn.disabled));
  confirmYes.disabled = item.removeBusy;
  cancelRemoveBtn.disabled = item.removeBusy;

  if (item.continueBusy) {
    continueBtn.textContent = "Opening…";
  }

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
  for (const item of items) {
    frag.appendChild(buildItemNode(item));
  }
  els.savedList.textContent = "";
  els.savedList.appendChild(frag);
}

function updateItem(url, patch) {
  const item = items.find((i) => i.url === url);
  if (item) Object.assign(item, patch);
  render();
}

// --- Actions ---

// Continue only asks the service worker to open the page; the Reading Space
// never navigates and never reimplements tab creation. Progress is reflected
// in-flight and on failure.
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

function confirmRemove(url) {
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
      // Update only after confirmed success; re-load from the service worker as
      // the source of truth.
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

// --- Clear all ---

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

// --- Wiring ---

els.clearAllButton.addEventListener("click", onClearAll);
els.clearConfirmYes.addEventListener("click", confirmClearAll);
els.clearConfirmCancel.addEventListener("click", cancelClearAll);

loadItems();
