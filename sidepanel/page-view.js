// "This page" controls for the side panel: activation toggle, reading-lock
// notice, save action, restore note. Ported from the popup and parametrized
// by the tab the shell tracks. Every page-state message names that tab.
(() => {
  "use strict";

  const NS = globalThis.ReadTrailSidePanel = globalThis.ReadTrailSidePanel || {};
  const shared = globalThis.ReadTrailShared || {};
  const pageControls = shared.pageControls || null;

  let els = null;
  let tab = null; // { tabId, url, title, supported } or null
  let pageState = null;
  let state = "loading"; // "loading" | "unsupported" | "inactive" | "active" | "error"
  let changing = false;
  let savedRecord = null;
  let justSaved = false;
  let saving = false;
  let loadRevision = 0;

  function sendRuntimeMessage(message, callback) {
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

  function sendTabMessage(message, callback) {
    if (!tab || !Number.isInteger(tab.tabId)) {
      callback(null);
      return;
    }
    try {
      chrome.tabs.sendMessage(tab.tabId, message, (response) => {
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

  function isPageState(value, expectedActive) {
    if (!value || typeof value !== "object" || value.version !== 1) return false;
    if (value.active !== expectedActive) return false;
    if (value.mode !== "following" && value.mode !== "frozen") return false;
    return value.position === null || (typeof value.position === "object" && value.position !== null);
  }

  function showError(message) {
    els.error.textContent = message;
    els.error.hidden = false;
  }

  function clearError() {
    els.error.textContent = "";
    els.error.hidden = true;
  }

  function render() {
    if (!els) return;
    els.toggle.checked = state === "active";
    const actionable = state === "inactive" || state === "active";
    els.toggle.disabled = changing || !actionable;
    els.toggle.setAttribute("aria-disabled", String(els.toggle.disabled));
    els.readingLockNotice.hidden = state !== "inactive";

    const title = tab && tab.supported && tab.title ? tab.title : "";
    els.pageTitle.textContent = title;
    els.pageTitle.hidden = title.length === 0;

    switch (state) {
      case "loading":
        els.statusLabel.textContent = "Loading…";
        els.description.textContent = "Checking whether ReadTrail can be used on this page.";
        break;
      case "unsupported":
        els.statusLabel.textContent = "Not available on this page";
        els.description.textContent = "ReadTrail works on http and https pages.";
        break;
      case "inactive":
        els.statusLabel.textContent = "Use on this page";
        els.description.textContent = "ReadTrail will only work on this exact page in this tab and lasts for this browser session.";
        break;
      case "active":
        els.statusLabel.textContent = "Active on this page";
        els.description.textContent = "Reading lock is on. Turn ReadTrail off to restore normal primary clicks.";
        break;
      case "error":
        els.statusLabel.textContent = "Something went wrong";
        els.description.textContent = "Switch tabs and back to try again.";
        break;
    }
    renderSave();
  }

  function renderSave() {
    const activePage = state === "active";
    els.saveSection.hidden = !activePage;

    let controls = { kind: "none", label: "Save for later", hint: "", disabled: true };
    if (activePage && pageControls) {
      controls = pageControls.saveButtonState(pageState, savedRecord, { justSaved });
    }
    els.saveButton.textContent = controls.label;
    els.saveHint.textContent = controls.hint;
    els.saveStatus.textContent = activePage ? "Saved on this device." : "";
    const note = activePage && pageControls ? pageControls.restoreNote(pageState) : "";
    els.restoreNote.textContent = note;
    els.restoreNote.hidden = note.length === 0;

    els.saveButton.disabled = !activePage || saving || changing || controls.disabled;
    els.saveButton.setAttribute("aria-disabled", String(els.saveButton.disabled));
    els.saveButton.classList.toggle("is-saved", justSaved);
    els.saveStatus.hidden = !justSaved;
  }

  // --- Load the tracked tab's state ---

  function loadState() {
    const revision = ++loadRevision;
    if (!tab || !tab.supported || !Number.isInteger(tab.tabId)) {
      state = "unsupported";
      pageState = null;
      render();
      return;
    }
    sendRuntimeMessage({ type: "getPageState", tabId: tab.tabId, url: tab.url }, (res) => {
      if (revision !== loadRevision) return;
      if (!res || !res.ok || !isPageState(res.state, Boolean(res.state && res.state.active))) {
        state = "error";
        render();
        showError("ReadTrail could not read this page's session state.");
        return;
      }
      pageState = res.state;
      state = res.state.active ? "active" : "inactive";
      render();
      sendRuntimeMessage({ type: "getSavedResumePoint", url: tab.url }, (savedRes) => {
        if (revision !== loadRevision) return;
        savedRecord = savedRes && savedRes.ok && savedRes.record ? savedRes.record : null;
        render();
      });
    });
  }

  // --- Enable / disable (two-phase with rollback, as in the popup) ---

  function enablePage() {
    changing = true;
    clearError();
    render();
    const { tabId, url } = tab;

    sendRuntimeMessage({ type: "setPageActive", tabId, url, active: true }, (res) => {
      if (!res || !res.ok || !isPageState(res.state, true)) {
        state = "error";
        changing = false;
        render();
        showError("Could not activate ReadTrail on this page.");
        return;
      }
      const returnedState = res.state;
      sendTabMessage({ type: "setPageActive", active: true, state: returnedState }, (delivery) => {
        if (!delivery || !delivery.ok) {
          sendRuntimeMessage({ type: "setPageActive", tabId, url, active: false }, (rollback) => {
            if (!rollback || !rollback.ok || !isPageState(rollback.state, false)) {
              state = "error";
              changing = false;
              render();
              showError("ReadTrail could not finish activating this page. Switch tabs and back to check the page state.");
              return;
            }
            pageState = rollback.state;
            state = "inactive";
            changing = false;
            render();
            showError("Could not deliver ReadTrail to this page. Please reload the page and try again.");
          });
          return;
        }
        pageState = returnedState;
        state = "active";
        changing = false;
        render();
      });
    });
  }

  function disablePage() {
    const previousState = pageState;
    changing = true;
    clearError();
    render();
    const { tabId, url } = tab;

    sendTabMessage({ type: "setPageActive", active: false }, (contentRes) => {
      if (contentRes && contentRes.ok === false) {
        state = "active";
        changing = false;
        render();
        showError("ReadTrail could not save your position before turning off.");
        return;
      }
      sendRuntimeMessage({ type: "setPageActive", tabId, url, active: false }, (res) => {
        if (!res || !res.ok || !isPageState(res.state, false)) {
          reactivateAfterFailedDisable(previousState);
          return;
        }
        pageState = res.state;
        state = "inactive";
        changing = false;
        render();
      });
    });
  }

  function reactivateAfterFailedDisable(previousState) {
    sendTabMessage({ type: "setPageActive", active: true, state: previousState }, (res) => {
      const becameActive = Boolean(res && res.ok);
      state = "active";
      changing = false;
      render();
      showError(
        becameActive
          ? "Could not turn ReadTrail off. It is still active on this page."
          : "Could not confirm the page marker, but this page is still active. Reload the page to restore it."
      );
    });
  }

  // --- Save for later ---

  function saveErrorText(res) {
    if (!res) return "Could not reach the page to save your position. Please reload and try again.";
    if (res.error === "no-checkpoint") return "Pause at a line first, then save your place.";
    if (res.error === "inactive") return "ReadTrail is no longer active on this page.";
    if (res.error === "persistence-failure" || res.error === "persistence-rejected") {
      return "ReadTrail could not save your position. Please try again.";
    }
    return "ReadTrail could not save your position on this page.";
  }

  function saveForLater() {
    if (saving || changing || state !== "active") return;
    saving = true;
    justSaved = false;
    clearError();
    render();

    sendTabMessage({ type: "saveForLater" }, (res) => {
      if (res && res.ok) {
        justSaved = true;
        saving = false;
        render();
        sendRuntimeMessage({ type: "getSavedResumePoint", url: tab.url }, (savedRes) => {
          if (savedRes && savedRes.ok && savedRes.record) savedRecord = savedRes.record;
        });
        return;
      }
      saving = false;
      render();
      showError(saveErrorText(res));
    });
  }

  // --- Public API for the shell ---

  function init() {
    const $ = (id) => document.getElementById(id);
    els = {
      section: $("pageSection"),
      pageTitle: $("pageTitle"),
      toggle: $("toggleSwitch"),
      statusLabel: $("statusLabel"),
      description: $("description"),
      readingLockNotice: $("readingLockNotice"),
      error: $("error"),
      saveSection: $("saveSection"),
      saveHint: $("saveHint"),
      saveButton: $("saveButton"),
      saveStatus: $("saveStatus"),
      restoreNote: $("restoreNote")
    };
    els.toggle.addEventListener("change", () => {
      if (changing) return;
      if (state === "inactive" && els.toggle.checked) {
        enablePage();
      } else if (state === "active" && !els.toggle.checked) {
        disablePage();
      } else {
        render();
      }
    });
    els.saveButton.addEventListener("click", saveForLater);
    render();
  }

  // Called by the shell whenever the tracked tab or its URL changes.
  function setTab(nextTab) {
    const sameTab = tab && nextTab && tab.tabId === nextTab.tabId && tab.url === nextTab.url;
    tab = nextTab ? { ...nextTab } : null;
    if (sameTab) {
      if (tab) tab.title = nextTab.title;
      refresh();
      return;
    }
    state = "loading";
    pageState = null;
    savedRecord = null;
    justSaved = false;
    saving = false;
    changing = false;
    if (els) clearError();
    render();
    loadState();
  }

  // Re-read state for the current tab, unless a transition is in flight.
  function refresh() {
    if (!tab || changing || saving) return;
    justSaved = false;
    loadState();
  }

  function currentTabId() {
    return tab ? tab.tabId : null;
  }

  NS.pageView = { init, setTab, refresh, currentTabId };
})();
