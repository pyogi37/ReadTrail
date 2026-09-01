import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

describe("ReadTrail manifest integration", () => {
  it("uses only the permissions required for local page activation", () => {
    expect(manifest.permissions).toEqual(["storage", "activeTab"]);
    expect(manifest).not.toHaveProperty("host_permissions");
  });

  it("loads position capture before the lifecycle content script", () => {
    const scripts = manifest.content_scripts[0].js;

    expect(scripts).toEqual([
      "content/renderer.js",
      "content/position.js",
      "content/content.js"
    ]);
  });

  it("describes the reading-position product instead of a cursor effect", () => {
    expect(manifest.description).toContain("remembers your place");
    expect(manifest.description.toLowerCase()).not.toContain("cursor trail");
  });
});
