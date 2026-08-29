import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const html = fs.readFileSync(path.join(root, "options/options.html"), "utf8");
const script = fs.readFileSync(path.join(root, "options/options.js"), "utf8");

const storedSettings = {
  enabled: true,
  style: "ruler",
  color: "#FF6B6B",
  size: 30,
  opacity: 0.3,
  dotCount: 20,
  fadeSpeed: 0.9,
  highlightLine: false,
  highlightColor: "#FFEB3B"
};

function renderOptions(settings = storedSettings) {
  document.open();
  document.write(html.replace('<script src="options.js"></script>', ""));
  document.close();

  const set = vi.fn((value, callback) => callback?.());
  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn((_key, callback) => callback({ settings })),
        set
      }
    }
  };

  window.eval(script);
  return { set };
}

describe("ReadTrail options", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("associates every form control with an accessible label", () => {
    renderOptions();

    document.querySelectorAll("input").forEach((input) => {
      expect(document.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
    });
  });

  it("exposes the selected style and conditional controls", () => {
    renderOptions();

    const ruler = document.querySelector('[data-style="ruler"]');
    const dots = document.querySelector('[data-style="dots"]');
    expect(ruler.getAttribute("aria-pressed")).toBe("true");
    expect(dots.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector("#dotsOptions").hidden).toBe(true);

    dots.click();

    expect(ruler.getAttribute("aria-pressed")).toBe("false");
    expect(dots.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("#dotsOptions").hidden).toBe(false);
  });

  it("persists range values with meaningful assistive text", () => {
    const { set } = renderOptions();
    const size = document.querySelector("#size");
    size.value = "48";
    size.dispatchEvent(new Event("input", { bubbles: true }));

    expect(size.getAttribute("aria-valuetext")).toBe("48 pixels");
    expect(document.querySelector("#sizeValue").textContent).toBe("48");
    expect(set).toHaveBeenLastCalledWith(
      { settings: expect.objectContaining({ size: 48 }) },
      expect.any(Function)
    );
  });

  it("reveals highlight color controls when highlighting is enabled", () => {
    renderOptions();
    const checkbox = document.querySelector("#highlightLine");
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));

    expect(document.querySelector("#highlightOptions").hidden).toBe(false);
  });

  it("restores defaults and announces the result", () => {
    const { set } = renderOptions({ ...storedSettings, size: 80 });
    document.querySelector("#resetBtn").click();

    expect(set).toHaveBeenLastCalledWith(
      { settings: storedSettings },
      expect.any(Function)
    );
    expect(document.querySelector("#saveStatus").textContent).toBe("Defaults restored");
  });
});
