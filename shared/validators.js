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

  function isIndexPath(value) {
    return Array.isArray(value)
      && value.length > 0
      && value.every((index) => Number.isInteger(index) && index >= 0);
  }

  function isValidLandmark(landmark) {
    if (landmark === null) return true;
    return isRecord(landmark)
      && typeof landmark.id === "string"
      && landmark.id.length > 0
      && landmark.id.length <= LIMITS.LANDMARK_ID_MAX
      && isIndexPath(landmark.path);
  }

  function isValidCheck(check) {
    return isRecord(check)
      && typeof check.tag === "string"
      && check.tag.length <= 64
      && Number.isInteger(check.textLength)
      && check.textLength >= 0;
  }

  // v1: child-index path from body plus a character offset.
  // v2: adds an optional landmark (nearest ancestor id plus path from it) and
  // a structural check (parent tag, text length). No version stores text.
  function isValidAnchor(anchor) {
    if (!isRecord(anchor) || !isIndexPath(anchor.path)) return false;
    if (!Number.isInteger(anchor.offset) || anchor.offset < 0) return false;
    if (anchor.version === 1) return true;
    if (anchor.version !== 2) return false;
    return isValidLandmark(anchor.landmark) && isValidCheck(anchor.check);
  }

  function cloneAnchor(anchor) {
    const clone = {
      version: anchor.version,
      path: [...anchor.path],
      offset: anchor.offset
    };
    if (anchor.version === 2) {
      clone.landmark = anchor.landmark ? { id: anchor.landmark.id, path: [...anchor.landmark.path] } : null;
      clone.check = { tag: anchor.check.tag, textLength: anchor.check.textLength };
    }
    return clone;
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

  function isBoundedPath(path) {
    return path.length <= LIMITS.SAVED_ANCHOR_MAX_DEPTH
      && path.every((index) => index <= LIMITS.SAVED_ANCHOR_MAX_INDEX);
  }

  function isValidSavedAnchor(anchor) {
    if (!isValidAnchor(anchor)) return false;
    if (!isBoundedPath(anchor.path) || anchor.offset > LIMITS.SAVED_ANCHOR_MAX_OFFSET) return false;
    return anchor.version !== 2 || !anchor.landmark || isBoundedPath(anchor.landmark.path);
  }

  function isValidSavedPosition(position) {
    if (!isValidPosition(position)) return false;
    return isValidSavedAnchor(position.anchor);
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

  const RESTORE_QUALITIES = ["exact", "approximate", "fallback"];

  function isRestoreQuality(value) {
    return RESTORE_QUALITIES.includes(value);
  }

  function clonePageState(state) {
    const clone = {
      version: VERSIONS.PAGE_STATE,
      active: state.active,
      mode: state.mode,
      position: state.position ? clonePosition(state.position) : null
    };
    if (isRestoreQuality(state.restoreQuality)) clone.restoreQuality = state.restoreQuality;
    return clone;
  }

  // A tab opened by Return carries the clip it should scroll to. The content
  // script consumes it once at bootstrap, exactly as a seeded position is.
  function isValidReveal(value) {
    return value === null || (isRecord(value) && isValidId(value.passageId));
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
      && (record.origin === "user" || record.origin === "continue" || record.origin === "reveal")
      && (record.reveal === undefined || isValidReveal(record.reveal))
      && (record.restoreQuality === undefined || isRestoreQuality(record.restoreQuality))
      && isFiniteNumber(record.updatedAt)
      && record.updatedAt >= 0;
  }

  function cloneTabRecord(record) {
    const clone = {
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
    if (isRestoreQuality(record.restoreQuality)) clone.restoreQuality = record.restoreQuality;
    if (isRecord(record.reveal) && isValidId(record.reveal.passageId)) {
      clone.reveal = { passageId: record.reveal.passageId };
    }
    return clone;
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
    highlightColor: (v) => typeof v === "string" && HEX_COLOR.test(v),
    closeSave: (v) => v === "ask" || v === "always" || v === "never",
    excludedHosts: (v) => Array.isArray(v)
      && v.length <= LIMITS.EXCLUDED_HOSTS_MAX
      && v.every((host) => isValidHost(host))
      && new Set(v).size === v.length
  };

  const HOST_PATTERN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

  function isValidHost(value) {
    return typeof value === "string" && HOST_PATTERN.test(value);
  }

  // Lowercases and strips a leading "www." so "www.Example.com" and
  // "example.com" mean the same site. Returns null for junk.
  function normalizeHost(value) {
    if (typeof value !== "string") return null;
    let host = value.trim().toLowerCase();
    if (host.includes("://")) {
      try { host = new URL(host).hostname; } catch (_) { return null; }
    }
    host = host.replace(/^www\./, "").replace(/\.$/, "");
    return isValidHost(host) ? host : null;
  }

  // True when the URL's hostname equals an excluded host or is a subdomain
  // of one.
  function isHostExcluded(url, excludedHosts) {
    if (!Array.isArray(excludedHosts) || excludedHosts.length === 0) return false;
    let host = null;
    try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch (_) { return false; }
    return excludedHosts.some((excluded) => host === excluded || host.endsWith("." + excluded));
  }

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
    const merged = { ...DEFAULTS, ...clean, ...(isRecord(patch) ? patch : {}) };
    merged.excludedHosts = [...merged.excludedHosts];
    return merged;
  }

  function isValidRecentItem(item) {
    return isRecord(item)
      && isValidTabId(item.tabId)
      && isValidPageUrl(item.url)
      && typeof item.title === "string"
      && item.title.length <= LIMITS.TITLE_MAX
      && isValidSavedPosition(item.position)
      && isFiniteNumber(item.closedAt)
      && item.closedAt >= 0;
  }

  function cloneRecentItem(item) {
    return {
      tabId: item.tabId,
      url: item.url,
      title: item.title,
      position: clonePosition(item.position),
      closedAt: item.closedAt
    };
  }

  // Drops malformed and expired entries; never trusts stored order.
  function normalizeRecentList(value, now) {
    const items = isRecord(value) && Array.isArray(value.items) ? value.items : [];
    const fresh = items
      .filter((item) => isValidRecentItem(item) && now - item.closedAt <= LIMITS.RECENT_TTL_MS)
      .map(cloneRecentItem)
      .sort((a, b) => b.closedAt - a.closedAt);
    return { version: 1, items: fresh.slice(0, LIMITS.RECENT_MAX) };
  }

  // --- Knowledge layer records ---

  const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function isValidId(value) {
    return typeof value === "string" && ID_PATTERN.test(value);
  }

  function isValidText(value, allowEmpty) {
    if (typeof value !== "string" || value.length > LIMITS.TEXT_MAX) return false;
    return allowEmpty || value.trim().length > 0;
  }

  // Tags are lowercased, trimmed, deduplicated, and bounded. Returns null when
  // the input is not a list of strings or exceeds the limits.
  function normalizeTags(value) {
    if (!Array.isArray(value)) return null;
    const out = [];
    for (const raw of value) {
      if (typeof raw !== "string") return null;
      const tag = raw.trim().toLowerCase().replace(/\s+/g, " ");
      if (tag.length === 0) continue;
      if (tag.length > LIMITS.TAG_MAX) return null;
      if (!out.includes(tag)) out.push(tag);
    }
    return out.length <= LIMITS.TAGS_MAX ? out : null;
  }

  function isValidTags(value) {
    const tags = normalizeTags(value);
    return tags !== null && tags.length === value.length && tags.every((tag, i) => tag === value[i]);
  }

  function isValidOptionalAnchor(value) {
    return value === null || isValidSavedAnchor(value);
  }

  function isValidPassage(record) {
    return isRecord(record)
      && record.version === 1
      && isValidId(record.id)
      && isValidPageUrl(record.url)
      && typeof record.title === "string"
      && record.title.length <= LIMITS.TITLE_MAX
      && isValidText(record.text, false)
      && isValidOptionalAnchor(record.start)
      && isValidOptionalAnchor(record.end)
      && isValidText(record.note, true)
      && isValidTags(record.tags)
      && isFiniteNumber(record.createdAt) && record.createdAt >= 0
      && isFiniteNumber(record.updatedAt) && record.updatedAt >= 0;
  }

  function clonePassage(record) {
    return {
      version: 1,
      id: record.id,
      url: record.url,
      title: record.title,
      text: record.text,
      start: record.start ? cloneAnchor(record.start) : null,
      end: record.end ? cloneAnchor(record.end) : null,
      note: record.note,
      tags: [...record.tags],
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }

  function isValidNote(record) {
    return isRecord(record)
      && record.version === 1
      && isValidId(record.id)
      && isValidPageUrl(record.url)
      && typeof record.title === "string"
      && record.title.length <= LIMITS.TITLE_MAX
      && isValidText(record.text, false)
      && isValidTags(record.tags)
      && (record.source === undefined || record.source === "user" || record.source === "ai")
      && isFiniteNumber(record.createdAt) && record.createdAt >= 0
      && isFiniteNumber(record.updatedAt) && record.updatedAt >= 0;
  }

  function cloneNote(record) {
    const clone = {
      version: 1,
      id: record.id,
      url: record.url,
      title: record.title,
      text: record.text,
      tags: [...record.tags],
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
    if (record.source === "ai") clone.source = "ai";
    return clone;
  }

  function isValidPageMeta(record) {
    return isRecord(record)
      && record.version === 1
      && isValidTags(record.tags)
      && isFiniteNumber(record.updatedAt) && record.updatedAt >= 0;
  }

  function clonePageMeta(record) {
    return { version: 1, tags: [...record.tags], updatedAt: record.updatedAt };
  }

  // --- Drafts ---

  // A draft is the reader's own document: ordered blocks of their text and
  // quotes of clips they saved. A quote carries a snapshot of the clip's text,
  // url, and title so the draft stays readable and exportable even after the
  // clip is removed; `passageId` remains the authority for Return.
  const REVEAL_QUALITIES = ["exact", "approximate", "missing"];

  function isRevealQuality(value) {
    return REVEAL_QUALITIES.includes(value);
  }

  // What Return last found for this quote. Optional, so every draft written
  // before it existed still validates, and so a quote never checked simply
  // has nothing to say.
  function isValidChecked(value) {
    if (value === undefined) return true;
    return isRecord(value)
      && isRevealQuality(value.quality)
      && isFiniteNumber(value.at)
      && value.at >= 0;
  }

  function isValidDraftBlock(block) {
    if (!isRecord(block)) return false;
    if (block.type === "text") return isValidText(block.text, true);
    if (block.type !== "quote") return false;
    return isValidId(block.passageId)
      && isValidText(block.text, false)
      && isValidPageUrl(block.url)
      && typeof block.title === "string"
      && block.title.length <= LIMITS.TITLE_MAX
      && isValidChecked(block.checked);
  }

  function cloneDraftBlock(block) {
    if (block.type === "text") return { type: "text", text: block.text };
    const clone = {
      type: "quote",
      passageId: block.passageId,
      text: block.text,
      url: block.url,
      title: block.title
    };
    if (isValidChecked(block.checked) && block.checked !== undefined) {
      clone.checked = { quality: block.checked.quality, at: block.checked.at };
    }
    return clone;
  }

  function draftChars(blocks) {
    return blocks.reduce((total, block) => total + block.text.length, 0);
  }

  function isValidDraftBlocks(value) {
    return Array.isArray(value)
      && value.length <= LIMITS.DRAFT_BLOCKS_MAX
      && value.every(isValidDraftBlock)
      && draftChars(value) <= LIMITS.DRAFT_CHARS_MAX;
  }

  function isValidDraft(record) {
    return isRecord(record)
      && record.version === 1
      && isValidId(record.id)
      && isValidTitle(record.title)
      && isValidTags(record.tags)
      && isValidDraftBlocks(record.blocks)
      && isFiniteNumber(record.createdAt) && record.createdAt >= 0
      && isFiniteNumber(record.updatedAt) && record.updatedAt >= 0;
  }

  function cloneDraft(record) {
    return {
      version: 1,
      id: record.id,
      title: record.title,
      tags: [...record.tags],
      blocks: record.blocks.map(cloneDraftBlock),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }

  function isValidExport(payload) {
    return isRecord(payload)
      && payload.format === "readtrail-export"
      && payload.version === 1
      && Array.isArray(payload.saved)
      && Array.isArray(payload.passages)
      && Array.isArray(payload.notes)
      && Array.isArray(payload.pagemeta)
      // Optional so files written before drafts existed still import, and so
      // an older build still accepts a file that carries them.
      && (payload.drafts === undefined || Array.isArray(payload.drafts));
  }

  Object.assign(shared, {
    isRecord,
    isValidId,
    isValidText,
    normalizeTags,
    isValidTags,
    isValidPassage,
    clonePassage,
    isValidNote,
    cloneNote,
    isValidPageMeta,
    clonePageMeta,
    isValidDraftBlock,
    cloneDraftBlock,
    isValidChecked,
    isValidDraftBlocks,
    isValidDraft,
    cloneDraft,
    draftChars,
    isRevealQuality,
    isValidExport,
    isValidRecentItem,
    cloneRecentItem,
    normalizeRecentList,
    isFiniteNumber,
    isValidTabId,
    isValidPageUrl,
    isValidAnchor,
    isValidSavedAnchor,
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
    isValidReveal,
    isRestoreQuality,
    isValidSettings,
    mergeSettings,
    isValidHost,
    normalizeHost,
    isHostExcluded
  });
})();
