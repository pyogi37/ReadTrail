#!/usr/bin/env node
// Builds the Chrome Web Store zip from an explicit allow-list, with no
// dependencies. `--check` validates without writing: versions agree, every
// file the manifest references exists, every script parses, and nothing
// outside the allow-list would ship.
//
//   node scripts/package.mjs            -> dist/readtrail-<version>.zip
//   node scripts/package.mjs --check    -> exit 1 on any problem
//   node scripts/package.mjs --out DIR  -> write the zip into DIR
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Only these paths ship. Directories are included recursively.
export const ALLOW_LIST = [
  "manifest.json",
  "icons",
  "background",
  "content",
  "shared",
  "sidepanel",
  "options"
];

const SHIPPABLE_EXTENSIONS = new Set([".json", ".js", ".css", ".html", ".png", ".svg"]);

function walk(relative, out) {
  const absolute = path.join(ROOT, relative);
  const stat = fs.statSync(absolute);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(absolute).sort()) walk(path.posix.join(relative, entry), out);
    return;
  }
  out.push(relative);
}

export function collectFiles() {
  const files = [];
  for (const entry of ALLOW_LIST) {
    if (!fs.existsSync(path.join(ROOT, entry))) {
      throw new Error(`allow-listed path missing: ${entry}`);
    }
    walk(entry.split(path.sep).join("/"), files);
  }
  return files;
}

function manifestReferences(manifest) {
  const refs = new Set();
  const addIcons = (icons) => { if (icons) for (const value of Object.values(icons)) refs.add(value); };
  addIcons(manifest.icons);
  if (manifest.action) {
    addIcons(manifest.action.default_icon);
    if (manifest.action.default_popup) refs.add(manifest.action.default_popup);
  }
  if (manifest.side_panel && manifest.side_panel.default_path) refs.add(manifest.side_panel.default_path);
  if (manifest.options_page) refs.add(manifest.options_page);
  if (manifest.background && manifest.background.service_worker) refs.add(manifest.background.service_worker);
  for (const script of manifest.content_scripts || []) {
    for (const file of script.js || []) refs.add(file);
    for (const file of script.css || []) refs.add(file);
  }
  return [...refs];
}

export function check() {
  const problems = [];
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  if (manifest.version !== pkg.version) {
    problems.push(`version mismatch: manifest ${manifest.version} vs package.json ${pkg.version}`);
  }
  const files = collectFiles();
  const fileSet = new Set(files);
  for (const ref of manifestReferences(manifest)) {
    if (!fileSet.has(ref)) problems.push(`manifest references a file that would not ship: ${ref}`);
  }
  for (const file of files) {
    const ext = path.extname(file);
    if (!SHIPPABLE_EXTENSIONS.has(ext)) problems.push(`unexpected file type in package: ${file}`);
    if (ext === ".js") {
      try {
        new vm.Script(fs.readFileSync(path.join(ROOT, file), "utf8"), { filename: file });
      } catch (error) {
        problems.push(`script does not parse: ${file} (${error.message})`);
      }
    }
    if (ext === ".json") {
      try {
        JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
      } catch (error) {
        problems.push(`json does not parse: ${file} (${error.message})`);
      }
    }
  }
  // Nothing outside the allow-list may sneak in through the allow-listed
  // directories themselves (for example a stray test file in shared/).
  for (const file of files) {
    if (/(^|\/)(node_modules|tests?|docs|\.git|dist)(\/|$)/.test(file)) {
      problems.push(`path outside the allow-list would ship: ${file}`);
    }
  }
  return { manifest, files, problems };
}

// --- Minimal ZIP writer (local headers + central directory + EOCD) ---

const DOS_TIME = 0; // 00:00:00
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01, deterministic

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

export function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const data = fs.readFileSync(path.join(ROOT, file));
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = compressed.length < data.length;
    const payload = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;
    const crc = zlib.crc32(data);
    const name = Buffer.from(file, "utf8");

    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(method), u16(DOS_TIME), u16(DOS_DATE),
      u32(crc), u32(payload.length), u32(data.length), u16(name.length), u16(0), name
    ]);
    localParts.push(local, payload);

    centralParts.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(method), u16(DOS_TIME), u16(DOS_DATE),
      u32(crc), u32(payload.length), u32(data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name
    ]));
    offset += local.length + payload.length;
  }
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(central.length), u32(offset), u16(0)
  ]);
  return Buffer.concat([...localParts, central, eocd]);
}

// Reads back the entry names from a zip produced above (used by tests).
export function listZipEntries(buffer) {
  const eocdOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdOffset < 0) throw new Error("no end of central directory");
  const count = buffer.readUInt16LE(eocdOffset + 10);
  let cursor = buffer.readUInt32LE(eocdOffset + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("bad central directory entry");
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    names.push(buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

export function build(outDir = path.join(ROOT, "dist")) {
  const { manifest, files, problems } = check();
  if (problems.length > 0) {
    throw new Error(`package check failed:\n  ${problems.join("\n  ")}`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, `readtrail-${manifest.version}.zip`);
  fs.writeFileSync(target, buildZip(files));
  return { target, files };
}

function main(argv) {
  const args = argv.slice(2);
  const outFlag = args.indexOf("--out");
  const outDir = outFlag >= 0 ? path.resolve(args[outFlag + 1]) : undefined;
  if (args.includes("--check")) {
    const { files, problems } = check();
    if (problems.length > 0) {
      console.error("package check failed:");
      for (const problem of problems) console.error(`  - ${problem}`);
      process.exit(1);
    }
    console.log(`package check ok: ${files.length} files would ship`);
    return;
  }
  const { target, files } = build(outDir);
  console.log(`wrote ${path.relative(ROOT, target)} (${files.length} files)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv);
}
