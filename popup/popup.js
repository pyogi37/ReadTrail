const toggle = document.getElementById("toggleSwitch");
const statusLabel = document.getElementById("statusLabel");
const description = document.getElementById("description");
const readingLockNotice = document.getElementById("readingLockNotice");
const error = document.getElementById("error");
const openOptions = document.getElementById("openOptions");

// State is scoped to the exact page currently in the active tab. The popup
// never touches settings.enabled or chrome.storage.local; activation belongs to
// the service worker's session-only page records.
let tabId = null;
let tabUrl = null;
let pageState = null; // Last valid page state observed from the service worker.
let state = "loading"; // "loading" | "unsupported" | "inactive" | "active" | "error"
let changing = false; // True while an enable/disable transition is in flight.

// Callback-compatible wrappers surface "no receiver / messaging failure" as a
// null response, keeping it distinct from an explicit {ok:false} reply. Both
// check chrome.runtime.lastError so a missing content script never throws.
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
  try {
    chrome.tabs.sendMessage(tabId, message, (response) => {
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

function queryActiveTab(callback) {
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        callback(null);
        return;
      }
      callback(tabs && tabs[0] ? tabs[0] : null);
    });
  } catch (_) {
    callback(null);
  }
}

function isHttpUrl(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.href === value;
  } catch (_) {
    return false;
  }
}

function isPageState(value, expectedActive) {
  if (!value || typeof value !== "object" || value.version !== 1) return false;
  if (value.active !== expectedActive) return false;
  if (value.mode !== "following" && value.mode !== "frozen") return false;
  return value.position === null || (typeof value.position === "object" && value.position !== null);
}

function showError(message) {
  error.textContent = message;
  error.hidden = false;
}

function clearError() {
  error.textContent = "";
  error.hidden = true;
}

function render() {
  toggle.checked = state === "active";
  const actionable = state === "inactive" || state === "active";
  toggle.disabled = changing || !actionable;
  toggle.setAttribute("aria-disabled", String(toggle.disabled));
  readingLockNotice.hidden = state !== "inactive";

  switch (state) {
    case "loading":
      statusLabel.textContent = "Loading…";
      description.textContent = "Checking whether ReadTrail can be used on this page.";
      break;
    case "unsupported":
      statusLabel.textContent = "Not supported on this page";
      description.textContent = "ReadTrail can only be used on http and https pages.";
      break;
    case "inactive":
      statusLabel.textContent = "Use on this page";
      description.textContent = "ReadTrail will only work on this exact page and lasts for this browser session.";
      break;
    case "active":
      statusLabel.textContent = "Active on this page";
      description.textContent = "Reading lock is on. Turn ReadTrail off to restore normal primary clicks.";
      break;
    case "error":
      statusLabel.textContent = "Something went wrong";
      description.textContent = "Close and reopen ReadTrail to try again.";
      break;
  }
}

// --- Initialize from the active tab and its exact page state ---

function loadState() {
  queryActiveTab((tab) => {
    if (!tab || !Number.isInteger(tab.id) || !isHttpUrl(tab.url)) {
      state = "unsupported";
      render();
      return;
    }
    tabId = tab.id;
    tabUrl = tab.url;

    sendRuntimeMessage({ type: "getPageState", url: tabUrl }, (res) => {
      if (!res || !res.ok || !isPageState(res.state, Boolean(res.state && res.state.active))) {
        state = "error";
        render();
        showError("ReadTrail could not read this page's session state.");
        return;
      }
      pageState = res.state;
      state = res.state.active ? "active" : "inactive";
      render();
    });
  });
}

// --- Enable: activate in the service worker, then deliver to the page ---

function enablePage() {
  changing = true;
  clearError();
  render();
  const url = tabUrl;

  // 1. Ask the service worker to mark the exact URL active and require the
  //    returned state, which is what the content script must be told.
  sendRuntimeMessage({ type: "setPageActive", url: url, active: true }, (res) => {
    if (!res || !res.ok || !isPageState(res.state, true)) {
      state = "error";
      changing = false;
      render();
      showError("Could not activate ReadTrail on this page.");
      return;
    }
    const returnedState = res.state;

    // 2. Deliver activation to the content script with the returned state.
    sendTabMessage({ type: "setPageActive", active: true, state: returnedState }, (delivery) => {
      // A null delivery means the content script is unavailable; anything other
      // than {ok:true} is a delivery failure that must roll the service back.
      if (!delivery || !delivery.ok) {
        sendRuntimeMessage({ type: "setPageActive", url: url, active: false }, (rollback) => {
          if (!rollback || !rollback.ok || !isPageState(rollback.state, false)) {
            state = "error";
            changing = false;
            render();
            showError("ReadTrail could not finish activating this page. Close and reopen it to check the page state.");
            return;
          }
          pageState = rollback.state;
          state = "inactive";
          changing = false;
          render();
          showError("Could not deliver ReadTrail to this page. Please reload and try again.");
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

// --- Disable: save-before-off on the page, then deactivate in the service ---

function disablePage() {
  const previousState = pageState;
  changing = true;
  clearError();
  render();

  // 1. Ask the content script to save its pending position and acknowledge
  //    before we tear the page down.
  sendTabMessage({ type: "setPageActive", active: false }, (contentRes) => {
    if (contentRes && contentRes.ok === false) {
      // The content script explicitly refused to save; it stayed active, so we
      // must keep the page active and surface the failure.
      state = "active";
      changing = false;
      render();
      showError("ReadTrail could not save your position before turning off.");
      return;
    }
    // contentRes === null (content unavailable, safe to continue) or
    // contentRes.ok === true (save acknowledged).

    // 2. Update the service-worker record and reflect the new state.
    sendRuntimeMessage({ type: "setPageActive", url: tabUrl, active: false }, (res) => {
      if (!res || !res.ok || !isPageState(res.state, false)) {
        // Keep the page active if we can; otherwise fall back to inactive.
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

// --- Wiring ---

toggle.addEventListener("change", () => {
  if (changing) return;
  if (state === "inactive" && toggle.checked) {
    enablePage();
  } else if (state === "active" && !toggle.checked) {
    disablePage();
  } else {
    render(); // Keep the toggle visually consistent with the current state.
  }
});

openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

loadState();
