(() => {
  "use strict";

  const ANCHOR_VERSION = 1;

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function isNonNegativeInteger(value) {
    return Number.isInteger(value) && value >= 0;
  }

  function pickRoot(root) {
    if (root === undefined) return document.body;
    return root && root.childNodes ? root : null;
  }

  function maxScrollY() {
    const documentHeight = [document.documentElement, document.body]
      .filter(Boolean)
      .reduce((height, node) => {
        const scrollHeight = Number.isFinite(node.scrollHeight) ? node.scrollHeight : 0;
        return Math.max(height, scrollHeight);
      }, 0);
    const viewportHeight = Number.isFinite(window.innerHeight) ? window.innerHeight : 0;
    return Math.max(0, documentHeight - viewportHeight);
  }

  function clampScrollY(value) {
    if (!Number.isFinite(value)) return 0;
    const max = maxScrollY();
    return Math.min(Math.max(value, 0), max);
  }

  function caretFromPoint(x, y) {
    // Layout/caret APIs are not guaranteed; every path fails safely to null.
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
    try {
      if (typeof document.caretPositionFromPoint === "function") {
        const position = document.caretPositionFromPoint(x, y);
        if (position && position.offsetNode) {
          return { node: position.offsetNode, offset: position.offset };
        }
      }
      if (typeof document.caretRangeFromPoint === "function") {
        const range = document.caretRangeFromPoint(x, y);
        if (range && range.startContainer) {
          return { node: range.startContainer, offset: range.startOffset };
        }
      }
    } catch (_) {
      return null;
    }
    return null;
  }

  function rangeFromCaret(caret) {
    try {
      const range = document.createRange();
      range.setStart(caret.node, caret.offset);
      range.collapse(true);
      return range;
    } catch (_) {
      return null;
    }
  }

  function pathToRoot(node, root) {
    if (!node || !root) return null;
    const path = [];
    let current = node;
    while (current && current !== root) {
      const parent = current.parentNode;
      if (!parent) return null;
      let index = -1;
      const siblings = parent.childNodes;
      for (let i = 0; i < siblings.length; i++) {
        if (siblings[i] === current) {
          index = i;
          break;
        }
      }
      if (index < 0) return null;
      path.unshift(index);
      current = parent;
    }
    if (current !== root) return null;
    return path;
  }

  function leafLength(node) {
    if (!node) return 0;
    if (node.nodeType === Node.TEXT_NODE) return node.length;
    return node.childNodes ? node.childNodes.length : 0;
  }

  function serializeNode(node, offset, root) {
    if (!node || !isNonNegativeInteger(offset)) return null;
    const base = pickRoot(root);
    if (!base) return null;
    const path = pathToRoot(node, base);
    if (!path || path.length === 0) return null;
    if (offset > leafLength(node)) return null;
    return { version: ANCHOR_VERSION, path: path, offset: offset };
  }

  function serializeRange(range, root) {
    if (!range || !range.startContainer) return null;
    return serializeNode(range.startContainer, range.startOffset, root);
  }

  function validateAnchor(anchor) {
    if (!anchor || typeof anchor !== "object") return false;
    if (anchor.version !== ANCHOR_VERSION) return false;
    if (!Array.isArray(anchor.path) || anchor.path.length === 0) return false;
    for (const index of anchor.path) {
      if (!isNonNegativeInteger(index)) return false;
    }
    if (!isNonNegativeInteger(anchor.offset)) return false;
    return true;
  }

  function validatePosition(record) {
    if (!record || typeof record !== "object") return false;
    if (!validateAnchor(record.anchor)) return false;
    if (!isFiniteNumber(record.viewportOffset)) return false;
    if (!isFiniteNumber(record.scrollY) || record.scrollY < 0) return false;
    if (!isFiniteNumber(record.scrollRatio) || record.scrollRatio < 0 || record.scrollRatio > 1) {
      return false;
    }
    if (!isFiniteNumber(record.savedAt) || record.savedAt < 0) return false;
    return true;
  }

  function resolveAnchor(anchor, root) {
    if (!validateAnchor(anchor)) return null;
    const base = pickRoot(root);
    if (!base) return null;
    let node = base;
    for (const index of anchor.path) {
      if (!node.childNodes || index >= node.childNodes.length) return null;
      node = node.childNodes[index];
      if (!node) return null;
    }
    if (anchor.offset > leafLength(node)) return null;
    try {
      const range = document.createRange();
      range.setStart(node, anchor.offset);
      range.collapse(true);
      return range;
    } catch (_) {
      return null;
    }
  }

  function caretViewportOffset(range, fallback) {
    let top = fallback;
    try {
      if (range && typeof range.getBoundingClientRect === "function") {
        const rect = range.getBoundingClientRect();
        if (rect && isFiniteNumber(rect.top)) top = rect.top;
      }
    } catch (_) {
      // Keep the fallback coordinate when layout is unavailable.
    }
    return isFiniteNumber(top) ? top : 0;
  }

  function documentOffsetY(range) {
    try {
      if (range && typeof range.getBoundingClientRect === "function") {
        const rect = range.getBoundingClientRect();
        if (rect && isFiniteNumber(rect.top)) {
          const scrollY = isFiniteNumber(window.scrollY) ? window.scrollY : 0;
          return rect.top + scrollY;
        }
      }
    } catch (_) {
      // Fall through to the stored scroll position.
    }
    return null;
  }

  function buildPosition(anchor, y) {
    const range = resolveAnchor(anchor);
    const viewportOffset = caretViewportOffset(range, y);
    const scrollY = clampScrollY(isFiniteNumber(window.scrollY) ? window.scrollY : 0);
    const max = maxScrollY();
    const scrollRatio = max > 0 ? scrollY / max : 0;
    return {
      anchor: anchor,
      viewportOffset: viewportOffset,
      scrollY: scrollY,
      scrollRatio: scrollRatio,
      savedAt: Date.now()
    };
  }

  function capture(x, y) {
    const caret = caretFromPoint(x, y);
    if (!caret) return null;
    const range = rangeFromCaret(caret);
    if (!range) return null;
    const anchor = serializeRange(range);
    if (!anchor) return null;
    return buildPosition(anchor, y);
  }

  function resolvePosition(record, root) {
    if (!validatePosition(record)) return null;
    const range = resolveAnchor(record.anchor, root);
    if (range) {
      const docY = documentOffsetY(range);
      const target = docY == null ? record.scrollY : docY - record.viewportOffset;
      return { range: range, scrollY: clampScrollY(target), anchorResolved: true };
    }
    return { range: null, scrollY: clampScrollY(record.scrollY), anchorResolved: false };
  }

  window.ReadTrailPosition = {
    capture: capture,
    serializeNode: serializeNode,
    serializeRange: serializeRange,
    validateAnchor: validateAnchor,
    validatePosition: validatePosition,
    resolveAnchor: resolveAnchor,
    resolvePosition: resolvePosition
  };
})();
