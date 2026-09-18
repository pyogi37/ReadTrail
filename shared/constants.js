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
    highlightColor: "#FFEB3B",
    // What happens when a tab closes with unsaved reading progress.
    closeSave: "ask",
    // Hostnames where ReadTrail never activates; content scripts exit early.
    excludedHosts: Object.freeze([])
  });

  const KEYS = Object.freeze({
    SETTINGS: "settings",
    TAB_PREFIX: "readtrail.tab.v1:",
    SAVED_PREFIX: "readtrail.saved.v1:",
    RECENT: "readtrail.recent.v1",
    PASSAGE_PREFIX: "readtrail.passage.v1:",
    NOTE_PREFIX: "readtrail.note.v1:",
    PAGEMETA_PREFIX: "readtrail.pagemeta.v1:",
    DRAFT_PREFIX: "readtrail.draft.v1:",
    // Session: the URL of a tab the reader clipped from, so Return can reuse
    // that tab without asking every open tab where it is.
    SEEN_PREFIX: "readtrail.seen.v1:",
    LIBRARY: "readtrail.library.v1",
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
    SAVED_ANCHOR_MAX_OFFSET: 1000000,
    LANDMARK_ID_MAX: 256,
    RECENT_MAX: 10,
    RECENT_TTL_MS: 30 * 60 * 1000,
    // Knowledge layer bounds: keep the library well inside the 10 MB
    // storage.local quota and refuse politely instead of asking for more.
    TEXT_MAX: 4000,
    TAG_MAX: 40,
    TAGS_MAX: 20,
    LIBRARY_MAX: 1500,
    // Drafts: the reader's own writing. Bounded so one runaway draft cannot
    // consume the storage.local quota by itself.
    DRAFTS_MAX: 100,
    DRAFT_BLOCKS_MAX: 200,
    DRAFT_CHARS_MAX: 24000,
    // Refuse new durable writes past this, so the library can always be
    // reduced. Removals, clearing, and settings are never refused.
    STORAGE_SOFT_MAX: 9 * 1024 * 1024,
    IMPORT_MAX_BYTES: 8 * 1024 * 1024,
    HOST_MAX: 253,
    EXCLUDED_HOSTS_MAX: 200
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
    NO_RECENT_ITEM: "no-recent-item",
    NOT_FOUND: "not-found",
    LIBRARY_FULL: "library-full",
    NO_SELECTION: "no-selection",
    TOO_LONG: "too-long",
    DRAFT_FULL: "draft-full",
    STORAGE_FULL: "storage-full",
    REVEAL_UNAVAILABLE: "reveal-unavailable",
    SITE_EXCLUDED: "site-excluded",
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
