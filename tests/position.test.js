import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const script = fs.readFileSync(path.join(root, "content/position.js"), "utf8");

function loadPosition() {
  window.eval(script);
  return window.ReadTrailPosition;
}

// JSDOM declares none of caretPositionFromPoint, caretRangeFromPoint, or
// Range.getBoundingClientRect, so install them per-test via defineProperty.
function setCaretPosition(mock) {
  Object.defineProperty(document, "caretPositionFromPoint", {
    configurable: true,
    value: vi.fn(mock)
  });
}

function setCaretRange(mock) {
  Object.defineProperty(document, "caretRangeFromPoint", {
    configurable: true,
    value: vi.fn(mock)
  });
}

describe("ReadTrail position anchor module", () => {
  let position;

  beforeEach(() => {
    // Single-line markup so JSDOM doesn't insert whitespace text nodes,
    // keeping child-node indices deterministic for path assertions.
    document.body.innerHTML =
      '<div id="section"><p id="first">Hello world</p><p id="second"><span>Nested</span> text</p></div>';
    window.eval(script);
    position = window.ReadTrailPosition;
  });

  it("captures a caret via caretPositionFromPoint and returns a valid record without page text", () => {
    const first = document.querySelector("#first");
    const text = first.firstChild;
    setCaretPosition(() => ({ offsetNode: text, offset: 5 }));

    const record = position.capture(120, 40);

    expect(record).not.toBeNull();
    expect(position.validatePosition(record)).toBe(true);
    // Anchor is versioned and contains child-node indices, an offset, a
    // landmark (nearest ancestor id), and a structural check. Never text.
    expect(record.anchor).toEqual({
      version: 2,
      path: [0, 0, 0],
      offset: 5,
      landmark: { id: "first", path: [0] },
      check: { tag: "p", textLength: 11 }
    });
    // Serialized record never contains passage text.
    expect(JSON.stringify(record)).not.toContain("Hello");
    expect(record.viewportOffset).toBe(40);
    expect(Number.isFinite(record.scrollY)).toBe(true);
    expect(Number.isFinite(record.scrollRatio)).toBe(true);
    expect(Number.isFinite(record.savedAt)).toBe(true);
    expect(record.savedAt).toBeGreaterThan(0);
  });

  it("falls back to caretRangeFromPoint when caretPositionFromPoint is unavailable", () => {
    const second = document.querySelector("#second");
    const text = second.lastChild;
    setCaretPosition(undefined);
    setCaretRange(() => ({ startContainer: text, startOffset: 2 }));

    const record = position.capture(80, 60);

    expect(record).not.toBeNull();
    expect(position.validatePosition(record)).toBe(true);
    expect(record.viewportOffset).toBe(60);
  });

  it("snaps the saved marker to the visual center of the text line", () => {
    const first = document.querySelector("#first");
    const text = first.firstChild;
    setCaretPosition(() => ({ offsetNode: text, offset: 5 }));
    const originalCreateRange = document.createRange.bind(document);
    vi.spyOn(document, "createRange").mockImplementation(() => {
      const range = originalCreateRange();
      Object.defineProperty(range, "getBoundingClientRect", {
        configurable: true,
        value: () => ({ top: 32, height: 20 })
      });
      return range;
    });

    const record = position.capture(120, 80);

    expect(record.viewportOffset).toBe(42);
  });

  it("fails safely to null when caret APIs, nodes, or layout are unavailable", () => {
    setCaretPosition(undefined);
    setCaretRange(undefined);
    expect(position.capture(10, 10)).toBeNull();

    setCaretPosition(() => null);
    setCaretRange(() => null);
    expect(position.capture(10, 10)).toBeNull();

    // Caret on a node outside body yields no serializable anchor.
    const detached = document.createElement("div");
    setCaretPosition(() => ({ offsetNode: detached, offset: 0 }));
    setCaretRange(undefined);
    expect(position.capture(10, 10)).toBeNull();
  });

  it("rejects element and whitespace carets as non-readable positions", () => {
    const first = document.querySelector("#first");
    setCaretPosition(() => ({ offsetNode: first, offset: 0 }));
    expect(position.capture(10, 10)).toBeNull();

    const whitespace = document.createTextNode("   \n  ");
    first.appendChild(whitespace);
    setCaretPosition(() => ({ offsetNode: whitespace, offset: 1 }));
    expect(position.capture(10, 10)).toBeNull();
  });

  it("rejects untrusted position records strictly", () => {
    const good = {
      anchor: { version: 1, path: [0, 1, 0], offset: 2 },
      viewportOffset: 5,
      scrollY: 0,
      scrollRatio: 0,
      savedAt: Date.now()
    };
    expect(position.validatePosition(good)).toBe(true);

    expect(position.validatePosition(null)).toBe(false);
    expect(position.validatePosition({})).toBe(false);
    expect(position.validatePosition({ ...good, anchor: null })).toBe(false);
    expect(position.validatePosition({ ...good, anchor: { version: 2, path: [0], offset: 1 } })).toBe(false);
    expect(position.validatePosition({ ...good, anchor: { version: 3, path: [0], offset: 1 } })).toBe(false);
    expect(position.validatePosition({
      ...good,
      anchor: { version: 2, path: [0], offset: 1, landmark: null, check: { tag: "p", textLength: 3 } }
    })).toBe(true);
    expect(position.validatePosition({
      ...good,
      anchor: { version: 2, path: [0], offset: 1, landmark: { id: "", path: [0] }, check: { tag: "p", textLength: 3 } }
    })).toBe(false);
    expect(position.validatePosition({ ...good, anchor: { version: 1, path: [], offset: 1 } })).toBe(false);
    expect(position.validatePosition({ ...good, anchor: { version: 1, path: [-1], offset: 1 } })).toBe(false);
    expect(position.validatePosition({ ...good, anchor: { version: 1, path: [0], offset: -2 } })).toBe(false);
    expect(position.validatePosition({ ...good, anchor: { version: 1, path: [0.5], offset: 1 } })).toBe(false);
    expect(position.validatePosition({ ...good, viewportOffset: Infinity })).toBe(false);
    expect(position.validatePosition({ ...good, scrollY: "0" })).toBe(false);
    expect(position.validatePosition({ ...good, scrollY: -1 })).toBe(false);
    expect(position.validatePosition({ ...good, scrollRatio: NaN })).toBe(false);
    expect(position.validatePosition({ ...good, scrollRatio: -0.1 })).toBe(false);
    expect(position.validatePosition({ ...good, scrollRatio: 1.1 })).toBe(false);
    expect(position.validatePosition({ ...good, savedAt: undefined })).toBe(false);
    expect(position.validatePosition({ ...good, savedAt: -1 })).toBe(false);
  });

  it("still resolves legacy v1 anchors by body path", () => {
    const text = document.querySelector("#second").lastChild;
    const range = position.resolveAnchor({ version: 1, path: [0, 1, 1], offset: 2 });
    expect(range).not.toBeNull();
    expect(range.startContainer).toBe(text);
    expect(range.startOffset).toBe(2);
  });

  it("resolves through the landmark after nodes are inserted before it", () => {
    const text = document.querySelector("#second").lastChild;
    const anchor = position.serializeNode(text, 3);
    expect(anchor.landmark).toEqual({ id: "second", path: [1] });

    // A cookie banner and a script are injected ahead of the article.
    document.body.insertAdjacentHTML("afterbegin", '<div class="banner">Accept cookies</div><script></script>');
    expect(document.body.childNodes[0].className).toBe("banner");

    const range = position.resolveAnchor(anchor);
    expect(range).not.toBeNull();
    expect(range.startContainer).toBe(text);
    expect(range.startOffset).toBe(3);
  });

  it("rejects a candidate that fails the structural check instead of returning the wrong node", () => {
    const text = document.querySelector("#first").firstChild;
    const anchor = position.serializeNode(text, 2);

    // Same paths, different text length: the paragraph was rewritten.
    text.nodeValue = "Completely different paragraph";
    expect(position.resolveAnchor(anchor)).toBeNull();

    // Landmark removed and body path now lands on a different element type.
    document.body.innerHTML = '<div><h1>Hello world</h1><p>x</p></div>';
    expect(position.resolveAnchor(anchor)).toBeNull();
  });

  it("resolves a valid anchor back to a collapsed Range at the right node and offset", () => {
    const second = document.querySelector("#second");
    const text = second.lastChild;
    const anchor = position.serializeNode(text, 3);
    expect(position.validateAnchor(anchor)).toBe(true);

    const range = position.resolveAnchor(anchor);
    expect(range).not.toBeNull();
    expect(range.collapsed).toBe(true);
    expect(range.startContainer).toBe(text);
    expect(range.startOffset).toBe(3);
    expect(range.endOffset).toBe(3);
  });

  it("returns null for an anchor whose node path or offset is out of bounds", () => {
    expect(position.resolveAnchor({ version: 1, path: [0, 1, 5], offset: 0 })).toBeNull();
    expect(position.resolveAnchor({ version: 1, path: [0, 0, 0], offset: 99 })).toBeNull();
    expect(position.serializeNode(document.querySelector("#first").firstChild, 99)).toBeNull();
    expect(position.resolveAnchor({ version: 1, path: [0, 0, 0], offset: 1 }, null)).toBeNull();
  });

  it("falls back to the clamped stored scroll position when the anchor cannot resolve", () => {
    // Empty document: max scroll is 0, so any stored scroll clamps to 0.
    document.body.innerHTML = "";
    const record = {
      anchor: { version: 1, path: [0, 1, 0], offset: 2 },
      viewportOffset: 40,
      scrollY: 250,
      scrollRatio: 0.5,
      savedAt: Date.now()
    };
    const result = position.resolvePosition(record, document.body);

    expect(result).not.toBeNull();
    expect(result.anchorResolved).toBe(false);
    expect(result.range).toBeNull();
    expect(result.scrollY).toBe(0);
  });

  it("reports restore quality and prefers the scroll ratio when the page height drifted", () => {
    document.body.innerHTML = "";
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 4000 });
    const max = 4000 - window.innerHeight;
    // Captured when the document allowed 1000px of scroll, at 25%.
    const drifted = {
      anchor: { version: 1, path: [0, 1, 0], offset: 2 },
      viewportOffset: 40,
      scrollY: 250,
      scrollRatio: 0.25,
      savedAt: Date.now()
    };
    const approx = position.resolvePosition(drifted, document.body);
    expect(approx.anchorResolved).toBe(false);
    expect(approx.restoreQuality).toBe("approximate");
    expect(approx.scrollY).toBe(0.25 * max);

    // Captured when the document allowed roughly the same scroll range.
    const stable = { ...drifted, scrollY: Math.round(max * 0.25), scrollRatio: 0.25 };
    const fallback = position.resolvePosition(stable, document.body);
    expect(fallback.restoreQuality).toBe("fallback");
    expect(fallback.scrollY).toBe(Math.round(max * 0.25));

    // A ratio of zero carries no information: plain fallback.
    const zero = { ...drifted, scrollY: 0, scrollRatio: 0 };
    expect(position.resolvePosition(zero, document.body).restoreQuality).toBe("fallback");
  });

  it("clamps the fallback scroll position to the document's valid range", () => {
    document.body.innerHTML = "";
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 2000
    });

    const record = {
      anchor: { version: 1, path: [0, 1, 0], offset: 2 },
      viewportOffset: 40,
      scrollY: 99999,
      scrollRatio: 1,
      savedAt: Date.now()
    };
    const high = position.resolvePosition(record, document.body);
    expect(high.anchorResolved).toBe(false);
    expect(high.scrollY).toBe(2000 - window.innerHeight);

    const zero = position.resolvePosition({ ...record, scrollY: 0 }, document.body);
    expect(zero.scrollY).toBe(0);
  });

  it("recomputes a clamped scroll target from a resolved anchor and layout", () => {
    const first = document.querySelector("#first");
    const text = first.firstChild;
    const anchor = position.serializeNode(text, 2);
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 2000
    });

    const range = document.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    Object.defineProperty(range, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 100, height: 20 })
    });
    const originalCreateRange = document.createRange.bind(document);
    vi.spyOn(document, "createRange").mockImplementation(() => {
      const r = originalCreateRange();
      Object.defineProperty(r, "getBoundingClientRect", {
        configurable: true,
        value: () => ({ top: 100, height: 20 })
      });
      return r;
    });

    const record = {
      anchor,
      viewportOffset: 60,
      scrollY: 30,
      scrollRatio: 0.1,
      savedAt: Date.now()
    };
    const result = position.resolvePosition(record, document.body);
    expect(result).not.toBeNull();
    expect(result.anchorResolved).toBe(true);
    expect(result.restoreQuality).toBe("exact");
    expect(result.range).not.toBeNull();
    // target = anchor line center (110) - viewportOffset (60) = 50, within range.
    expect(result.scrollY).toBe(50);
    expect(range).not.toBeUndefined();
  });
});
