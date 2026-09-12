// Shared helpers for the extension e2e harness.
//
// The extension is loaded unpacked from the repository root into a persistent
// Chromium context. Fixture pages are served over plain http from
// tests/e2e/fixtures so the `*://*/*` content script matches them. Assertions
// against extension state go through the service worker with `evaluate`.
import { chromium } from "@playwright/test";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES = path.join(ROOT, "tests", "e2e", "fixtures");

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json" };

export function startFixtureServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      const file = path.join(FIXTURES, url.pathname === "/" ? "long-article.html" : url.pathname);
      if (!file.startsWith(FIXTURES) || !fs.existsSync(file)) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
      res.end(fs.readFileSync(file));
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

export async function launchExtension() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "readtrail-e2e-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`
    ]
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  // A service worker cannot message itself, so runtime messages are sent from
  // a hidden extension page, which also gives the worker a trusted sender.
  const bridge = await context.newPage();
  await bridge.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html?mode=page`);
  return { context, worker, extensionId, userDataDir, bridge };
}

export async function closeExtension({ context, userDataDir }) {
  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

// Reads all of chrome.storage.session or chrome.storage.local from the worker.
export function readStorage(worker, area) {
  return worker.evaluate((name) => new Promise((resolve) => chrome.storage[name].get(null, resolve)), area);
}

// Sends a runtime message from the bridge extension page.
export function sendMessage(ext, message) {
  return ext.bridge.evaluate((msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve)), message);
}

// Sends a message to a tab's content script from the bridge page.
export function sendTabMessage(ext, tabId, message) {
  return ext.bridge.evaluate(
    ({ id, msg }) => new Promise((resolve) => chrome.tabs.sendMessage(id, msg, (res) => {
      void chrome.runtime.lastError;
      resolve(res);
    })),
    { id: tabId, msg: message }
  );
}

// Finds the tab ids Chrome assigned to pages at a URL. Without the `tabs`
// permission the worker never sees `tab.url` (content-script host access does
// not grant it), so ask each tab's content script for its pageInfo, exactly
// as the side panel's getTabInfo fallback does.
export async function tabIdsFor(worker, url) {
  return worker.evaluate((target) => new Promise((resolve) => {
    chrome.tabs.query({}, (tabs) => {
      const ids = [];
      let pending = tabs.length;
      if (pending === 0) {
        resolve(ids);
        return;
      }
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { type: "pageInfo" }, (info) => {
          void chrome.runtime.lastError;
          if (info && info.url === target) ids.push(tab.id);
          pending -= 1;
          if (pending === 0) resolve(ids.sort((a, b) => a - b));
        });
      }
    });
  }), url);
}

export async function tabIdFor(worker, url) {
  const ids = await tabIdsFor(worker, url);
  return ids.length ? ids[0] : null;
}

// Activates ReadTrail for a tab the way the side panel does.
export async function activate(ext, url, explicitTabId) {
  const tabId = Number.isInteger(explicitTabId) ? explicitTabId : await tabIdFor(ext.worker, url);
  const state = await sendMessage(ext, { type: "setPageActive", tabId, url, active: true });
  const delivery = await sendTabMessage(ext, tabId, { type: "setPageActive", active: true, state: state && state.state });
  return { tabId, state, delivery };
}

export function panelUrl(extensionId, mode = "page") {
  return `chrome-extension://${extensionId}/sidepanel/sidepanel.html${mode === "page" ? "?mode=page" : ""}`;
}
