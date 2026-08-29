import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const script = fs.readFileSync(path.join(root, "background/service-worker.js"), "utf8");

function loadWorker(storedSettings) {
  let installedHandler;
  let messageHandler;
  const set = vi.fn();

  globalThis.chrome = {
    runtime: {
      onInstalled: { addListener: vi.fn((handler) => { installedHandler = handler; }) },
      onMessage: { addListener: vi.fn((handler) => { messageHandler = handler; }) }
    },
    storage: {
      local: {
        get: vi.fn((_key, callback) => callback({ settings: storedSettings })),
        set
      }
    }
  };

  window.eval(script);
  return { installedHandler, messageHandler, set };
}

describe("ReadTrail service worker", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("creates an independent default settings object on install", () => {
    const { installedHandler, set } = loadWorker(undefined);
    installedHandler();

    expect(set).toHaveBeenCalledWith({
      settings: expect.objectContaining({ enabled: true, style: "ruler" })
    });
  });

  it("merges stored values with defaults when settings are requested", () => {
    const { messageHandler } = loadWorker({ style: "dots" });
    const sendResponse = vi.fn();

    expect(messageHandler({ type: "getSettings" }, {}, sendResponse)).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, style: "dots", size: 30 })
    );
  });

  it("rejects malformed toggle messages without writing", () => {
    const { messageHandler, set } = loadWorker({ enabled: true });

    expect(messageHandler({ type: "toggleEnabled", enabled: "no" }, {}, vi.fn())).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });

  it("persists validated toggle messages without mutating stored data", () => {
    const stored = { enabled: true, style: "underline" };
    const { messageHandler, set } = loadWorker(stored);
    const sendResponse = vi.fn();

    expect(messageHandler({ type: "toggleEnabled", enabled: false }, {}, sendResponse)).toBe(true);
    expect(stored.enabled).toBe(true);
    expect(set).toHaveBeenCalledWith({
      settings: expect.objectContaining({ enabled: false, style: "underline" })
    });
  });
});
