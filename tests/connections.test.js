import { beforeEach, describe, expect, it } from "vitest";
import { readSource } from "./helpers/chrome-mock.js";

let C;

function record(id, overrides = {}) {
  return { id, kind: "passage", title: "", text: "", note: "", tags: [], url: "https://example.com/" + id, updatedAt: 1, ...overrides };
}

describe("connections", () => {
  beforeEach(() => {
    delete globalThis.ReadTrailSidePanel;
    window.eval(readSource("sidepanel/connections.js"));
    C = globalThis.ReadTrailSidePanel.connections;
  });

  it("finds shared tags, same domain, and backlinks, excluding the item itself", () => {
    const records = [
      record("self", { tags: ["focus", "memory"], text: "see https://other.example/ref for more", url: "https://a.example/self" }),
      record("tagged", { tags: ["focus"], url: "https://b.example/t", updatedAt: 3 }),
      record("double", { tags: ["focus", "memory"], url: "https://c.example/d", updatedAt: 2 }),
      record("domain", { url: "https://a.example/other" }),
      record("samepage", { url: "https://a.example/self", tags: ["focus"] }),
      record("linked", { url: "https://other.example/ref" }),
      record("linksback", { note: "from https://a.example/self", url: "https://d.example/x" }),
      record("unrelated", { url: "https://z.example/" })
    ];
    const result = C.connectionsFor(records, "self");
    expect(result.sameTag.map((c) => c.record.id)).toEqual(["double", "tagged", "samepage"]);
    expect(result.sameTag[0].via).toEqual(["focus", "memory"]);
    expect(result.sameDomain.map((c) => c.record.id)).toEqual(["domain"]);
    expect(result.backlinks.map((c) => c.record.id).sort()).toEqual(["linked", "linksback"]);
  });

  it("returns empty groups for unknown ids and respects the limit", () => {
    expect(C.connectionsFor([], "nope")).toEqual({ sameTag: [], sameDomain: [], backlinks: [] });
    const records = [record("self", { tags: ["t"] }), ...Array.from({ length: 12 }, (_, i) => record("r" + i, { tags: ["t"] }))];
    expect(C.connectionsFor(records, "self", 3).sameTag).toHaveLength(3);
    expect(C.connectionsFor(records, "self").sameTag).toHaveLength(8);
  });
});
