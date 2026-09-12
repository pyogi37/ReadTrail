// Shared constants for every ReadTrail surface. Loaded as a classic script:
// content scripts and extension pages via <script>/manifest order, the service
// worker via importScripts. Exposes a single frozen namespace on globalThis so
// no surface keeps its own copy of defaults, keys, or error strings.
(() => {
  "use strict";

  const DEFAULTS = Object.freeze({
    style: "ruler",
    color: "#FF6B6B",
    size: 30,
    opacity: 0.3,
    dotCount: 20,
    fadeSpeed: 0.9,
    highlightLine: false,
    highlightColor: "#FFEB3B"
  });

  const KEYS = Object.freeze({
    SETTINGS: "settings",
    TAB_PREFIX: "readtrail.tab.v1:",
    SAVED_PREFIX: "readtrail.saved.v1:",
    RECENT: "readtrail.recent.v1",
    LEGACY_PAGES: "readingPages"
  });

  const VERSIONS = Object.freeze({
    PAGE_STATE: 1,
    TAB_RECORD: 1,
    SAVED_RECORD: 1
  });

  const LIMITS = Object.freeze({
    URL_MAX: 8192,
    TITLE_MAX: 512,
    // Bound durable anchor geometry so malformed records cannot carry enormous
    // integers into persistent storage. Session anchors stay unconstrained.
    SAVED_ANCHOR_MAX_DEPTH: 64,
    SAVED_ANCHOR_MAX_INDEX: 100000,
    SAVED_ANCHOR_MAX_OFFSET: 1000000
  });

  const ERRORS = Object.freeze({
    INVALID_INPUT: "invalid-input",
    INVALID_SENDER: "invalid-sender",
    PAGE_INACTIVE: "page-inactive",
    STORAGE_UNAVAILABLE: "storage-unavailable",
    SESSION_UNAVAILABLE: "session-storage-unavailable",
    SESSION_WRITE: "session-storage-error",
    SESSION_READ: "session-read-error",
    GET_STORAGE: "get-storage-error",
    SAVE_STORAGE: "save-storage-error",
    REMOVE_STORAGE: "remove-storage-error",
    CLEAR_STORAGE: "clear-storage-error",
    NO_SAVED_RECORD: "no-saved-record",
    TABS_UNAVAILABLE: "tabs-unavailable",
    TAB_CREATE_FAILED: "tab-create-failed",
    TAB_UNAVAILABLE: "tab-unavailable",
    // Content-script reply codes consumed by extension pages.
    RUNTIME_UNAVAILABLE: "runtime-unavailable",
    INACTIVE: "inactive",
    NO_CHECKPOINT: "no-checkpoint",
    PERSISTENCE_FAILURE: "persistence-failure",
    PERSISTENCE_REJECTED: "persistence-rejected",
    SUPERSEDED: "superseded",
    SAVE_FAILED: "save-failed"
  });

  const shared = globalThis.ReadTrailShared || {};
  shared.DEFAULTS = DEFAULTS;
  shared.KEYS = KEYS;
  shared.VERSIONS = VERSIONS;
  shared.LIMITS = LIMITS;
  shared.ERRORS = ERRORS;
  globalThis.ReadTrailShared = shared;
})();
