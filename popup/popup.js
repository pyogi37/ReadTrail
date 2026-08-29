const toggle = document.getElementById("toggleSwitch");
const statusLabel = document.getElementById("statusLabel");
const openOptions = document.getElementById("openOptions");

chrome.storage.local.get("settings", (result) => {
  const s = result.settings || { enabled: true };
  const enabled = s.enabled !== false;
  toggle.checked = enabled;
  statusLabel.textContent = enabled ? "Enabled" : "Disabled";
});

toggle.addEventListener("change", () => {
  const enabled = toggle.checked;
  statusLabel.textContent = enabled ? "Enabled" : "Disabled";

  chrome.storage.local.get("settings", (result) => {
    const settings = { ...(result.settings || {}), enabled };
    chrome.storage.local.set({ settings });
  });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: "toggleEnabled", enabled }).catch(() => {});
    }
  });
});

openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
