// "Recently closed" list: tabs that closed with unsaved reading progress. The
// service worker keeps the positions; this view only shows title, domain, and
// age, and offers Save place or Dismiss. Hidden entirely when empty.
(() => {
  "use strict";

  const NS = globalThis.ReadTrailSidePanel = globalThis.ReadTrailSidePanel || {};
  const shared = globalThis.ReadTrailShared || {};

  let els = null;
  let items = []; // { url, title, closedAt, busy, status, statusRole }

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
    return typeof shared.isValidPageUrl === "function" ? shared.isValidPageUrl(value) : false;
  }

  function validateItem(raw) {
    if (!raw || typeof raw !== "object" || !isValidUrl(raw.url)) return null;
    if (typeof raw.closedAt !== "number" || !Number.isFinite(raw.closedAt)) return null;
    const title = typeof raw.title === "string" && raw.title.trim().length > 0 ? raw.title.trim() : "";
    return { url: raw.url, title, closedAt: raw.closedAt };
  }

  function domainFromUrl(url) {
    try {
      return new URL(url).hostname || "";
    } catch (_) {
      return "";
    }
  }

  function ageText(closedAt) {
    const minutes = Math.max(0, Math.round((Date.now() - closedAt) / 60000));
    if (minutes < 1) return "closed just now";
    if (minutes === 1) return "closed 1 minute ago";
    return `closed ${minutes} minutes ago`;
  }

  function setError(message) {
    els.error.textContent = message;
    els.error.hidden = !message;
  }

  function load() {
    sendMessage({ type: "listRecentlyClosed" }, (res) => {
      if (!res || !res.ok || !Array.isArray(res.items)) {
        items = [];
        render();
        return;
      }
      const previous = new Map(items.map((item) => [item.url, item]));
      items = res.items
        .map(validateItem)
        .filter(Boolean)
        .map((item) => ({ ...(previous.get(item.url) || {}), ...item }));
      render();
    });
  }

  function render() {
    if (!els) return;
    els.section.hidden = items.length === 0;
    els.list.textContent = "";
    const frag = document.createDocumentFragment();
    for (const item of items) frag.appendChild(buildItemNode(item));
    els.list.appendChild(frag);
  }

  function buildItemNode(item) {
    const li = document.createElement("li");
    li.className = "recent-item";
    li.dataset.url = item.url;

    const text = document.createElement("div");
    text.className = "item-text";
    const title = document.createElement("span");
    title.className = "item-title";
    title.textContent = item.title || domainFromUrl(item.url) || "Closed page";
    const meta = document.createElement("span");
    meta.className = "item-meta";
    meta.textContent = [domainFromUrl(item.url), ageText(item.closedAt)].filter(Boolean).join(" · ");
    text.appendChild(title);
    text.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "item-actions";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn-primary btn-save-place";
    saveBtn.textContent = item.busy ? "Saving…" : "Save place";
    saveBtn.disabled = Boolean(item.busy);
    saveBtn.addEventListener("click", () => onSave(item.url));
    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.className = "btn-ghost btn-dismiss";
    dismissBtn.textContent = "Dismiss";
    dismissBtn.disabled = Boolean(item.busy);
    dismissBtn.addEventListener("click", () => onDismiss(item.url));
    actions.appendChild(saveBtn);
    actions.appendChild(dismissBtn);

    li.appendChild(text);
    li.appendChild(actions);
    if (item.status) {
      const statusP = document.createElement("p");
      statusP.className = "item-status";
      statusP.setAttribute("role", item.statusRole || "status");
      statusP.textContent = item.status;
      li.appendChild(statusP);
    }
    return li;
  }

  function onSave(url) {
    const item = items.find((i) => i.url === url);
    if (!item || item.busy) return;
    item.busy = true;
    item.status = "";
    render();
    sendMessage({ type: "saveRecentlyClosed", url }, (res) => {
      const current = items.find((i) => i.url === url);
      if (!current) return;
      current.busy = false;
      if (res && res.ok) {
        items = items.filter((i) => i.url !== url);
        setError("");
        render();
        return;
      }
      current.status = "Could not save this place. Please try again.";
      current.statusRole = "alert";
      render();
    });
  }

  function onDismiss(url) {
    const item = items.find((i) => i.url === url);
    if (!item || item.busy) return;
    item.busy = true;
    render();
    sendMessage({ type: "dismissRecentlyClosed", url }, (res) => {
      const current = items.find((i) => i.url === url);
      if (!current) return;
      current.busy = false;
      if (res && res.ok) {
        items = items.filter((i) => i.url !== url);
      } else {
        current.status = "Could not dismiss this entry.";
        current.statusRole = "alert";
      }
      render();
    });
  }

  function init() {
    const $ = (id) => document.getElementById(id);
    els = { section: $("recentSection"), list: $("recentList"), error: $("recentError") };
    render();
    load();
  }

  NS.recentView = { init, reload: load };
})();
