// Sprint 010 part B in real Chromium: the ruler and the line highlight mark the
// text being read, not the width of the window or of the element around it.
import { test, expect } from "@playwright/test";
import { activate, closeExtension, launchExtension, sendMessage, sendTabMessage, startFixtureServer } from "./helpers.mjs";

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

// Alpha of the ReadTrail canvas at a CSS-pixel point, read from the main world.
function canvasAlpha(page, x, y) {
  return page.evaluate(([px, py]) => {
    const canvas = document.querySelector("canvas[data-readtrail-canvas]");
    const scale = canvas.width / window.innerWidth;
    return canvas.getContext("2d").getImageData(Math.round(px * scale), Math.round(py * scale), 1, 1).data[3];
  }, [x, y]);
}

// Shares of the pixels in one row band of a screenshot that carry the tint
// #00FF00 at 0.3 alpha over white (179, 255, 179), inside [x0, x1) and after x1.
async function tintShares(page, clip, x1) {
  const png = await page.screenshot({ clip });
  return page.evaluate(async ({ b64, split }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = new OffscreenCanvas(img.width, img.height);
    const g = canvas.getContext("2d");
    g.drawImage(img, 0, 0);
    const { data, width, height } = g.getImageData(0, 0, img.width, img.height);
    const cut = Math.round(split * width);
    const counts = { inside: 0, insideTotal: 0, outside: 0, outsideTotal: 0 };
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const i = (row * width + col) * 4;
        const tinted = Math.abs(data[i] - 179) <= 8 && data[i + 1] >= 247 && Math.abs(data[i + 2] - 179) <= 8;
        const side = col < cut ? "inside" : "outside";
        counts[`${side}Total`] += 1;
        if (tinted) counts[side] += 1;
      }
    }
    return { inside: counts.inside / counts.insideTotal, outside: counts.outside / counts.outsideTotal };
  }, { b64: png.toString("base64"), split: (x1 - clip.x) / clip.width });
}

test("the ruler and the line highlight stay on the text", async () => {
  const url = `${fixture.origin}/long-article.html`;
  const set = await sendMessage(ext, { type: "setSettings", settings: { style: "ruler", highlightLine: true, highlightColor: "#00FF00" } });
  expect(set.ok).toBe(true);
  const page = await ext.context.newPage();
  await page.goto(url);

  // One short line in a paragraph whose own box runs far past its text.
  const text = await page.evaluate(() => {
    const p = document.createElement("p");
    p.id = "narrow";
    p.textContent = "A short line.";
    document.getElementById("intro").before(p);
    const range = document.createRange();
    range.selectNodeContents(p);
    const r = range.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, boxRight: p.getBoundingClientRect().right, width: innerWidth };
  });
  expect(text.boxRight - text.right).toBeGreaterThan(200);

  const { tabId } = await activate(ext, url);
  await expect(page.locator("canvas[data-readtrail-canvas]")).toHaveCount(1);
  const y = (text.top + text.bottom) / 2;
  await page.mouse.move((text.left + text.right) / 2, y);

  // B2: the ruler is drawn across the text and transparent beyond it, including
  // over the rest of the paragraph's own box.
  await expect.poll(() => canvasAlpha(page, text.left + 4, y)).toBeGreaterThan(0);
  expect(await canvasAlpha(page, text.right - 4, y)).toBeGreaterThan(0);
  for (const x of [4, text.left - 4, text.right + 4, text.boxRight - 4, text.width - 4]) {
    expect(await canvasAlpha(page, x, y), `alpha at x=${x}`).toBe(0);
  }

  // B1: one readtrail-line highlight over the paragraph's contents, one rule in
  // the configured colour, and nothing on the paragraph itself.
  const marked = await page.evaluate(() => {
    const p = document.getElementById("narrow");
    const highlight = CSS.highlights.get("readtrail-line");
    const [range] = highlight ? [...highlight] : [];
    return {
      covers: Boolean(range) && range.startContainer === p && range.endContainer === p && range.endOffset === p.childNodes.length,
      rules: [...document.querySelectorAll("style[data-readtrail-line]")].map((s) => s.textContent),
      untouched: p.getAttribute("class") === null && p.getAttribute("style") === null
    };
  });
  expect(marked.covers).toBe(true);
  expect(marked.rules).toHaveLength(1);
  expect(marked.rules[0]).toContain("rgba(0, 255, 0, 0.3)");
  expect(marked.untouched).toBe(true);

  // The colour really paints, behind the text only. The overlay is hidden for
  // the screenshot so the ruler does not tint the same pixels.
  await page.evaluate(() => { document.querySelector("canvas[data-readtrail-canvas]").style.visibility = "hidden"; });
  const shares = await tintShares(page, { x: text.left, y: text.top + 3, width: text.right - text.left + 60, height: text.bottom - text.top - 6 }, text.right + 3);
  await page.evaluate(() => { document.querySelector("canvas[data-readtrail-canvas]").style.visibility = ""; });
  expect(shares.inside).toBeGreaterThan(0.3);
  expect(shares.outside).toBe(0);

  // The underline's glow is cut at the text's ends, not left to fade past them.
  expect((await sendMessage(ext, { type: "setSettings", settings: { style: "underline" } })).ok).toBe(true);
  await page.mouse.move((text.left + text.right) / 2 + 1, y);
  await expect.poll(() => canvasAlpha(page, text.left + 4, y)).toBeGreaterThan(0);
  for (const x of [text.left - 3, text.right + 3]) {
    expect(await canvasAlpha(page, x, y), `underline alpha at x=${x}`).toBe(0);
  }

  // B4: turning ReadTrail off leaves the page as it was. In the panel's order
  // (page-view.js disablePage): the page first, so a pending position still
  // saves, then the worker.
  expect((await sendTabMessage(ext, tabId, { type: "setPageActive", active: false })).ok).toBe(true);
  await sendMessage(ext, { type: "setPageActive", tabId, url, active: false });
  expect(await page.evaluate(() => ({
    highlight: CSS.highlights.has("readtrail-line"),
    rules: document.querySelectorAll("style[data-readtrail-line]").length,
    canvases: document.querySelectorAll("canvas[data-readtrail-canvas]").length
  }))).toEqual({ highlight: false, rules: 0, canvases: 0 });
  await page.close();
});
