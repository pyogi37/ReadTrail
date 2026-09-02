import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const script = fs.readFileSync(path.join(root, "content/renderer.js"), "utf8");

function createContext() {
  return {
    setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(),
    save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn()
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

  it("renders following, frozen, and saved with structurally distinct shapes", () => {
    const style = { size: 30, color: "#FF6B6B", opacity: 0.3 };

    window.ReadTrailRenderer.renderRuler(120, style, "saved");
    // Saved uses dashed edges (setLineDash) plus a left flag, distinguishing it
    // structurally and not just by warm-gold color.
    expect(context.setLineDash).toHaveBeenCalledWith([8, 6]);

    context.setLineDash.mockClear();
    window.ReadTrailRenderer.renderRuler(120, style, "frozen");
    // Frozen uses solid "stopped" end caps and does NOT dash its edges.
    expect(context.setLineDash).not.toHaveBeenCalledWith([8, 6]);
    expect(context.fillRect).toHaveBeenCalledWith(0, 105, 5, 30); // left cap
    expect(context.fillRect).toHaveBeenCalledWith(
      window.innerWidth - 5, 105, 5, 30
    ); // right cap
  });

  it("renders saved underline with a dashed line and end badge", () => {
    window.ReadTrailRenderer.renderUnderline(120, { size: 30, color: "#FF6B6B", opacity: 0.3 }, "saved");
    expect(context.setLineDash).toHaveBeenCalledWith([10, 7]);
    // The end badge distinguishes saved from the plain following/frozen lines.
    expect(context.arc).toHaveBeenCalled();
  });
});
