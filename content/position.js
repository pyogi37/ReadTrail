(() => {
  "use strict";

  // Anchor v2 adds two structural hints on top of the v1 child-index path so a
  // position survives common page changes (injected banners, lazy blocks):
  //   landmark: nearest ancestor with an id attribute plus the path from it
  //   check:    tag of the text node's parent and the text node's length
  // Neither hint contains passage text. v1 anchors remain readable.
  const ANCHOR_VERSION = 2;
  const LANDMARK_ID_MAX = 256;
  // Ratio fallback is only trusted when the document height moved by more
  // than this fraction from the height implied at capture time.
  const HEIGHT_DRIFT_THRESHOLD = 0.15;

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function isNonNegativeInteger(value) {
    return Number.isInteger(value) && value >= 0;
  }

  function isIndexPath(value, allowEmpty) {
    if (!Array.isArray(value)) return false;
    if (value.length === 0 && !allowEmpty) return false;
    return value.every(isNonNegativeInteger);
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

  function isReadableCaret(caret) {
    return Boolean(
      caret &&
      caret.node &&
      caret.node.nodeType === Node.TEXT_NODE &&
      typeof caret.node.nodeValue === "string" &&
      caret.node.nodeValue.trim().length > 0
    );
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

  // Nearest ancestor (strictly inside root) carrying a usable id attribute.
  function findLandmark(node, root) {
    let current = node && node.parentNode;
    while (current && current !== root) {
      if (current.nodeType === Node.ELEMENT_NODE && typeof current.id === "string") {
        const id = current.id;
        if (id.length > 0 && id.length <= LANDMARK_ID_MAX) return current;
      }
      current = current.parentNode;
    }
    return null;
  }

  function buildCheck(node) {
    const parent = node.parentElement || node.parentNode;
    const tag = parent && typeof parent.tagName === "string" ? parent.tagName.toLowerCase() : "";
    return { tag: tag, textLength: leafLength(node) };
  }

  function serializeNode(node, offset, root) {
    if (!node || !isNonNegativeInteger(offset)) return null;
    const base = pickRoot(root);
    if (!base) return null;
    const path = pathToRoot(node, base);
    if (!path || path.length === 0) return null;
    if (offset > leafLength(node)) return null;
    let landmark = null;
    const landmarkElement = findLandmark(node, base);
    if (landmarkElement) {
      const landmarkPath = pathToRoot(node, landmarkElement);
      if (landmarkPath && landmarkPath.length > 0) {
        landmark = { id: landmarkElement.id, path: landmarkPath };
      }
    }
    return {
      version: ANCHOR_VERSION,
      path: path,
      offset: offset,
      landmark: landmark,
      check: buildCheck(node)
    };
  }

  function serializeRange(range, root) {
    if (!range || !range.startContainer) return null;
    return serializeNode(range.startContainer, range.startOffset, root);
  }

  function validateLandmark(landmark) {
    if (landmark === null) return true;
    if (!landmark || typeof landmark !== "object") return false;
    if (typeof landmark.id !== "string" || landmark.id.length === 0 || landmark.id.length > LANDMARK_ID_MAX) return false;
    return isIndexPath(landmark.path, false);
  }

  function validateCheck(check) {
    return Boolean(check)
      && typeof check === "object"
      && typeof check.tag === "string"
      && isNonNegativeInteger(check.textLength);
  }

  function validateAnchor(anchor) {
    if (!anchor || typeof anchor !== "object") return false;
    if (!isIndexPath(anchor.path, false)) return false;
    if (!isNonNegativeInteger(anchor.offset)) return false;
    if (anchor.version === 1) return true;
    if (anchor.version !== ANCHOR_VERSION) return false;
    return validateLandmark(anchor.landmark) && validateCheck(anchor.check);
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

  function walkPath(start, path) {
    let node = start;
    for (const index of path) {
      if (!node || !node.childNodes || index >= node.childNodes.length) return null;
      node = node.childNodes[index];
    }
    return node || null;
  }

  function passesCheck(node, check) {
    if (!node) return false;
    const actual = buildCheck(node);
    return actual.tag === check.tag && actual.textLength === check.textLength;
  }

  function landmarkElement(landmark, base) {
    if (!landmark || typeof document.getElementById !== "function") return null;
    let element = null;
    try {
      element = document.getElementById(landmark.id);
    } catch (_) {
      return null;
    }
    if (!element || element === base) return null;
    if (typeof base.contains === "function" && !base.contains(element)) return null;
    return element;
  }

  // Returns the node an anchor points at, or null. v2 anchors try the landmark
  // path first, then the body path; each candidate must satisfy the check.
  function resolveNode(anchor, base) {
    if (anchor.version === 1) {
      return walkPath(base, anchor.path);
    }
    const viaLandmark = landmarkElement(anchor.landmark, base);
    if (viaLandmark) {
      const candidate = walkPath(viaLandmark, anchor.landmark.path);
      if (candidate && passesCheck(candidate, anchor.check)) return candidate;
    }
    const candidate = walkPath(base, anchor.path);
    return candidate && passesCheck(candidate, anchor.check) ? candidate : null;
  }

  function resolveAnchor(anchor, root) {
    if (!validateAnchor(anchor)) return null;
    const base = pickRoot(root);
    if (!base) return null;
    const node = resolveNode(anchor, base);
    if (!node) return null;
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
        if (rect && isFiniteNumber(rect.top)) {
          const height = isFiniteNumber(rect.height) && rect.height > 0 ? rect.height : 0;
          top = rect.top + (height / 2);
        }
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
          const height = isFiniteNumber(rect.height) && rect.height > 0 ? rect.height : 0;
          return rect.top + (height / 2) + scrollY;
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
    if (!isReadableCaret(caret)) return null;
    const range = rangeFromCaret(caret);
    if (!range) return null;
    const anchor = serializeRange(range);
    if (!anchor) return null;
    return buildPosition(anchor, y);
  }

  // When the anchor is gone, prefer the proportional position if the page got
  // noticeably longer or shorter since capture; otherwise the stored pixel
  // offset is the better guess.
  function fallbackScroll(record) {
    const max = maxScrollY();
    const impliedMax = record.scrollRatio > 0 ? record.scrollY / record.scrollRatio : null;
    if (impliedMax && impliedMax > 0 && max > 0) {
      const drift = Math.abs(max - impliedMax) / impliedMax;
      if (drift > HEIGHT_DRIFT_THRESHOLD) {
        return { scrollY: clampScrollY(record.scrollRatio * max), restoreQuality: "approximate" };
      }
    }
    return { scrollY: clampScrollY(record.scrollY), restoreQuality: "fallback" };
  }

  function resolvePosition(record, root) {
    if (!validatePosition(record)) return null;
    const range = resolveAnchor(record.anchor, root);
    if (range) {
      const docY = documentOffsetY(range);
      const target = docY == null ? record.scrollY : docY - record.viewportOffset;
      return { range: range, scrollY: clampScrollY(target), anchorResolved: true, restoreQuality: "exact" };
    }
    const fallback = fallbackScroll(record);
    return { range: null, scrollY: fallback.scrollY, anchorResolved: false, restoreQuality: fallback.restoreQuality };
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
