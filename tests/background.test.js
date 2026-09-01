import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const script = fs.readFileSync(path.join(root, "background/service-worker.js"), "utf8");

function loadWorker(storedSettings, storedPages = {}) {
  let installedHandler;
  let messageHandler;
  const localSet = vi.fn();
  const sessionSet = vi.fn((_value, callback) => callback?.());

  globalThis.chrome = {
    runtime: {
      lastError: null,
      onInstalled: { addListener: vi.fn((handler) => { installedHandler = handler; }) },
      onMessage: { addListener: vi.fn((handler) => { messageHandler = handler; }) }
    },
    storage: {
      local: {
        get: vi.fn((_key, callback) => callback({ settings: storedSettings })),
        set: localSet
      },
      session: {
        get: vi.fn((_key, callback) => callback({ readingPages: storedPages })),
        set: sessionSet
      }
    }
  };

  window.eval(script);
  return { installedHandler, messageHandler, localSet, sessionSet };
}

describe("ReadTrail service worker", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("creates an independent default settings object on install", () => {
    const { installedHandler, localSet } = loadWorker(undefined);
    installedHandler();

    expect(localSet).toHaveBeenCalledWith({
      settings: expect.objectContaining({ style: "ruler" })
    });
  });

  it("merges stored values with defaults when settings are requested", () => {
    const { messageHandler } = loadWorker({ style: "dots" });
    const sendResponse = vi.fn();

    expect(messageHandler({ type: "getSettings" }, {}, sendResponse)).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ style: "dots", size: 30 })
    );
  });

  it("removes the legacy global enable setting during extension updates", () => {
    const { installedHandler, localSet } = loadWorker({ enabled: false, style: "underline" });
    installedHandler();

    expect(localSet).toHaveBeenCalledWith({
      settings: expect.objectContaining({ style: "underline" })
    });
    expect(localSet.mock.calls[0][0].settings).not.toHaveProperty("enabled");
  });

  it("does not expose or accept the removed global enable setting", () => {
    const { messageHandler } = loadWorker({ enabled: false, style: "underline" });
    const sendResponse = vi.fn();

    expect(messageHandler({ type: "getSettings" }, {}, sendResponse)).toBe(true);
    expect(sendResponse.mock.calls[0][0]).not.toHaveProperty("enabled");
    expect(messageHandler({ type: "toggleEnabled", enabled: false }, {}, vi.fn())).toBe(false);
  });

  it("returns an inactive default for a page without session state", () => {
    const { messageHandler, sessionSet } = loadWorker({});
    const sendResponse = vi.fn();

    expect(messageHandler(
      { type: "getPageState", url: "https://example.com/article#part" },
      {},
      sendResponse
    )).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      state: { version: 1, active: false, mode: "following", position: null }
    });
    expect(sessionSet).not.toHaveBeenCalled();
  });

  it("isolates activation by exact page URL and retains an existing position", () => {
    const url = "https://example.com/article?edition=1#part";
    const position = {
      anchor: { version: 1, path: [0, 1], offset: 2 },
      viewportOffset: 40,
      scrollY: 300,
      scrollRatio: 0.25,
      savedAt: 123
    };
    const storedPages = {
      [url]: { version: 1, active: true, mode: "frozen", position }
    };
    const { messageHandler, sessionSet } = loadWorker({}, storedPages);
    const sendResponse = vi.fn();

    expect(messageHandler({ type: "setPageActive", url, active: false }, {}, sendResponse)).toBe(true);
    expect(sessionSet).toHaveBeenCalledWith({
      readingPages: expect.objectContaining({
        [url]: expect.objectContaining({ active: false, mode: "frozen", position })
      })
    }, expect.any(Function));
    expect(storedPages[url].active).toBe(true);
    expect(storedPages["https://example.com/article?edition=2#part"]).toBeUndefined();
  });

  it("saves a validated position only for an active page", () => {
    const url = "https://example.com/article";
    const position = {
      anchor: { version: 1, path: [0, 1], offset: 2 },
      viewportOffset: 40,
      scrollY: 300,
      scrollRatio: 0.25,
      savedAt: 123
    };
    const { messageHandler, sessionSet } = loadWorker({}, {
      [url]: { version: 1, active: true, mode: "following", position: null }
    });
    const sendResponse = vi.fn();

    expect(messageHandler(
      { type: "savePagePosition", url, mode: "frozen", position },
      {},
      sendResponse
    )).toBe(true);
    expect(sessionSet).toHaveBeenCalledWith({
      readingPages: expect.objectContaining({
        [url]: { version: 1, active: true, mode: "frozen", position }
      })
    }, expect.any(Function));
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      state: { version: 1, active: true, mode: "frozen", position }
    });
  });

  it("rejects writes for inactive pages and malformed records", () => {
    const url = "https://example.com/article";
    const position = {
      anchor: { version: 1, path: [0], offset: 0 },
      viewportOffset: 10,
      scrollY: 0,
      scrollRatio: 0,
      savedAt: 123
    };
    const { messageHandler, sessionSet } = loadWorker({});
    const sendResponse = vi.fn();

    expect(messageHandler(
      { type: "savePagePosition", url, mode: "following", position },
      {},
      sendResponse
    )).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "page-inactive" });
    expect(sessionSet).not.toHaveBeenCalled();

    expect(messageHandler(
      { type: "savePagePosition", url, mode: "following", position: { ...position, scrollRatio: 2 } },
      {},
      vi.fn()
    )).toBe(false);
    expect(messageHandler(
      { type: "setPageActive", url: "chrome://extensions", active: true },
      {},
      vi.fn()
    )).toBe(false);
    expect(sessionSet).not.toHaveBeenCalled();
  });
});
