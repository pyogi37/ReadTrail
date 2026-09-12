import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ALLOW_LIST, build, check, collectFiles, listZipEntries } from "../scripts/package.mjs";

describe("production package", () => {
  it("passes its own checks against the working tree", () => {
    const { problems, files } = check();
    expect(problems).toEqual([]);
    expect(files).toContain("manifest.json");
    expect(files).toContain("background/service-worker.js");
    expect(files).toContain("sidepanel/sidepanel.html");
  });

  it("ships only allow-listed files and never tests, docs, or tooling", () => {
    const files = collectFiles();
    for (const file of files) {
      expect(ALLOW_LIST.some((entry) => file === entry || file.startsWith(`${entry}/`))).toBe(true);
    }
    const forbidden = /^(tests|docs|node_modules|scripts|\.opencode|\.git|dist)(\/|$)|package(-lock)?\.json$|AGENTS\.md|CLAUDE\.md|README\.md/;
    expect(files.filter((file) => forbidden.test(file))).toEqual([]);
  });

  it("writes a zip whose central directory lists exactly the shipped files", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "readtrail-pkg-"));
    try {
      const { target, files } = build(outDir);
      expect(fs.existsSync(target)).toBe(true);
      expect(path.basename(target)).toMatch(/^readtrail-\d+\.\d+\.\d+\.zip$/);
      const entries = listZipEntries(fs.readFileSync(target));
      expect(entries.sort()).toEqual([...files].sort());
      expect(entries.some((name) => /^(tests|docs|node_modules|\.opencode)\//.test(name))).toBe(false);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
