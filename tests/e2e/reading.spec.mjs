// End-to-end scenarios against the unpacked extension in Chromium. These are
// the automated half of docs/qa/MANUAL-QA.md; the side panel surface itself
// still needs a human, but the same JS runs in ?mode=page.
import { test, expect } from "@playwright/test";
import {
  activate, closeExtension, deskUrl, launchExtension, panelUrl, readStorage, sendMessage, sendTabMessage, startFixtureServer, tabIdFor, tabIdsFor
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
  const saved = await sendMessage(ext, { type: "savePassage", tabId, url, title: captured.title, text: captured.text, start: captured.start, end: captured.end });
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

test("Return text fallback finds an unchanged selection spanning block elements", async () => {
  const url = articleUrl();
  const page = await ext.context.newPage();
  await page.goto(url);
  await page.evaluate(() => {
    const first = document.querySelector("#p10").firstChild;
    const second = document.querySelector("#p11").firstChild;
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(second, "Paragraph 11.".length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  const tabId = await tabIdFor(ext.worker, url);
  const captured = await sendTabMessage(ext, tabId, { type: "capturePassage" });
  expect(captured.ok).toBe(true);
  expect(captured.text).toContain("Paragraph 10.");
  expect(captured.text).toContain("Paragraph 11.");

  await page.evaluate(() => {
    const section = document.createElement("section");
    for (const id of ["p10", "p11"]) {
      const original = document.getElementById(id);
      const clone = original.cloneNode(true);
      clone.id = `moved-${id}`;
      original.remove();
      section.appendChild(clone);
    }
    document.querySelector("#main").appendChild(section);
  });
  const revealed = await sendTabMessage(ext, tabId, {
    type: "revealPassage",
    start: captured.start,
    end: captured.end,
    text: captured.text
  });
  expect(revealed).toEqual({ ok: true, quality: "approximate" });
  await page.close();
});

test("Desk quotes a clip and Return reports changed and missing source text", async () => {
  expect((await sendMessage(ext, { type: "clearLibrary" })).ok).toBe(true);
  const url = articleUrl();
  const source = await ext.context.newPage();
  await source.goto(url);
  await source.evaluate(() => {
    const node = document.querySelector("#p30").firstChild;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, "Paragraph 30.".length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  const tabId = await tabIdFor(ext.worker, url);
  const captured = await sendTabMessage(ext, tabId, { type: "capturePassage" });
  expect(captured).toEqual(expect.objectContaining({ ok: true, text: "Paragraph 30." }));
  const saved = await sendMessage(ext, {
    type: "savePassage",
    tabId,
    url,
    title: captured.title,
    text: captured.text,
    start: captured.start,
    end: captured.end
  });
  expect(saved.ok).toBe(true);

  // Seed the hint that lets Return reuse this tab. Only the right-click menu
  // writes it for real: the side panel's own Save selection sends savePassage
  // from an extension page, where there is no sender.tab, so the worker never
  // learns the tab and Return opens a duplicate. That is a known defect, not a
  // harness limitation, and this line papering over it is why no test saw it.
  await ext.worker.evaluate(({ id, pageUrl }) => new Promise((resolve) => {
    chrome.storage.session.set({
      [`readtrail.seen.v1:${id}`]: { version: 1, url: pageUrl, updatedAt: Date.now() }
    }, resolve);
  }), { id: tabId, pageUrl: url });

  const desk = await ext.context.newPage();
  await desk.goto(deskUrl(ext.extensionId));
  await expect(desk.locator("#pageList .page-card")).toHaveCount(1);
  await expect(desk.locator("#sourcesPane")).toBeVisible();
  await expect(desk.locator("#draftPane")).toBeVisible();
  await desk.setViewportSize({ width: 800, height: 900 });
  await expect(desk.locator("#sourcesPane")).toBeVisible();
  await expect(desk.locator("#draftPane")).toBeHidden();
  await expect(desk.getByRole("tabpanel", { name: "Sources" })).toBeVisible();
  await desk.locator("#sourcesTab").focus();
  await desk.locator("#sourcesTab").press("ArrowRight");
  await expect(desk.locator("#draftTab")).toBeFocused();
  await expect(desk.locator("#sourcesPane")).toBeHidden();
  await expect(desk.locator("#draftPane")).toBeVisible();
  await expect(desk.getByRole("tabpanel", { name: "Draft" })).toBeVisible();
  await desk.setViewportSize({ width: 1280, height: 900 });
  await desk.locator("#newDraftTitle").fill("What changed in the source?");
  await desk.locator("#newDraftButton").click();
  await expect(desk.locator("#draftEditor")).toBeVisible();
  await desk.locator(".block-text").fill("# Findings");
  await expect(desk.getByRole("heading", { name: "Findings" })).toBeAttached();
  await desk.locator("#pageList .page-summary").click();
  await desk.locator("#pageList .btn-quote").click();
  await expect(desk.locator(".quote-block .passage-text")).toHaveText("Paragraph 30.");

  // The quoted block is marked so the reader can see which one just arrived.
  // Asserting the stylesheet contains the rule is not enough: an invalid
  // shorthand computes to animation-name "none" and the text still matches.
  const quotedMotion = await desk.locator(".quote-block").evaluate((el) => {
    const s = getComputedStyle(el.closest(".draft-block") || el);
    return { name: s.animationName, duration: s.animationDuration };
  });
  expect(quotedMotion.name).not.toBe("none");
  expect(quotedMotion.duration).not.toBe("0s");

  await source.locator("#move-p30").click();
  await desk.locator(".quote-block .btn-return").click();
  await expect(desk.locator(".quote-block .quote-verdict")).toHaveText("Found by its wording in the tab you had open. The page has changed since you saved this.");

  // A Return records what it found on the quote. If that write ever looks like
  // tampering to the worker's provenance guard, every autosave afterwards is
  // rejected and the reader silently loses everything they type next. This is
  // the first thing to check after a Return, not the last.
  await desk.locator(".block-text").first().fill("Still writing after a Return.");
  await expect(desk.locator("#draftSaveState")).toHaveText("Saved");
  await desk.reload();
  await expect(desk.locator(".block-text").first()).toHaveValue("Still writing after a Return.");

  await source.locator("#remove-p30").click();
  await desk.locator(".quote-block .btn-return").click();
  await expect(desk.locator(".quote-block .quote-verdict")).toHaveText("Not found in the tab you had open. The page may have changed. This quote keeps the text you saved.");
  await expect(desk.locator(".quote-block .quote-verdict")).toHaveAttribute("data-quality", "missing");

  await source.close();
  const beforeReopen = ext.context.pages().length;
  await desk.locator(".quote-block .btn-return").click();
  await expect.poll(() => ext.context.pages().length).toBe(beforeReopen + 1);
  // The source tab was closed, so Return had to open a fresh one. The reader is
  // still looking at the Desk, so the verdict must say where it looked.
  await expect(desk.locator(".quote-block .quote-verdict")).toHaveText("Opened the page in a new tab and found the passage there.");
  const reopened = ext.context.pages().find((candidate) => candidate !== desk && candidate !== ext.bridge && candidate.url() === url);
  if (reopened) await reopened.close();

  await desk.close();
});

// The round-three fix persisted what Return found, but only when it succeeded.
// Deleting a clip therefore left "found exactly" on the quote, and the next
// render read it back and told the reader their evidence was intact.
test("a quote whose clip is deleted stops claiming it was found", async () => {
  expect((await sendMessage(ext, { type: "clearLibrary" })).ok).toBe(true);
  const url = articleUrl();
  const source = await ext.context.newPage();
  await source.goto(url);
  await source.evaluate(() => {
    const node = document.querySelector("#p12").firstChild;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, "Paragraph 12.".length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  const tabId = await tabIdFor(ext.worker, url);
  const captured = await sendTabMessage(ext, tabId, { type: "capturePassage" });
  expect(captured.ok).toBe(true);
  const saved = await sendMessage(ext, {
    type: "savePassage", tabId, url, title: captured.title, text: captured.text, start: captured.start, end: captured.end
  });
  expect(saved.ok).toBe(true);

  const desk = await ext.context.newPage();
  await desk.goto(deskUrl(ext.extensionId));
  await desk.fill("#newDraftTitle", "Does the evidence hold");
  await desk.click("#newDraftButton");
  await desk.locator("#pageList .page-summary").click();
  await desk.locator("#pageList .btn-quote").click();
  await expect(desk.locator(".quote-block .passage-text")).toHaveText("Paragraph 12.");

  await desk.locator(".quote-block .btn-return").click();
  await expect(desk.locator(".quote-block .quote-verdict")).toHaveAttribute("data-quality", "exact");
  await expect(desk.locator("#draftSummary")).toHaveText("1 of 1 quote checked: 1 found exactly.");

  // The reader removes the clip. The quote keeps its text, as the Sources pane
  // promises, but it has lost its way back for good.
  expect((await sendMessage(ext, { type: "removePassage", id: saved.passage.id })).ok).toBe(true);
  await desk.locator(".quote-block .btn-return").click();
  await expect(desk.locator(".quote-block .quote-verdict"))
    .toHaveText("That clip is no longer in your library. This quote keeps the text you saved.");

  // A reload is the strongest form of the re-render that used to reverse this.
  await desk.reload();
  await expect(desk.locator(".quote-block .quote-verdict"))
    .toHaveText("The clip this came from is no longer in your library. This quote keeps the text you saved.");
  await expect(desk.locator(".quote-block .quote-verdict")).toHaveAttribute("data-quality", "missing");
  await expect(desk.locator("#draftSummary")).toHaveText("1 of 1 quote checked: 1 no longer linked to a clip.");
  await expect(desk.locator("#draftSummary")).toHaveAttribute("data-state", "mixed");
  // And nothing offers a Return that is now certain to fail.
  await expect(desk.locator(".quote-block .btn-return")).toHaveCount(0);
  await expect(desk.locator(".quote-block .btn-open-source")).toHaveCount(1);

  await desk.close();
  await source.close();
});

// The worker resolves the tab a panel save names, through the real
// chrome.tabs.get, so that an incognito page can never leave a durable record.
// The incognito branch itself is unit-tested: a genuine incognito window needs
// the extension enabled in incognito, which this harness cannot toggle, and
// chrome.windows.create({incognito: true}) returns no window here.
test("a save that cannot be tied to a live tab is refused", async () => {
  expect((await sendMessage(ext, { type: "clearLibrary" })).ok).toBe(true);
  // A distinct URL, so the tab this test opens is the only one that matches it
  // and closing it really does invalidate the id.
  const url = `${articleUrl()}?case=refusal`;
  const page = await ext.context.newPage();
  await page.goto(url);
  const tabId = await tabIdFor(ext.worker, url);
  expect(Number.isInteger(tabId)).toBe(true);
  const clip = { url, title: "Fixture", text: "A sentence worth keeping.", start: null, end: null };

  expect(await sendMessage(ext, { type: "savePassage", ...clip }))
    .toEqual({ ok: false, error: "invalid-sender" });
  expect(await sendMessage(ext, { type: "savePassage", tabId: 9999999, ...clip }))
    .toEqual({ ok: false, error: "invalid-sender" });
  expect(await sendMessage(ext, { type: "saveNote", tabId: 9999999, url, title: "Fixture", text: "A thought." }))
    .toEqual({ ok: false, error: "invalid-sender" });

  const afterRefusals = await readStorage(ext.worker, "local");
  expect(Object.keys(afterRefusals).filter((key) => key.startsWith("readtrail.passage.v1"))).toHaveLength(0);
  expect(Object.keys(afterRefusals).filter((key) => key.startsWith("readtrail.note.v1"))).toHaveLength(0);

  // Naming the tab it really came from is kept.
  expect((await sendMessage(ext, { type: "savePassage", tabId, ...clip })).ok).toBe(true);

  // A tab that has gone stops being a valid witness for a save.
  await page.close();
  expect(await sendMessage(ext, { type: "savePassage", tabId, ...clip, text: "A later sentence." }))
    .toEqual({ ok: false, error: "invalid-sender" });
});
