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
  enabled: $("enabled"),
  resetBtn: $("resetBtn")
};

function save() {
  const settings = {
    enabled: els.enabled.checked,
    style: document.querySelector(".style-btn.active").dataset.style,
    color: els.color.value,
    size: parseInt(els.size.value),
    opacity: parseInt(els.opacity.value) / 100,
    dotCount: parseInt(els.dotCount.value),
    fadeSpeed: parseInt(els.fadeSpeed.value) / 100,
    highlightLine: els.highlightLine.checked,
    highlightColor: els.highlightColor.value
  };
  chrome.storage.local.set({ settings });
  updateVisibility();
}

function updateVisibility() {
  const style = document.querySelector(".style-btn.active").dataset.style;
  els.dotsOptions.classList.toggle("visible", style === "dots");
  els.highlightOptions.classList.toggle("visible", els.highlightLine.checked);
}

function loadSettings() {
  chrome.storage.local.get("settings", (result) => {
    const s = { ...DEFAULTS, ...(result.settings || {}) };

    els.enabled.checked = s.enabled;
    els.color.value = s.color;
    els.size.value = s.size;
    els.sizeValue.textContent = s.size;
    els.opacity.value = Math.round(s.opacity * 100);
    els.opacityValue.textContent = Math.round(s.opacity * 100);
    els.dotCount.value = s.dotCount;
    els.dotCountValue.textContent = s.dotCount;
    els.fadeSpeed.value = Math.round(s.fadeSpeed * 100);
    els.fadeSpeedValue.textContent = s.fadeSpeed.toFixed(2);
    els.highlightLine.checked = s.highlightLine;
    els.highlightColor.value = s.highlightColor;

    document.querySelectorAll(".style-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.style === s.style);
    });

    updateVisibility();
  });
}

document.querySelectorAll(".style-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".style-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    save();
  });
});

els.size.addEventListener("input", () => {
  els.sizeValue.textContent = els.size.value;
  save();
});

els.opacity.addEventListener("input", () => {
  els.opacityValue.textContent = els.opacity.value;
  save();
});

els.dotCount.addEventListener("input", () => {
  els.dotCountValue.textContent = els.dotCount.value;
  save();
});

els.fadeSpeed.addEventListener("input", () => {
  els.fadeSpeedValue.textContent = (parseInt(els.fadeSpeed.value) / 100).toFixed(2);
  save();
});

els.color.addEventListener("input", save);
els.highlightLine.addEventListener("change", () => { updateVisibility(); save(); });
els.highlightColor.addEventListener("input", save);
els.enabled.addEventListener("change", save);

els.resetBtn.addEventListener("click", () => {
  chrome.storage.local.set({ settings: DEFAULTS }, loadSettings);
});

loadSettings();
