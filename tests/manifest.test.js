import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

describe("ReadTrail manifest integration", () => {
  it("uses only the permissions required for local page activation and the side panel", () => {
    expect(manifest.permissions).toEqual(["storage", "activeTab", "sidePanel", "contextMenus"]);
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest.permissions).not.toContain("tabs");
    expect(manifest.permissions).not.toContain("notifications");
  });

  it("opens the side panel from the toolbar action instead of a popup", () => {
    expect(manifest.action).not.toHaveProperty("default_popup");
    expect(manifest.action.default_title).toBe("ReadTrail");
    expect(manifest.side_panel).toEqual({ default_path: "sidepanel/sidepanel.html" });
    expect(manifest.minimum_chrome_version).toBe("114");
  });

  it("loads shared constants and position capture before the lifecycle content script", () => {
    const scripts = manifest.content_scripts[0].js;

    expect(scripts).toEqual([
      "shared/constants.js",
      "content/renderer.js",
      "content/position.js",
      "content/passage.js",
      "content/content.js"
    ]);
  });

  it("keeps the service worker a classic script so importScripts can load shared modules", () => {
    expect(manifest.background.service_worker).toBe("background/service-worker.js");
    expect(manifest.background).not.toHaveProperty("type");
  });

  it("describes the reading-position product instead of a cursor effect", () => {
    expect(manifest.description).toContain("remembers your place");
    expect(manifest.description.toLowerCase()).not.toContain("cursor trail");
  });
});
