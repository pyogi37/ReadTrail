// Passage capture and highlight for the content script. Nothing here runs on
// its own: capture happens only when the worker or side panel sends
// `capturePassage` (an explicit reader action), and highlights are drawn only
// on an active page from records the reader already saved.
(() => {
  "use strict";

  const TEXT_MAX = (globalThis.ReadTrailShared && globalThis.ReadTrailShared.LIMITS && globalThis.ReadTrailShared.LIMITS.TEXT_MAX) || 4000;
  const HIGHLIGHT_NAME = "readtrail-passage";

  function getPosition() {
    return (typeof window !== "undefined" && window.ReadTrailPosition) || null;
  }

  function serializeBoundary(node, offset) {
    const P = getPosition();
    if (!P || typeof P.serializeNode !== "function") return null;
    try {
      return P.serializeNode(node, offset) || null;
    } catch (_) {
      return null;
    }
  }

  // Returns { ok, text, start, end, url, title } or { ok:false, error }.
  function captureSelection() {
    let selection = null;
    try {
      selection = window.getSelection();
    } catch (_) {
      return { ok: false, error: "no-selection" };
    }
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return { ok: false, error: "no-selection" };
    }
    const text = String(selection).replace(/\s+/g, " ").trim();
    if (text.length === 0) return { ok: false, error: "no-selection" };
    if (text.length > TEXT_MAX) return { ok: false, error: "too-long" };
    const range = selection.getRangeAt(0);
    return {
      ok: true,
      text,
      start: serializeBoundary(range.startContainer, range.startOffset),
      end: serializeBoundary(range.endContainer, range.endOffset),
      url: location.href,
      title: typeof document.title === "string" ? document.title : ""
    };
  }

  function highlightsSupported() {
    return typeof CSS !== "undefined" && CSS.highlights && typeof Highlight === "function";
  }

  // Draws saved passages with the CSS Custom Highlight API so the page DOM is
  // never mutated. Passages whose anchors no longer resolve are skipped.
  function applyHighlights(passages) {
    if (!highlightsSupported()) return 0;
    const P = getPosition();
    if (!P || typeof P.resolveAnchor !== "function") return 0;
    const ranges = [];
    for (const passage of Array.isArray(passages) ? passages : []) {
      if (!passage || !passage.start || !passage.end) continue;
      try {
        const start = P.resolveAnchor(passage.start);
        const end = P.resolveAnchor(passage.end);
        if (!start || !end) continue;
        const range = document.createRange();
        range.setStart(start.startContainer, start.startOffset);
        range.setEnd(end.startContainer, end.startOffset);
        if (!range.collapsed) ranges.push(range);
      } catch (_) { /* skip unresolvable passages */ }
    }
    try {
      if (ranges.length === 0) {
        CSS.highlights.delete(HIGHLIGHT_NAME);
      } else {
        CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
      }
    } catch (_) {
      return 0;
    }
    return ranges.length;
  }

  function clearHighlights() {
    if (!highlightsSupported()) return;
    try { CSS.highlights.delete(HIGHLIGHT_NAME); } catch (_) { /* nothing to clear */ }
  }

  window.ReadTrailPassage = { captureSelection, applyHighlights, clearHighlights, HIGHLIGHT_NAME };
})();
