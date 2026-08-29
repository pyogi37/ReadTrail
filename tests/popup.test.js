import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const html = fs.readFileSync(path.join(root, "popup/popup.html"), "utf8");

describe("ReadTrail popup", () => {
  it("has a named toggle and semantic settings action", () => {
    document.documentElement.innerHTML = html;

    const toggle = document.querySelector("#toggleSwitch");
    const label = toggle.closest("label");
    expect(label.getAttribute("aria-label")).toBe("Enable ReadTrail");
    expect(document.querySelector("#openOptions").tagName).toBe("BUTTON");
    expect(document.querySelector("h1").textContent).toBe("ReadTrail");
  });
});
