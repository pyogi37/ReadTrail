const DEFAULTS = {
  enabled: true,
  style: "ruler",
  color: "#FF6B6B",
  size: 30,
  opacity: 0.3,
  dotCount: 20,
  fadeSpeed: 0.9,
  highlightLine: false,
  highlightColor: "#FFEB3B"
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("settings", (result) => {
    if (!result.settings) {
      chrome.storage.local.set({ settings: { ...DEFAULTS } });
    }
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return false;

  if (msg.type === "getSettings") {
    chrome.storage.local.get("settings", (result) => {
      sendResponse({ ...DEFAULTS, ...(result.settings || {}) });
    });
    return true;
  }
  if (msg.type === "toggleEnabled" && typeof msg.enabled === "boolean") {
    chrome.storage.local.get("settings", (result) => {
      const settings = { ...DEFAULTS, ...(result.settings || {}), enabled: msg.enabled };
      chrome.storage.local.set({ settings });
      sendResponse(settings);
    });
    return true;
  }
  return false;
});
