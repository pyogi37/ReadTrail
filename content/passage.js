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

  // --- Return: find a saved clip in the live page ------------------------

  const REVEAL_NAME = "readtrail-reveal";
  const FLASH_MS = 2500;
  let flashTimer = null;

  // Capture stored the clip with runs of whitespace collapsed to one space.
  // Every comparison and search below must normalise the same way or an
  // "exact" verdict would depend on how the page happens to wrap its text.
  function normalizeText(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  }

  function rangeFromAnchors(start, end) {
    const P = getPosition();
    if (!P || typeof P.resolveAnchor !== "function" || !start || !end) return null;
    try {
      const a = P.resolveAnchor(start);
      const b = P.resolveAnchor(end);
      if (!a || !b) return null;
      const range = document.createRange();
      range.setStart(a.startContainer, a.startOffset);
      range.setEnd(b.startContainer, b.startOffset);
      return range.collapsed ? null : range;
    } catch (_) {
      return null;
    }
  }

  // Walks the page's text for the clip's own words. This is what makes an
  // honest "the page has changed" possible instead of a silent wrong jump.
  // It reads the DOM only because the reader asked to go back to this clip,
  // and it stores nothing.
  function rangeFromText(text) {
    const needle = normalizeText(text);
    if (needle.length === 0 || !document.body) return null;
    let walker = null;
    try {
      walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    } catch (_) {
      return null;
    }
    // One flat string of the page's text, with an index back to the node and
    // offset each character came from.
    const nodes = [];
    let flat = "";
    let node = walker.nextNode();
    while (node) {
      const value = typeof node.nodeValue === "string" ? node.nodeValue : "";
      for (let i = 0; i < value.length; i++) {
        const char = /\s/.test(value[i]) ? " " : value[i];
        // Collapse runs of whitespace exactly as capture did.
        if (char === " " && flat.endsWith(" ")) continue;
        flat += char;
        nodes.push({ node, offset: i });
      }
      node = walker.nextNode();
      if (flat.length > 2000000) break; // very large documents: give up safely
    }
    const at = flat.indexOf(needle);
    if (at < 0) return null;
    const first = nodes[at];
    const last = nodes[at + needle.length - 1];
    if (!first || !last) return null;
    try {
      const range = document.createRange();
      range.setStart(first.node, first.offset);
      range.setEnd(last.node, last.offset + 1);
      return range.collapsed ? null : range;
    } catch (_) {
      return null;
    }
  }

  function prefersReducedMotion() {
    try {
      return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (_) {
      return false;
    }
  }

  function scrollRangeIntoView(range) {
    try {
      const rect = range.getBoundingClientRect();
      if (!rect || !Number.isFinite(rect.top)) return;
      const viewport = Number.isFinite(window.innerHeight) ? window.innerHeight : 0;
      const current = Number.isFinite(window.scrollY) ? window.scrollY : 0;
      const target = Math.max(0, rect.top + current - (viewport / 2) + (rect.height / 2));
      window.scrollTo({ top: target, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    } catch (_) { /* scrolling unsupported */ }
  }

  // A second named highlight, removed on a timer. CSS transitions do not apply
  // to ::highlight, so the flash is the highlight's presence, not an animation.
  function flashRange(range) {
    if (!highlightsSupported()) return;
    try {
      CSS.highlights.set(REVEAL_NAME, new Highlight(range));
    } catch (_) {
      return;
    }
    if (flashTimer !== null) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashTimer = null;
      try { CSS.highlights.delete(REVEAL_NAME); } catch (_) { /* already gone */ }
    }, FLASH_MS);
  }

  // Returns "exact" | "approximate" | "missing".
  //   exact       both anchors resolved AND the text there still matches
  //   approximate the clip's words were found somewhere else on the page
  //   missing     neither worked
  // The text check is not optional: the anchor's structural check compares only
  // a parent tag and a text length, so a rewritten paragraph of the same length
  // would otherwise be reported as an exact match.
  function revealPassage(start, end, text) {
    const wanted = normalizeText(text);
    let range = rangeFromAnchors(start, end);
    let quality = "missing";
    if (range && (wanted.length === 0 || normalizeText(range.toString()) === wanted)) {
      quality = "exact";
    } else {
      range = rangeFromText(text);
      quality = range ? "approximate" : "missing";
    }
    if (!range) return { quality: "missing" };
    scrollRangeIntoView(range);
    flashRange(range);
    return { quality };
  }

  function clearReveal() {
    if (flashTimer !== null) {
      clearTimeout(flashTimer);
      flashTimer = null;
    }
    if (!highlightsSupported()) return;
    try { CSS.highlights.delete(REVEAL_NAME); } catch (_) { /* nothing to clear */ }
  }

  window.ReadTrailPassage = { captureSelection, applyHighlights, clearHighlights, HIGHLIGHT_NAME,
    revealPassage, clearReveal, normalizeText, REVEAL_NAME };
})();
