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

  // Every x the context was asked to draw at, so a test can prove nothing lands
  // outside the text's extent.
  function drawnXs() {
    return [
      ...context.fillRect.mock.calls.flatMap(([x, , w]) => [x, x + w]),
      ...context.moveTo.mock.calls.map(([x]) => x),
      ...context.lineTo.mock.calls.map(([x]) => x),
      ...context.arc.mock.calls.flatMap(([x, , r]) => [x - r, x + r])
    ];
  }

  it.each(["following", "frozen", "saved"])("keeps the %s ruler and underline inside the text's extent (B2)", (state) => {
    const style = { size: 30, color: "#FF6B6B", opacity: 0.3 };
    const extent = { left: 100, right: 400 };
    for (const render of ["renderRuler", "renderUnderline"]) {
      vi.clearAllMocks();
      window.ReadTrailRenderer[render](120, style, state, extent);
      const xs = drawnXs();
      expect(xs.length).toBeGreaterThan(0);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(100);
      expect(Math.max(...xs)).toBeLessThanOrEqual(400);
      expect(context.clearRect).toHaveBeenCalledWith(0, 0, window.innerWidth, window.innerHeight);
    }
  });

  it("puts the end marks at the ends of the extent (B2)", () => {
    const style = { size: 30, color: "#FF6B6B", opacity: 0.3 };
    const extent = { left: 100, right: 400 };
    window.ReadTrailRenderer.renderRuler(120, style, "following", extent);
    expect(context.fillRect).toHaveBeenCalledWith(100, 105, 300, 30);

    window.ReadTrailRenderer.renderRuler(120, style, "saved", extent);
    expect(context.fillRect).toHaveBeenCalledWith(104, 95, 8, 10); // flag

    window.ReadTrailRenderer.renderRuler(120, style, "frozen", extent);
    expect(context.fillRect).toHaveBeenCalledWith(100, 105, 5, 30); // left cap
    expect(context.fillRect).toHaveBeenCalledWith(395, 105, 5, 30); // right cap

    window.ReadTrailRenderer.renderUnderline(120, style, "saved", extent);
    expect(context.arc).toHaveBeenCalledWith(390, 120, 5, 0, Math.PI * 2); // badge
  });

  it("clamps an extent to the viewport and spans the viewport without a usable one (B3)", () => {
    const style = { size: 30, color: "#FF6B6B", opacity: 0.3 };
    const width = window.innerWidth;
    for (const extent of [undefined, null, { left: 300, right: 300 }, { left: 500, right: 200 }, { left: -50, right: width + 50 }]) {
      context.fillRect.mockClear();
      window.ReadTrailRenderer.renderRuler(120, style, "following", extent);
      expect(context.fillRect).toHaveBeenCalledWith(0, 105, width, 30);
    }
  });
});
