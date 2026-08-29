import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const script = fs.readFileSync(path.join(root, "content/renderer.js"), "utf8");

function createContext() {
  return {
    setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(),
    save: vi.fn(), restore: vi.fn()
  };
}

describe("ReadTrail renderer", () => {
  let context;

  beforeEach(() => {
    document.body.innerHTML = "";
    context = createContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    window.eval(script);
  });

  it("creates one assistive-technology-hidden overlay canvas", () => {
    window.ReadTrailRenderer.ensureCanvas();
    window.ReadTrailRenderer.ensureCanvas();

    const canvases = document.querySelectorAll("canvas[data-readtrail-canvas]");
    expect(canvases).toHaveLength(1);
    expect(canvases[0].getAttribute("aria-hidden")).toBe("true");
    expect(canvases[0].style.pointerEvents).toBe("none");
  });

  it("renders using CSS viewport dimensions and removes the canvas cleanly", () => {
    window.ReadTrailRenderer.renderRuler(120, {
      size: 30, color: "not-a-color", opacity: 0.3
    });

    expect(context.fillRect).toHaveBeenCalledWith(0, 105, window.innerWidth, 30);
    expect(context.fillStyle).toBe("rgba(255,107,107,0.3)");

    window.ReadTrailRenderer.removeCanvas();
    expect(document.querySelector("canvas[data-readtrail-canvas]")).toBeNull();
  });
});
