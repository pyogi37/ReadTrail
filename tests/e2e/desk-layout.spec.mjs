// Sprint 011 Part A: text blocks read as prose. Measured in real Chromium
// because field-sizing, computed colours and hit testing do not exist in JSDOM.
import { test, expect } from "@playwright/test";
import { closeExtension, deskUrl, launchExtension, sendMessage, sendTabMessage, startFixtureServer, tabIdFor } from "./helpers.mjs";

let ext;
let fixtures;

const PARAGRAPH = [
  "The first sentence sets out what the source claims about the river.",
  "The second notes that the claim rests on a single survey from one dry year.",
  "A third sentence asks whether later surveys were ever taken at all.",
  "The fourth admits the archive was closed when this was written.",
  "A fifth weighs the survey's method against the one used upstream.",
  "The sixth says what would change the reader's mind."
].join(" ");

test.beforeAll(async () => {
  fixtures = await startFixtureServer();
  ext = await launchExtension();
});

test.afterAll(async () => {
  if (ext) await closeExtension(ext);
  if (fixtures) fixtures.server.close();
});

async function seedDraft() {
  expect((await sendMessage(ext, { type: "clearLibrary" })).ok).toBe(true);
  // A clip is saved the way the panel saves one: from a selection in a tab.
  const url = `${fixtures.origin}/long-article.html`;
  const source = await ext.context.newPage();
  await source.goto(url);
  await source.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("#p30"));
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  });
  const tabId = await tabIdFor(ext.worker, url);
  const captured = await sendTabMessage(ext, tabId, { type: "capturePassage" });
  expect(captured).toEqual(expect.objectContaining({ ok: true }));
  const passage = await sendMessage(ext, { type: "savePassage", tabId, url, title: captured.title, text: captured.text, start: captured.start, end: captured.end });
  expect(passage).toEqual(expect.objectContaining({ ok: true }));
  await source.close();
  const draft = await sendMessage(ext, {
    type: "saveDraft",
    title: "River survey",
    blocks: [{ type: "text", text: "A short line." }, { type: "text", text: PARAGRAPH }]
  });
  expect(draft.ok).toBe(true);
  const quoted = await sendMessage(ext, { type: "appendQuote", draftId: draft.draft.id, passageId: passage.passage.id });
  expect(quoted.ok).toBe(true);
}

for (const width of [1280, 390]) {
  test(`text blocks read as prose and stay usable at ${width}px`, async () => {
    await seedDraft();
    const desk = await ext.context.newPage();
    await desk.setViewportSize({ width, height: 900 });
    await desk.goto(deskUrl(ext.extensionId));
    if (width < 960) await desk.locator("#draftTab").click();
    await desk.locator("#draftList .draft-open").first().click();
    const blocks = desk.locator("#draftBlocks > .draft-block");
    await expect(blocks).toHaveCount(3);
    const [short, long, quote] = [blocks.nth(0), blocks.nth(1), blocks.nth(2)];
    await expect(quote).toHaveClass(/quote-block/);

    // A1: a line is a line, a paragraph shows in full.
    const one = await short.locator(".block-text").evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        height: el.getBoundingClientRect().height,
        max: parseFloat(s.lineHeight) + parseFloat(s.paddingTop) + parseFloat(s.paddingBottom),
        lineHeight: parseFloat(s.lineHeight)
      };
    });
    expect(one.height).toBeLessThanOrEqual(one.max + 1);
    const six = await long.locator(".block-text").evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight
    }));
    expect(six.scrollHeight).toBe(six.clientHeight);
    // It wrapped, so the equality above is about growth, not a short text.
    expect(six.clientHeight).toBeGreaterThan(one.lineHeight * 3);

    // A2: no card for text, the frame stays on quotes, prose sits closer.
    const look = (locator) => locator.evaluate((el) => {
      const s = getComputedStyle(el);
      return { border: s.borderTopColor, background: s.backgroundColor };
    });
    const transparent = "rgba(0, 0, 0, 0)";
    for (const text of [short, long]) {
      expect(await look(text)).toEqual({ border: transparent, background: transparent });
    }
    const framed = await look(quote);
    expect(framed.border).not.toBe(transparent);
    expect(framed.background).not.toBe(transparent);
    const [a, b, c] = [await short.boundingBox(), await long.boundingBox(), await quote.boundingBox()];
    const textGap = b.y - (a.y + a.height);
    const quoteGap = c.y - (b.y + b.height);
    expect(textGap).toBeGreaterThanOrEqual(0);
    expect(textGap).toBeLessThan(quoteGap);

    // A3: the handle is hidden from hit testing at rest (decision 44), then
    // appears on the block's left edge with a 24px target.
    const handle = long.locator(".block-handle");
    const hitAtRest = await handle.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el;
    });
    expect(hitAtRest).toBe(false);
    await long.hover();
    await expect(handle).toBeVisible();
    // Hovering can scroll a narrow pane, so measure the block again.
    const box = await long.boundingBox();
    const grip = await handle.boundingBox();
    expect(grip.width).toBeGreaterThanOrEqual(24);
    expect(grip.height).toBeGreaterThanOrEqual(24);
    expect(grip.x).toBeGreaterThanOrEqual(0);
    expect(grip.x).toBeLessThan(box.x);
    expect(grip.x + grip.width).toBeGreaterThan(box.x);
    expect(grip.y).toBeGreaterThanOrEqual(box.y);

    // The options control stays in the block's top right corner, clear of text.
    const toggle = long.locator(".block-options-toggle");
    const corner = await toggle.boundingBox();
    expect(corner.width).toBeGreaterThanOrEqual(24);
    expect(corner.height).toBeGreaterThanOrEqual(24);
    expect(corner.x + corner.width).toBeLessThanOrEqual(box.x + box.width);
    expect(corner.x + corner.width).toBeGreaterThan(box.x + box.width - 12);
    expect(corner.y).toBeGreaterThanOrEqual(box.y);

    // A focused text block shows a visible ring in the focus colour.
    const area = short.locator(".block-text");
    await area.focus();
    const ring = await area.evaluate((el) => {
      const s = getComputedStyle(el);
      const probe = document.createElement("span");
      probe.style.color = "var(--focus)";
      document.body.appendChild(probe);
      const focus = getComputedStyle(probe).color;
      probe.remove();
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), color: s.outlineColor, focus };
    });
    expect(ring.style).toBe("solid");
    expect(ring.width).toBeGreaterThanOrEqual(2);
    expect(ring.color).toBe(ring.focus);

    // The undo offer sits in the gap the removed block left, at 24px or more.
    await toggle.click();
    await long.locator(".btn-remove-block").click();
    const undo = desk.locator("#draftUndo");
    await expect(undo).toBeVisible();
    await expect(desk.locator("#draftBlocks > *").nth(1)).toHaveClass(/draft-undo-slot/);
    const offer = await undo.boundingBox();
    expect(offer.height).toBeGreaterThanOrEqual(24);
    expect(offer.width).toBeGreaterThanOrEqual(24);

    await desk.close();
  });
}
