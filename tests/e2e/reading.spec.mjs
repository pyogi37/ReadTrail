// End-to-end scenarios against the unpacked extension in Chromium. These are
// the automated half of docs/qa/MANUAL-QA.md; the side panel surface itself
// still needs a human, but the same JS runs in ?mode=page.
import { test, expect } from "@playwright/test";
import {
  activate, closeExtension, launchExtension, panelUrl, readStorage, sendMessage, sendTabMessage, startFixtureServer, tabIdFor, tabIdsFor
} from "./helpers.mjs";

let fixture;
let ext;

test.beforeAll(async () => {
  fixture = await startFixtureServer();
  ext = await launchExtension();
});

test.afterAll(async () => {
  if (ext) await closeExtension(ext);
  if (fixture) fixture.server.close();
});

const articleUrl = () => `${fixture.origin}/long-article.html`;

test("a fresh page is dormant: no canvas, no session record", async () => {
  const page = await ext.context.newPage();
  await page.goto(articleUrl());
  await page.waitForLoadState("domcontentloaded");
  await page.mouse.move(200, 300);
  expect(await page.locator("canvas").count()).toBe(0);
  const session = await readStorage(ext.worker, "session");
  expect(Object.keys(session).filter((k) => k.startsWith("readtrail.tab.v1:"))).toEqual([]);
  await page.close();
});

test("activation, pause, reload restore, and per-tab isolation", async () => {
  const url = articleUrl();
  const a = await ext.context.newPage();
  await a.goto(url);
  const b = await ext.context.newPage();
  await b.goto(url);

  const [firstId, secondId] = await tabIdsFor(ext.worker, url);
  expect(secondId).toBeDefined();
  const activation = await activate(ext, url, firstId);
  expect(activation.state.ok).toBe(true);
  expect(activation.delivery && activation.delivery.ok).toBe(true);
  await expect(a.locator("canvas")).toHaveCount(1);

  // Pause on a paragraph: move, then a single trusted click.
  const p20 = a.locator("#p20");
  await p20.scrollIntoViewIfNeeded();
  const box = await p20.boundingBox();
  await a.mouse.move(box.x + 40, box.y + 12);
  await a.mouse.click(box.x + 40, box.y + 12);
  await a.waitForTimeout(600); // past the double-click deferral
  const tabA = firstId;
  await expect.poll(async () => {
    const session = await readStorage(ext.worker, "session");
    const record = session[`readtrail.tab.v1:${tabA}`];
    return record && record.mode;
  }).toBe("frozen");

  // Tab B on the same URL is untouched.
  const session = await readStorage(ext.worker, "session");
  const tabB = secondId;
  expect(session[`readtrail.tab.v1:${tabB}`]).toBeUndefined();
  // Whichever page object is tab B, neither page other than the activated one may draw.
  const canvases = await Promise.all([a, b].map((p) => p.locator("canvas").count()));
  expect(canvases.reduce((sum, n) => sum + n, 0)).toBe(1);

  // Reload the activated tab: the frozen position restores and scrolls near
  // the paragraph. Page objects and tab ids may not be in creation order, so
  // pick the page that actually drew the canvas.
  const activePage = (await a.locator("canvas").count()) === 1 ? a : b;
  await activePage.reload();
  await expect(activePage.locator("canvas")).toHaveCount(1);
  await expect.poll(() => activePage.evaluate(() => window.scrollY)).toBeGreaterThan(100);

  await a.close();
  await b.close();
});

test("save for later, continue reading into a new tab, recently closed offer", async () => {
  const url = articleUrl();
  const page = await ext.context.newPage();
  await page.goto(url);
  await activate(ext, url);
  const p30 = page.locator("#p30");
  await p30.scrollIntoViewIfNeeded();
  const box = await p30.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 10);
  await page.mouse.click(box.x + 30, box.y + 10);
  await page.waitForTimeout(600);

  const tabId = await tabIdFor(ext.worker, url);
  const saved = await sendTabMessage(ext, tabId, { type: "saveForLater" });
  expect(saved).toEqual({ ok: true });
  const local = await readStorage(ext.worker, "local");
  expect(local[`readtrail.saved.v1:${url}`]).toEqual(expect.objectContaining({ version: 1, title: "Long fixture article" }));

  // Continue reading opens a new active tab seeded from the durable record.
  const before = ext.context.pages().length;
  const res = await sendMessage(ext, { type: "continueSavedResumePoint", url });
  expect(res.ok).toBe(true);
  await expect.poll(() => ext.context.pages().length).toBe(before + 1);
  const opened = ext.context.pages()[ext.context.pages().length - 1];
  await opened.waitForLoadState("load");
  await expect(opened.locator("canvas")).toHaveCount(1);
  await expect.poll(() => opened.evaluate(() => window.scrollY)).toBeGreaterThan(100);

  // Read further in the original tab, then close it: the recently closed list
  // offers to save the newer place.
  const p50 = page.locator("#p50");
  await p50.scrollIntoViewIfNeeded();
  const box50 = await p50.boundingBox();
  await page.mouse.move(box50.x + 30, box50.y + 10);
  await page.mouse.click(box50.x + 30, box50.y + 10);
  await page.waitForTimeout(600);
  await page.close();
  await expect.poll(async () => {
    const session = await readStorage(ext.worker, "session");
    const recent = session["readtrail.recent.v1"];
    return recent && recent.items.length;
  }).toBe(1);

  const panel = await ext.context.newPage();
  await panel.goto(panelUrl(ext.extensionId));
  await expect(panel.locator("#recentSection")).toBeVisible();
  await panel.locator(".btn-save-place").first().click();
  await expect(panel.locator("#recentSection")).toBeHidden();
  await expect(panel.locator("#pageList .page-card")).toHaveCount(1);
  await expect(panel.locator("#pageList .page-summary")).toContainText("saved place");
  await panel.close();
  await opened.close();
});

test("passages: save a selection, see it in the panel, export and import round trip", async () => {
  const url = articleUrl();
  const page = await ext.context.newPage();
  await page.goto(url);
  await page.evaluate(() => {
    const node = document.querySelector("#p3").firstChild;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 12);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  const tabId = await tabIdFor(ext.worker, url);
  const captured = await sendTabMessage(ext, tabId, { type: "capturePassage" });
  expect(captured.ok).toBe(true);
  expect(captured.text).toBe("Paragraph 3.");
  const saved = await sendMessage(ext, { type: "savePassage", url, title: captured.title, text: captured.text, start: captured.start, end: captured.end });
  expect(saved.ok).toBe(true);
  expect((await sendMessage(ext, { type: "setPageTags", url, tags: ["fixture"] })).ok).toBe(true);

  const panel = await ext.context.newPage();
  await panel.goto(panelUrl(ext.extensionId));
  await expect(panel.locator("#pageList .page-card")).toHaveCount(1);
  await panel.locator("#pageList .page-summary").click();
  await expect(panel.locator("#pageList .passage-text")).toHaveText("Paragraph 3.");
  await panel.locator("#librarySearch").fill("paragraph");
  await expect(panel.locator("#searchResults .page-card")).toHaveCount(1);
  await expect(panel.locator("#searchResults .passage-item")).toHaveCount(1);
  await panel.locator("#librarySearch").fill("");
  await panel.locator("#tagsViewButton").click();
  await expect(panel.locator("#tagBrowser .tag-filter")).toContainText("fixture 1");
  await panel.locator("#tagBrowser .tag-filter").click();
  await expect(panel.locator("#tagBrowser .tag-page-list .page-card")).toHaveCount(1);

  const exported = await sendMessage(ext, { type: "exportLibrary" });
  expect(exported.payload.passages).toHaveLength(1);
  const cleared = await sendMessage(ext, { type: "clearLibrary" });
  expect(cleared.ok).toBe(true);
  const imported = await sendMessage(ext, { type: "importLibrary", payload: exported.payload, mode: "replace" });
  expect(imported).toEqual(expect.objectContaining({ ok: true, rejected: 0 }));
  const after = await sendMessage(ext, { type: "exportLibrary" });
  expect(after.payload.passages[0].text).toBe("Paragraph 3.");
  await panel.close();
  await page.close();
});
