import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSource } from "./helpers/chrome-mock.js";

describe("passage capture and highlights", () => {
  let PS;

  beforeEach(() => {
    document.body.innerHTML = '<article id="a"><p id="p1">First sentence here.</p><p id="p2">Second sentence there.</p></article>';
    delete globalThis.ReadTrailShared;
    window.eval(readSource("shared/constants.js"));
    window.eval(readSource("content/position.js"));
    window.eval(readSource("content/passage.js"));
    PS = window.ReadTrailPassage;
    window.getSelection().removeAllRanges();
    delete globalThis.Highlight;
    delete globalThis.CSS;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("captures the current selection as text plus start and end anchors, never more", () => {
    const first = document.querySelector("#p1").firstChild;
    const second = document.querySelector("#p2").firstChild;
    const range = document.createRange();
    range.setStart(first, 6);
    range.setEnd(second, 6);
    window.getSelection().addRange(range);
    document.title = "Article";

    const captured = PS.captureSelection();
    expect(captured.ok).toBe(true);
    // Chrome joins blocks with a newline (normalized to one space); JSDOM joins
    // them with nothing. Compare without whitespace so both agree.
    expect(captured.text.replace(/\s/g, "")).toBe("sentencehere.Second");
    expect(captured.start).toEqual(expect.objectContaining({ version: 2, offset: 6, landmark: { id: "p1", path: [0] } }));
    expect(captured.end).toEqual(expect.objectContaining({ version: 2, offset: 6, landmark: { id: "p2", path: [0] } }));
    expect(captured.url).toBe(location.href);
    expect(captured.title).toBe("Article");
    expect(Object.keys(captured).sort()).toEqual(["end", "ok", "start", "text", "title", "url"]);
  });

  it("refuses empty, collapsed, and oversized selections", () => {
    expect(PS.captureSelection()).toEqual({ ok: false, error: "no-selection" });
    const first = document.querySelector("#p1").firstChild;
    const collapsed = document.createRange();
    collapsed.setStart(first, 2);
    collapsed.collapse(true);
    window.getSelection().addRange(collapsed);
    expect(PS.captureSelection()).toEqual({ ok: false, error: "no-selection" });

    document.body.innerHTML = `<p id="big">${"x".repeat(4100)}</p>`;
    const big = document.querySelector("#big").firstChild;
    const wide = document.createRange();
    wide.setStart(big, 0);
    wide.setEnd(big, 4100);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(wide);
    expect(PS.captureSelection()).toEqual({ ok: false, error: "too-long" });
  });

  it("draws highlights with the CSS Custom Highlight API when available and skips broken anchors", () => {
    const first = document.querySelector("#p1").firstChild;
    const start = window.ReadTrailPosition.serializeNode(first, 0);
    const end = window.ReadTrailPosition.serializeNode(first, 5);
    const set = vi.fn();
    const del = vi.fn();
    class FakeHighlight { constructor(...ranges) { this.ranges = ranges; } }
    vi.stubGlobal("Highlight", FakeHighlight);
    vi.stubGlobal("CSS", { highlights: { set, delete: del } });

    const drawn = PS.applyHighlights([
      { start, end },
      { start, end: { version: 1, path: [9, 9], offset: 0 } },
      { start: null, end: null }
    ]);
    expect(drawn).toBe(1);
    expect(set).toHaveBeenCalledWith("readtrail-passage", expect.any(FakeHighlight));
    expect(set.mock.calls[0][1].ranges[0].toString()).toBe("First");

    expect(PS.applyHighlights([])).toBe(0);
    expect(del).toHaveBeenCalledWith("readtrail-passage");
    PS.clearHighlights();
    expect(del).toHaveBeenCalledTimes(2);
  });

  it("is a no-op without the highlight API", () => {
    expect(PS.applyHighlights([{ start: { version: 1, path: [0], offset: 0 }, end: { version: 1, path: [0], offset: 1 } }])).toBe(0);
    expect(() => PS.clearHighlights()).not.toThrow();
  });

  describe("returning to a saved clip", () => {
    const highlightSpies = () => {
      const set = vi.fn();
      const del = vi.fn();
      class FakeHighlight { constructor(...ranges) { this.ranges = ranges; } }
      vi.stubGlobal("Highlight", FakeHighlight);
      vi.stubGlobal("CSS", { highlights: { set, delete: del } });
      return { set, del };
    };

    beforeEach(() => {
      window.scrollTo = vi.fn();
      // JSDOM does not implement Range.getBoundingClientRect; without it the
      // scroll step fails safely and the test could not see it happen.
      Object.defineProperty(Range.prototype, "getBoundingClientRect", {
        configurable: true,
        value: () => ({ top: 500, height: 20, bottom: 520, left: 0, right: 0, width: 0 })
      });
    });

    it("reports exact only when the anchored text still matches what was saved", () => {
      const { set } = highlightSpies();
      const node = document.querySelector("#p1").firstChild;
      const start = window.ReadTrailPosition.serializeNode(node, 0);
      const end = window.ReadTrailPosition.serializeNode(node, 5);

      expect(PS.revealPassage(start, end, "First")).toEqual({ quality: "exact" });
      expect(set).toHaveBeenCalledWith("readtrail-reveal", expect.anything());
      expect(window.scrollTo).toHaveBeenCalled();
    });

    it("falls back to searching the page text when the anchors resolve to different words", () => {
      highlightSpies();
      const node = document.querySelector("#p1").firstChild;
      const start = window.ReadTrailPosition.serializeNode(node, 0);
      const end = window.ReadTrailPosition.serializeNode(node, 5);
      // The anchors still resolve, but they now point at other text: an equal
      // length rewrite must never be reported as an exact match.
      expect(PS.revealPassage(start, end, "Second sentence")).toEqual({ quality: "approximate" });
    });

    it("finds the clip by its words when the anchors no longer resolve", () => {
      highlightSpies();
      const broken = { version: 1, path: [99, 99], offset: 0 };
      expect(PS.revealPassage(broken, broken, "Second sentence there.")).toEqual({ quality: "approximate" });
    });

    it("says the passage is missing rather than scrolling somewhere arbitrary", () => {
      highlightSpies();
      const broken = { version: 1, path: [99, 99], offset: 0 };
      expect(PS.revealPassage(broken, broken, "words that are not on this page")).toEqual({ quality: "missing" });
      expect(window.scrollTo).not.toHaveBeenCalled();
    });

    it("matches text the page wraps differently, because capture collapsed whitespace", () => {
      highlightSpies();
      document.body.innerHTML = '<p id="w">Wrapped\n   across   lines</p>';
      const broken = { version: 1, path: [99], offset: 0 };
      expect(PS.revealPassage(broken, broken, "Wrapped across lines")).toEqual({ quality: "approximate" });
    });

    it("finds unchanged text spanning adjacent block elements", () => {
      highlightSpies();
      const broken = { version: 1, path: [99], offset: 0 };
      expect(PS.revealPassage(broken, broken, "sentence here. Second sentence"))
        .toEqual({ quality: "approximate" });
    });

    // The walker used to read every text node in the body, so a clip whose
    // paragraph had been deleted could be "found" in markup nobody can see and
    // reported as approximate, with the scroll landing on nothing.
    it.each([
      ["a hidden element", '<p id="gone">Nothing here.</p><div hidden>Second sentence there.</div>'],
      ["a display:none element", '<p id="gone">Nothing here.</p><div style="display:none">Second sentence there.</div>'],
      ["a script tag", '<p id="gone">Nothing here.</p><script type="text/plain">Second sentence there.</script>'],
      ["an aria-hidden element", '<p id="gone">Nothing here.</p><div aria-hidden="true">Second sentence there.</div>']
    ])("refuses to find the clip in %s", (_label, markup) => {
      highlightSpies();
      document.body.innerHTML = markup;
      const broken = { version: 1, path: [99, 99], offset: 0 };
      expect(PS.revealPassage(broken, broken, "Second sentence there.")).toEqual({ quality: "missing" });
      expect(window.scrollTo).not.toHaveBeenCalled();
    });

    it("still finds the clip when the same words are also present but hidden", () => {
      highlightSpies();
      document.body.innerHTML = '<div hidden>Second sentence there.</div><p id="real">Second sentence there.</p>';
      const broken = { version: 1, path: [99, 99], offset: 0 };
      expect(PS.revealPassage(broken, broken, "Second sentence there.")).toEqual({ quality: "approximate" });
    });

    it("clears the flash and works without the highlight API", () => {
      const { del } = highlightSpies();
      PS.clearReveal();
      expect(del).toHaveBeenCalledWith("readtrail-reveal");
      vi.unstubAllGlobals();
      const broken = { version: 1, path: [99], offset: 0 };
      expect(() => PS.revealPassage(broken, broken, "Second sentence there.")).not.toThrow();
    });
  });
});
