import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const script = fs.readFileSync(path.join(root, "content/content.js"), "utf8");

async function loadContent(settings) {
  let storageChangeHandler;
  let runtimeMessageHandler;
  const renderer = {
    ensureCanvas: vi.fn(), removeCanvas: vi.fn(), clear: vi.fn(),
    renderRuler: vi.fn(), renderDots: vi.fn(), renderUnderline: vi.fn()
  };

  window.ReadTrailRenderer = renderer;
  globalThis.chrome = {
    runtime: {
      lastError: null,
      sendMessage: vi.fn((_message, callback) => callback(settings)),
      onMessage: { addListener: vi.fn((handler) => { runtimeMessageHandler = handler; }) }
    },
    storage: {
      onChanged: { addListener: vi.fn((handler) => { storageChangeHandler = handler; }) }
    }
  };

  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  window.eval(script);
  await Promise.resolve();
  await Promise.resolve();

  return { renderer, runtimeMessageHandler, storageChangeHandler };
}

describe("ReadTrail content lifecycle", () => {
  beforeEach(() => {
    document.body.innerHTML = '<p id="line">Readable text</p>';
    vi.unstubAllGlobals();
  });

  it("starts, renders pointer movement, and stops on a toggle message", async () => {
    const { renderer, runtimeMessageHandler } = await loadContent({
      enabled: true, style: "ruler", color: "#FF6B6B", size: 30, opacity: 0.3
    });

    expect(renderer.ensureCanvas).toHaveBeenCalledOnce();
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 40, clientY: 80 }));
    expect(renderer.renderRuler).toHaveBeenCalledWith(
      80,
      expect.objectContaining({ style: "ruler", size: 30 })
    );

    runtimeMessageHandler({ type: "toggleEnabled", enabled: false });
    expect(renderer.removeCanvas).toHaveBeenCalledOnce();
  });

  it("applies the chosen highlight color and restores the page style", async () => {
    const line = document.querySelector("#line");
    line.style.backgroundColor = "rgb(1, 2, 3)";
    document.caretRangeFromPoint = vi.fn(() => ({
      startContainer: line.firstChild
    }));

    const { storageChangeHandler } = await loadContent({
      enabled: true,
      style: "underline",
      highlightLine: true,
      highlightColor: "#00FF00"
    });

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 20 }));
    expect(line.classList.contains("readtrail-highlight")).toBe(true);
    expect(line.style.getPropertyValue("background-color")).toBe("rgba(0, 255, 0, 0.3)");

    storageChangeHandler({ settings: { newValue: { enabled: true, highlightLine: false } } });
    expect(line.classList.contains("readtrail-highlight")).toBe(false);
    expect(line.style.backgroundColor).toBe("rgb(1, 2, 3)");
  });
});
