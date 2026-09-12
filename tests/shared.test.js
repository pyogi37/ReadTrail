import { beforeEach, describe, expect, it } from "vitest";
import { loadShared } from "./helpers/chrome-mock.js";

let S;

function position(overrides = {}) {
  return {
    anchor: { version: 1, path: [0, 1], offset: 2 },
    viewportOffset: 40,
    scrollY: 300,
    scrollRatio: 0.25,
    savedAt: 123,
    ...overrides
  };
}

describe("shared constants and validators", () => {
  beforeEach(() => {
    delete globalThis.ReadTrailShared;
    S = loadShared();
  });

  it("exposes frozen defaults, keys, and error codes on one namespace", () => {
    expect(Object.isFrozen(S.DEFAULTS)).toBe(true);
    expect(S.DEFAULTS).toEqual({
      style: "ruler",
      color: "#FF6B6B",
      size: 30,
      opacity: 0.3,
      dotCount: 20,
      fadeSpeed: 0.9,
      highlightLine: false,
      highlightColor: "#FFEB3B",
      closeSave: "ask",
      excludedHosts: []
    });
    expect(S.KEYS.TAB_PREFIX).toBe("readtrail.tab.v1:");
    expect(S.KEYS.SAVED_PREFIX).toBe("readtrail.saved.v1:");
    expect(S.ERRORS.PAGE_INACTIVE).toBe("page-inactive");
  });

  it("validates page URLs strictly", () => {
    expect(S.isValidPageUrl("https://example.com/a?b=1#c")).toBe(true);
    expect(S.isValidPageUrl("http://example.com/")).toBe(true);
    expect(S.isValidPageUrl("chrome://extensions")).toBe(false);
    expect(S.isValidPageUrl("https://example.com")).toBe(false); // not normalized
    expect(S.isValidPageUrl("")).toBe(false);
    expect(S.isValidPageUrl("x".repeat(9000))).toBe(false);
    expect(S.isValidPageUrl(42)).toBe(false);
  });

  it("validates and clones positions without leaking unknown fields", () => {
    const p = position({ extra: "no" });
    p.anchor.extra = "no";
    expect(S.isValidPosition(p)).toBe(true);
    expect(S.clonePosition(p)).toEqual(position());
    expect(S.isValidPosition(position({ scrollRatio: 2 }))).toBe(false);
    expect(S.isValidPosition(position({ anchor: { version: 1, path: [], offset: 0 } }))).toBe(false);
    expect(S.isValidPosition(position({ anchor: { version: 2, path: [0], offset: 0 } }))).toBe(false);
  });

  it("accepts anchor v2, clones every v2 field, and bounds landmark paths", () => {
    const v2 = {
      version: 2,
      path: [0, 3, 1],
      offset: 4,
      landmark: { id: "main", path: [2, 1] },
      check: { tag: "p", textLength: 120 }
    };
    expect(S.isValidAnchor(v2)).toBe(true);
    expect(S.isValidAnchor({ ...v2, landmark: null })).toBe(true);
    expect(S.isValidAnchor({ ...v2, check: undefined })).toBe(false);
    expect(S.isValidAnchor({ ...v2, landmark: { id: "x".repeat(257), path: [0] } })).toBe(false);
    expect(S.isValidAnchor({ ...v2, landmark: { id: "main", path: [] } })).toBe(false);
    expect(S.isValidAnchor({ ...v2, version: 3 })).toBe(false);

    const cloned = S.clonePosition(position({ anchor: { ...v2, extra: 1 } }));
    expect(cloned.anchor).toEqual(v2);
    expect(cloned.anchor.landmark).not.toBe(v2.landmark);

    expect(S.isValidSavedPosition(position({ anchor: v2 }))).toBe(true);
    expect(S.isValidSavedPosition(position({
      anchor: { ...v2, landmark: { id: "main", path: new Array(65).fill(0) } }
    }))).toBe(false);
    expect(S.cloneSavedRecord({ version: 1, title: "A", position: position({ anchor: v2 }), savedAt: 1 }).position.anchor)
      .toEqual(v2);
  });

  it("carries restoreQuality through tab records and page states only when valid", () => {
    const record = {
      version: 1, url: "https://example.com/a", title: "", active: true, mode: "following",
      position: null, incognito: false, origin: "user", updatedAt: 1, restoreQuality: "approximate"
    };
    expect(S.isValidTabRecord(record)).toBe(true);
    expect(S.isValidTabRecord({ ...record, restoreQuality: "perfect" })).toBe(false);
    expect(S.cloneTabRecord(record).restoreQuality).toBe("approximate");
    expect(S.clonePageState(record)).toEqual({
      version: 1, active: true, mode: "following", position: null, restoreQuality: "approximate"
    });
    const { restoreQuality: _drop, ...plain } = record;
    expect(S.clonePageState(plain)).not.toHaveProperty("restoreQuality");
  });

  it("bounds durable positions and titles", () => {
    expect(S.isValidSavedPosition(position())).toBe(true);
    expect(S.isValidSavedPosition(position({ anchor: { version: 1, path: new Array(65).fill(0), offset: 0 } }))).toBe(false);
    expect(S.isValidSavedPosition(position({ anchor: { version: 1, path: [100001], offset: 0 } }))).toBe(false);
    expect(S.isValidSavedRecord({ version: 1, title: "A", position: position(), savedAt: 1 })).toBe(true);
    expect(S.isValidSavedRecord({ version: 1, title: " A", position: position(), savedAt: 1 })).toBe(false);
    expect(S.isValidSavedRecord({ version: 1, title: "A".repeat(513), position: position(), savedAt: 1 })).toBe(false);
    expect(S.isValidSavedRecord({ version: 2, title: "A", position: position(), savedAt: 1 })).toBe(false);
  });

  it("validates and clones tab records", () => {
    const record = {
      version: 1,
      url: "https://example.com/a",
      title: "A",
      active: true,
      mode: "frozen",
      position: position(),
      incognito: false,
      origin: "continue",
      updatedAt: 5,
      extra: true
    };
    expect(S.isValidTabRecord(record)).toBe(true);
    const clone = S.cloneTabRecord(record);
    expect(clone).not.toHaveProperty("extra");
    expect(clone.position).not.toBe(record.position);
    expect(S.isValidTabRecord({ ...record, origin: "magic" })).toBe(false);
    expect(S.isValidTabRecord({ ...record, url: "about:blank" })).toBe(false);
    expect(S.isValidTabRecord({ ...record, incognito: "no" })).toBe(false);
    expect(S.clonePageState(record)).toEqual({ version: 1, active: true, mode: "frozen", position: position() });
  });

  it("validates settings patches and rejects unknown keys", () => {
    expect(S.isValidSettings({})).toBe(true);
    expect(S.isValidSettings({ style: "dots", size: 10, opacity: 1, dotCount: 50, fadeSpeed: 0.99 })).toBe(true);
    expect(S.isValidSettings({ size: "30" })).toBe(false);
    expect(S.isValidSettings({ color: "red" })).toBe(false);
    expect(S.isValidSettings({ style: "laser" })).toBe(false);
    expect(S.isValidSettings({ enabled: true })).toBe(false);
    expect(S.isValidSettings({ size: 101 })).toBe(false);
    expect(S.isValidSettings(null)).toBe(false);
    expect(S.isValidSettings([])).toBe(false);
  });

  it("validates, normalizes, and matches excluded hosts", () => {
    expect(S.normalizeHost(" WWW.Example.COM ")).toBe("example.com");
    expect(S.normalizeHost("https://Docs.example.org/path?q=1")).toBe("docs.example.org");
    expect(S.normalizeHost("not a host")).toBeNull();
    expect(S.normalizeHost("")).toBeNull();
    expect(S.isValidSettings({ excludedHosts: ["example.com", "a.b.c"] })).toBe(true);
    expect(S.isValidSettings({ excludedHosts: ["Example.com"] })).toBe(false);
    expect(S.isValidSettings({ excludedHosts: ["example.com", "example.com"] })).toBe(false);
    expect(S.isValidSettings({ excludedHosts: "example.com" })).toBe(false);
    expect(S.isHostExcluded("https://news.example.com/x", ["example.com"])).toBe(true);
    expect(S.isHostExcluded("https://www.example.com/", ["example.com"])).toBe(true);
    expect(S.isHostExcluded("https://notexample.com/", ["example.com"])).toBe(false);
    expect(S.isHostExcluded("https://example.com/", [])).toBe(false);
  });

  it("merges settings over defaults, dropping invalid stored values and legacy flags", () => {
    const merged = S.mergeSettings({ style: "dots", size: "bad", enabled: true }, { color: "#000000" });
    expect(merged).toEqual({ ...S.DEFAULTS, style: "dots", color: "#000000" });
    expect(S.mergeSettings(undefined, null)).toEqual(S.DEFAULTS);
  });
});
