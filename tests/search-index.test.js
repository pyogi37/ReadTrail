import { beforeEach, describe, expect, it } from "vitest";
import { readSource } from "./helpers/chrome-mock.js";

let SI;

function record(id, overrides = {}) {
  return { id, kind: "passage", title: "", text: "", note: "", tags: [], url: "https://example.com/" + id, updatedAt: 1, ...overrides };
}

describe("search index", () => {
  beforeEach(() => {
    delete globalThis.ReadTrailSidePanel;
    window.eval(readSource("sidepanel/search-index.js"));
    SI = globalThis.ReadTrailSidePanel.searchIndex;
  });

  it("tokenizes unicode words, lowercases, and drops single characters", () => {
    expect(SI.tokenize("Deep Work, by Cal Newport (2016) — Über a b")).toEqual(["deep", "work", "by", "cal", "newport", "2016", "über"]);
    expect(SI.tokenize("")).toEqual([]);
    expect(SI.tokenize(null)).toEqual([]);
  });

  it("ranks title and tag matches above note matches above text matches", () => {
    const index = SI.buildIndex([
      record("text", { text: "attention is scarce" }),
      record("note", { note: "attention matters" }),
      record("title", { title: "Attention" }),
      record("tag", { tags: ["attention"] }),
      record("none", { text: "nothing here" })
    ]);
    const ids = SI.search(index, "attention").map((r) => r.id);
    expect(ids.slice(0, 2).sort()).toEqual(["tag", "title"]);
    expect(ids[2]).toBe("note");
    expect(ids[3]).toBe("text");
    expect(ids).not.toContain("none");
  });

  it("supports prefix matching, requires every term, and boosts exact tokens", () => {
    const index = SI.buildIndex([
      record("a", { text: "reading retention" }),
      record("b", { text: "reading habits" }),
      record("c", { text: "read once" })
    ]);
    expect(SI.search(index, "read").map((r) => r.id)[0]).toBe("c"); // exact token wins
    expect(SI.search(index, "reading reten").map((r) => r.id)).toEqual(["a"]);
    expect(SI.search(index, "reading zebra")).toEqual([]);
    expect(SI.search(index, "")).toEqual([]);
  });

  it("searches page URLs and keeps tag-only pages in the index", () => {
    const records = SI.recordsFromLibrary({
      saved: [], passages: [], notes: [],
      pagemeta: [{ url: "https://research.example.com/topic", tags: ["later"], updatedAt: 4 }]
    });
    expect(records).toHaveLength(1);
    const index = SI.buildIndex(records);
    expect(SI.search(index, "research")[0].record.url).toBe("https://research.example.com/topic");
    expect(SI.search(index, "later")[0].record.url).toBe("https://research.example.com/topic");
  });

  it("breaks ties by recency and honors the limit", () => {
    const index = SI.buildIndex([
      record("old", { text: "focus", updatedAt: 1 }),
      record("new", { text: "focus", updatedAt: 9 }),
      record("mid", { text: "focus", updatedAt: 5 })
    ]);
    expect(SI.search(index, "focus").map((r) => r.id)).toEqual(["new", "mid", "old"]);
    expect(SI.search(index, "focus", 2)).toHaveLength(2);
  });

  it("flattens a library reply and indexes page tags instead of item tags", () => {
    const records = SI.recordsFromLibrary({
      saved: [{ url: "https://a.example/x", title: "Saved X", savedAt: 3 }],
      passages: [{ id: "p1", url: "https://a.example/x", title: "Saved X", text: "t", note: "n", tags: ["own"], updatedAt: 2 }],
      notes: [{ id: "n1", url: "https://b.example/y", title: "", text: "note", tags: [], updatedAt: 1 }],
      pagemeta: [{ url: "https://a.example/x", tags: ["page"] }]
    });
    expect(records.map((r) => r.id)).toEqual(["saved:https://a.example/x", "p1", "n1"]);
    expect(records[1].tags).toEqual(["page"]);
    expect(records[0].tags).toEqual(["page"]);
    expect(records[2].tags).toEqual([]);
  });

  it("searches 1,500 items in well under 50 ms", () => {
    const words = ["attention", "memory", "reading", "focus", "habit", "note", "chapter", "idea", "essay", "science"];
    const records = [];
    for (let i = 0; i < 1500; i++) {
      const text = Array.from({ length: 60 }, (_, j) => words[(i * 7 + j * 3) % words.length] + (j % 5)).join(" ");
      records.push(record("r" + i, { title: "Item " + i, text, tags: [words[i % words.length]], updatedAt: i }));
    }
    const index = SI.buildIndex(records);
    const started = performance.now();
    const results = SI.search(index, "read", 20);
    const elapsed = performance.now() - started;
    expect(results.length).toBe(20);
    expect(elapsed).toBeLessThan(50);
  });
});
