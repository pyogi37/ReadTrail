// Defaults come from shared/constants.js (loaded by options.html). Settings are
// read and written only through the service worker so validation stays in one
// place.
const DEFAULTS = (globalThis.ReadTrailShared && globalThis.ReadTrailShared.DEFAULTS) || {};

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

const $ = (id) => document.getElementById(id);

const els = {
  stylePicker: $("stylePicker"),
  color: $("color"),
  size: $("size"),
  sizeValue: $("sizeValue"),
  opacity: $("opacity"),
  opacityValue: $("opacityValue"),
  dotCount: $("dotCount"),
  dotCountValue: $("dotCountValue"),
  fadeSpeed: $("fadeSpeed"),
  fadeSpeedValue: $("fadeSpeedValue"),
  highlightLine: $("highlightLine"),
  highlightColor: $("highlightColor"),
  highlightOptions: $("highlightOptions"),
  dotsOptions: $("dotsOptions"),
  resetBtn: $("resetBtn"),
  saveStatus: $("saveStatus")
};

let statusTimer = null;

function announce(message) {
  clearTimeout(statusTimer);
  els.saveStatus.textContent = message;
  statusTimer = setTimeout(() => {
    els.saveStatus.textContent = "";
  }, 1800);
}

function setRangeValue(input, output, value, suffix) {
  input.value = value;
  input.setAttribute("aria-valuetext", `${value}${suffix}`);
  output.textContent = value;
}

function save() {
  const settings = {
    style: document.querySelector(".style-btn.active").dataset.style,
    color: els.color.value,
    size: parseInt(els.size.value),
    opacity: parseInt(els.opacity.value) / 100,
    dotCount: parseInt(els.dotCount.value),
    fadeSpeed: parseInt(els.fadeSpeed.value) / 100,
    highlightLine: els.highlightLine.checked,
    highlightColor: els.highlightColor.value
  };
  sendMessage({ type: "setSettings", settings }, (res) => {
    announce(res && res.ok ? "Settings saved" : "Settings could not be saved");
  });
  updateVisibility();
}

function updateVisibility() {
  const style = document.querySelector(".style-btn.active").dataset.style;
  const showDots = style === "dots";
  const showHighlight = els.highlightLine.checked;
  els.dotsOptions.hidden = !showDots;
  els.dotsOptions.classList.toggle("visible", showDots);
  els.highlightOptions.hidden = !showHighlight;
  els.highlightOptions.classList.toggle("visible", showHighlight);
}

function loadSettings() {
  sendMessage({ type: "getSettings" }, (result) => {
    const s = { ...DEFAULTS, ...(result && typeof result === "object" ? result : {}) };

    els.color.value = s.color;
    setRangeValue(els.size, els.sizeValue, s.size, " pixels");
    setRangeValue(els.opacity, els.opacityValue, Math.round(s.opacity * 100), " percent");
    setRangeValue(els.dotCount, els.dotCountValue, s.dotCount, " dots");
    setRangeValue(els.fadeSpeed, els.fadeSpeedValue, Math.round(s.fadeSpeed * 100), " percent");
    els.highlightLine.checked = s.highlightLine;
    els.highlightColor.value = s.highlightColor;

    document.querySelectorAll(".style-btn").forEach((btn) => {
      const active = btn.dataset.style === s.style;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });

    updateVisibility();
  });
}

document.querySelectorAll(".style-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".style-btn").forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-pressed", "false");
    });
    btn.classList.add("active");
    btn.setAttribute("aria-pressed", "true");
    save();
  });
});

els.size.addEventListener("input", () => {
  setRangeValue(els.size, els.sizeValue, els.size.value, " pixels");
  save();
});

els.opacity.addEventListener("input", () => {
  setRangeValue(els.opacity, els.opacityValue, els.opacity.value, " percent");
  save();
});

els.dotCount.addEventListener("input", () => {
  setRangeValue(els.dotCount, els.dotCountValue, els.dotCount.value, " dots");
  save();
});

els.fadeSpeed.addEventListener("input", () => {
  setRangeValue(els.fadeSpeed, els.fadeSpeedValue, els.fadeSpeed.value, " percent");
  save();
});

els.color.addEventListener("input", save);
els.highlightLine.addEventListener("change", () => { updateVisibility(); save(); });
els.highlightColor.addEventListener("input", save);
els.resetBtn.addEventListener("click", () => {
  sendMessage({ type: "setSettings", settings: { ...DEFAULTS } }, (res) => {
    loadSettings();
    announce(res && res.ok ? "Defaults restored" : "Defaults could not be restored");
  });
});

loadSettings();
