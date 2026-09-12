// Shared validators and cloners for every record that crosses a trust
// boundary. Requires shared/constants.js to have run first. Every function is
// pure; cloners copy exactly the fields a record version defines so unknown
// fields never leak into storage.
(() => {
  "use strict";

  const shared = globalThis.ReadTrailShared;
  if (!shared || !shared.LIMITS) {
    throw new Error("shared/constants.js must load before shared/validators.js");
  }
  const { LIMITS, VERSIONS, DEFAULTS } = shared;

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function isValidTabId(value) {
    return Number.isInteger(value) && value >= 0;
  }

  function isValidPageUrl(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > LIMITS.URL_MAX) return false;
    try {
      const parsed = new URL(value);
      return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.href === value;
    } catch (_) {
      return false;
    }
  }

  function isValidAnchor(anchor) {
    return isRecord(anchor)
      && anchor.version === 1
      && Array.isArray(anchor.path)
      && anchor.path.length > 0
      && anchor.path.every((index) => Number.isInteger(index) && index >= 0)
      && Number.isInteger(anchor.offset)
      && anchor.offset >= 0;
  }

  function cloneAnchor(anchor) {
    return {
      version: anchor.version,
      path: [...anchor.path],
      offset: anchor.offset
    };
  }

  function isValidPosition(position) {
    return isRecord(position)
      && isValidAnchor(position.anchor)
      && isFiniteNumber(position.viewportOffset)
      && isFiniteNumber(position.scrollY)
      && position.scrollY >= 0
      && isFiniteNumber(position.scrollRatio)
      && position.scrollRatio >= 0
      && position.scrollRatio <= 1
      && isFiniteNumber(position.savedAt)
      && position.savedAt >= 0;
  }

  function clonePosition(position) {
    return {
      anchor: cloneAnchor(position.anchor),
      viewportOffset: position.viewportOffset,
      scrollY: position.scrollY,
      scrollRatio: position.scrollRatio,
      savedAt: position.savedAt
    };
  }

  function isValidSavedPosition(position) {
    return isValidPosition(position)
      && position.anchor.path.length <= LIMITS.SAVED_ANCHOR_MAX_DEPTH
      && position.anchor.path.every((index) => index <= LIMITS.SAVED_ANCHOR_MAX_INDEX)
      && position.anchor.offset <= LIMITS.SAVED_ANCHOR_MAX_OFFSET;
  }

  function isValidTitle(value) {
    return typeof value === "string"
      && value.length > 0
      && value.length <= LIMITS.TITLE_MAX
      && value === value.trim();
  }

  function isValidSavedRecord(record) {
    return isRecord(record)
      && record.version === VERSIONS.SAVED_RECORD
      && isValidTitle(record.title)
      && isValidSavedPosition(record.position)
      && isFiniteNumber(record.savedAt)
      && record.savedAt >= 0;
  }

  function cloneSavedRecord(record) {
    return {
      version: record.version,
      title: record.title,
      position: clonePosition(record.position),
      savedAt: record.savedAt
    };
  }

  // The page state is the projection of a tab record that content scripts and
  // extension pages consume. It never carries the URL, title, or tab metadata.
  function isValidPageState(state) {
    return isRecord(state)
      && state.version === VERSIONS.PAGE_STATE
      && typeof state.active === "boolean"
      && (state.mode === "following" || state.mode === "frozen")
      && (state.position === null || isValidPosition(state.position));
  }

  function clonePageState(state) {
    return {
      version: VERSIONS.PAGE_STATE,
      active: state.active,
      mode: state.mode,
      position: state.position ? clonePosition(state.position) : null
    };
  }

  function isValidTabRecord(record) {
    return isRecord(record)
      && record.version === VERSIONS.TAB_RECORD
      && isValidPageUrl(record.url)
      && typeof record.title === "string"
      && record.title.length <= LIMITS.TITLE_MAX
      && typeof record.active === "boolean"
      && (record.mode === "following" || record.mode === "frozen")
      && (record.position === null || isValidPosition(record.position))
      && typeof record.incognito === "boolean"
      && (record.origin === "user" || record.origin === "continue")
      && isFiniteNumber(record.updatedAt)
      && record.updatedAt >= 0;
  }

  function cloneTabRecord(record) {
    return {
      version: VERSIONS.TAB_RECORD,
      url: record.url,
      title: record.title,
      active: record.active,
      mode: record.mode,
      position: record.position ? clonePosition(record.position) : null,
      incognito: record.incognito,
      origin: record.origin,
      updatedAt: record.updatedAt
    };
  }

  const HEX_COLOR = /^#[0-9a-f]{6}$/i;
  const STYLES = ["ruler", "dots", "underline"];

  const SETTING_RULES = {
    style: (v) => STYLES.includes(v),
    color: (v) => typeof v === "string" && HEX_COLOR.test(v),
    size: (v) => Number.isInteger(v) && v >= 10 && v <= 100,
    opacity: (v) => isFiniteNumber(v) && v >= 0.1 && v <= 1,
    dotCount: (v) => Number.isInteger(v) && v >= 5 && v <= 50,
    fadeSpeed: (v) => isFiniteNumber(v) && v >= 0.8 && v <= 0.99,
    highlightLine: (v) => typeof v === "boolean",
    highlightColor: (v) => typeof v === "string" && HEX_COLOR.test(v)
  };

  // Accepts a partial settings object: every present key must be known and
  // valid. Unknown keys (including the removed legacy `enabled`) are rejected so
  // callers cannot smuggle state into the settings record.
  function isValidSettings(value) {
    if (!isRecord(value)) return false;
    return Object.entries(value).every(([key, item]) => {
      const rule = SETTING_RULES[key];
      return typeof rule === "function" && rule(item);
    });
  }

  function mergeSettings(stored, patch) {
    const base = isRecord(stored) ? stored : {};
    const clean = {};
    for (const key of Object.keys(DEFAULTS)) {
      const rule = SETTING_RULES[key];
      if (Object.prototype.hasOwnProperty.call(base, key) && rule(base[key])) clean[key] = base[key];
    }
    return { ...DEFAULTS, ...clean, ...(isRecord(patch) ? patch : {}) };
  }

  Object.assign(shared, {
    isRecord,
    isFiniteNumber,
    isValidTabId,
    isValidPageUrl,
    isValidAnchor,
    isValidPosition,
    clonePosition,
    isValidSavedPosition,
    isValidTitle,
    isValidSavedRecord,
    cloneSavedRecord,
    isValidPageState,
    clonePageState,
    isValidTabRecord,
    cloneTabRecord,
    isValidSettings,
    mergeSettings
  });
})();
