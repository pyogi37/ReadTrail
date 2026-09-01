import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const script = fs.readFileSync(path.join(root, "content/content.js"), "utf8");

// jsdom shares the window/document across tests in a file, so event listeners
// added by one content.js eval otherwise leak into the next. Capture the true
// DOM registration primitives once and detach every test's listeners between
// runs to keep each test isolated.
const REAL_DOC_ADD = document.addEventListener.bind(document);
const REAL_DOC_REMOVE = document.removeEventListener.bind(document);
const REAL_WIN_ADD = window.addEventListener.bind(window);
const REAL_WIN_REMOVE = window.removeEventListener.bind(window);
const STALE = [];

function resetDom() {
  document.addEventListener = REAL_DOC_ADD;
  document.removeEventListener = REAL_DOC_REMOVE;
  window.addEventListener = REAL_WIN_ADD;
  window.removeEventListener = REAL_WIN_REMOVE;
  while (STALE.length) {
    const entry = STALE.pop();
    entry.remove(entry.type, entry.handler, entry.options);
  }
}

function makePosition(overrides = {}) {
  return {
    anchor: { version: 1, path: [0], offset: 0 },
    viewportOffset: 120,
    scrollY: 300,
    scrollRatio: 0.25,
    savedAt: 1000,
    ...overrides
  };
}

// Loads content.js into the shared JSDOM window with mockable dependencies and
// records every service-worker message plus (un)registered document/window
// listeners so tests can assert dormancy and activation precisely.
function loadContent({
  storedState = { version: 1, active: false, mode: "following", position: null },
  captureImpl = (x, y) => makePosition({ viewportOffset: y, savedAt: Date.now() }),
  deferSettings = false,
  deferPageState = false,
  deferSaves = false,
  saveResponse = { ok: true },
  settings = { enabled: true, style: "ruler", size: 30, opacity: 0.3, color: "#FF6B6B", highlightLine: false }
} = {}) {
  let runtimeMessageHandler;
  let storageChangeHandler;

  const sentMsgs = [];
  const addedDoc = [];
  const docHandlers = {};
  const addedWin = [];
  const removedDoc = [];
  const removedWin = [];
  const deferred = { settings: [], pageState: [], saves: [] };

  const renderer = {
    ensureCanvas: vi.fn(), removeCanvas: vi.fn(), clear: vi.fn(),
    renderRuler: vi.fn(), renderDots: vi.fn(), renderUnderline: vi.fn()
  };
  const capture = vi.fn(captureImpl);
  const resolvePosition = vi.fn((position) => ({ range: null, scrollY: position.scrollY, anchorResolved: false }));
  const validatePosition = vi.fn((position) => Boolean(position && position.anchor && Number.isFinite(position.viewportOffset)));

  window.ReadTrailRenderer = renderer;
  window.ReadTrailPosition = { capture, resolvePosition, validatePosition };
  globalThis.chrome = {
    runtime: {
      lastError: null,
      sendMessage: vi.fn((message, callback) => {
        sentMsgs.push(message);
        if (message.type === "getSettings") {
          if (deferSettings) deferred.settings.push(callback);
          else callback(settings);
        } else if (message.type === "getPageState") {
          if (deferPageState) deferred.pageState.push(callback);
          else callback({ ok: true, state: storedState });
        } else if (message.type === "savePagePosition") {
          if (deferSaves) deferred.saves.push(callback);
          else callback(saveResponse);
        }
        else callback({ ok: false });
      }),
      onMessage: { addListener: vi.fn((handler) => { runtimeMessageHandler = handler; }) }
    },
    storage: {
      onChanged: { addListener: vi.fn((handler) => { storageChangeHandler = handler; }) }
    }
  };

  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  window.scrollTo = vi.fn();

  document.addEventListener = vi.fn((type, handler, options) => {
    addedDoc.push(type);
    docHandlers[type] = handler;
    STALE.push({ type, handler, options, add: REAL_DOC_ADD, remove: REAL_DOC_REMOVE });
    REAL_DOC_ADD(type, handler, options);
  });
  document.removeEventListener = vi.fn((type, handler, options) => {
    removedDoc.push(type);
    if (docHandlers[type] === handler) delete docHandlers[type];
    REAL_DOC_REMOVE(type, handler, options);
  });
  window.addEventListener = vi.fn((type, handler, options) => {
    addedWin.push(type);
    STALE.push({ type, handler, options, add: REAL_WIN_ADD, remove: REAL_WIN_REMOVE });
    REAL_WIN_ADD(type, handler, options);
  });
  window.removeEventListener = vi.fn((type, handler) => { removedWin.push(type); REAL_WIN_REMOVE(type, handler); });

  window.eval(script);

  const getSaves = () => sentMsgs.filter((m) => m.type === "savePagePosition");

  return {
    renderer, capture, resolvePosition, validatePosition,
    runtimeMessageHandler, storageChangeHandler,
    sentMsgs, getSaves, deferred,
    addedDoc, addedWin, removedDoc, removedWin, docHandlers
  };
}

const flush = () => Promise.resolve();

function trustedPointerEvent(overrides = {}) {
  return {
    button: 0,
    detail: 1,
    isTrusted: true,
    clientX: 10,
    clientY: 50,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...overrides
  };
}

describe("ReadTrail content lifecycle (RT-004A)", () => {
  beforeEach(() => {
    resetDom();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stays dormant: no listeners, no canvas, and no reading-state writes before activation", async () => {
    const { renderer, getSaves, addedDoc, addedWin } = loadContent();
    await flush();

    expect(addedDoc).toEqual([]);
    expect(addedWin).toEqual([]);
    expect(renderer.ensureCanvas).not.toHaveBeenCalled();

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 5 }));
    document.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    document.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 }));

    expect(renderer.renderRuler).not.toHaveBeenCalled();
    expect(renderer.ensureCanvas).not.toHaveBeenCalled();
    expect(getSaves()).toHaveLength(0);
    expect(renderer.removeCanvas).not.toHaveBeenCalled();
  });

  it("restores an active exact-page state automatically after a reload", async () => {
    const position = makePosition({ scrollY: 420, viewportOffset: 160 });
    const { renderer, resolvePosition, addedDoc, addedWin } = loadContent({
      storedState: { version: 1, active: true, mode: "frozen", position }
    });

    await flush();
    await flush();

    expect(resolvePosition).toHaveBeenCalledWith(position, document.body);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 420);
    expect(renderer.renderRuler).toHaveBeenCalledWith(160, expect.anything());
    expect(addedDoc).toEqual(expect.arrayContaining(["mousemove", "click", "dblclick"]));
    expect(addedWin).toContain("pagehide");
  });

  it("activation attaches the exact-page listeners, ensures visuals, and fetches state", async () => {
    const stored = { version: 1, active: false, mode: "following", position: null };
    const { runtimeMessageHandler, renderer, sentMsgs, addedDoc, addedWin } = loadContent({ storedState: stored });
    await flush();

    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();
    expect(sentMsgs.map((m) => m.type)).toContain("getPageState");
    expect(renderer.ensureCanvas).toHaveBeenCalled();
    expect(addedDoc).toEqual(expect.arrayContaining(["mousemove", "click", "dblclick"]));
    expect(addedWin).toContain("pagehide");
  });

  it("activation with supplied frozen state restores scroll and renders the frozen line", async () => {
    const position = makePosition({ scrollY: 500, viewportOffset: 200 });
    const { runtimeMessageHandler, resolvePosition, renderer, addedDoc, addedWin } = loadContent();
    await flush();

    runtimeMessageHandler({
      type: "setPageActive",
      active: true,
      state: { version: 1, active: true, mode: "frozen", position }
    });
    await flush();

    expect(resolvePosition).toHaveBeenCalledWith(position, document.body);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 500);
    expect(addedDoc).toEqual(expect.arrayContaining(["mousemove", "click", "dblclick"]));
    expect(addedWin).toContain("pagehide");
    expect(renderer.ensureCanvas).toHaveBeenCalled();
    expect(renderer.renderRuler).toHaveBeenCalledWith(200, expect.anything());
  });

  it("throttles following checkpoints to once per second", async () => {
    vi.useFakeTimers();
    const { runtimeMessageHandler, getSaves } = loadContent();
    await flush();
    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 50 }));
    expect(getSaves()).toHaveLength(1); // first write is immediate (nothing saved yet)

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 20, clientY: 60 }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 30, clientY: 70 }));
    expect(getSaves()).toHaveLength(1); // subsequent moves coalesce into one pending write

    vi.advanceTimersByTime(1000);
    expect(getSaves()).toHaveLength(2);
    expect(getSaves()[1].mode).toBe("following");
  });

  it("freezes on a deferred single click and saves immediately; another click resumes following", async () => {
    vi.useFakeTimers();
    const { runtimeMessageHandler, renderer, getSaves, docHandlers } = loadContent();
    await flush();
    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();
    renderer.renderRuler.mockClear();

    const target = document.createElement("p");
    document.body.appendChild(target);
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 50 }));
    const savesBefore = getSaves().length;

    docHandlers.click(trustedPointerEvent());
    expect(getSaves()).toHaveLength(savesBefore); // deferred, not yet frozen
    vi.advanceTimersByTime(400);

    expect(getSaves()).toHaveLength(savesBefore + 1);
    expect(getSaves().at(-1).mode).toBe("frozen");

    // While frozen, movement must not move the marker.
    renderer.renderRuler.mockClear();
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 100, clientY: 500 }));
    expect(renderer.renderRuler).toHaveBeenCalledWith(50, expect.anything());
    expect(renderer.renderRuler).not.toHaveBeenCalledWith(500, expect.anything());

    // A second click resumes following.
    docHandlers.click(trustedPointerEvent());
    vi.advanceTimersByTime(400);
    renderer.renderRuler.mockClear();
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 100, clientY: 500 }));
    expect(renderer.renderRuler).toHaveBeenCalledWith(500, expect.anything());
  });

  it("cancels a deferred single click when a double click follows", async () => {
    vi.useFakeTimers();
    const { runtimeMessageHandler, getSaves, docHandlers } = loadContent();
    await flush();
    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    const target = document.createElement("p");
    document.body.appendChild(target);
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 50 }));
    const savesBefore = getSaves().length;

    docHandlers.click(trustedPointerEvent());
    vi.advanceTimersByTime(250);
    docHandlers.click(trustedPointerEvent({ detail: 2 }));
    docHandlers.dblclick(trustedPointerEvent({ detail: 2 }));
    vi.advanceTimersByTime(400);

    // The single-click transition was cancelled, so the page never froze.
    expect(getSaves()).toHaveLength(savesBefore);
  });

  it("does not freeze when the click has no readable text position", async () => {
    vi.useFakeTimers();
    const { runtimeMessageHandler, getSaves, docHandlers } = loadContent({ captureImpl: () => null });
    await flush();
    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    const target = document.createElement("div");
    document.body.appendChild(target);
    docHandlers.click(trustedPointerEvent({ clientX: 5, clientY: 5 }));
    vi.advanceTimersByTime(400);

    expect(getSaves()).toHaveLength(0);
  });

  it("ignores malformed activation messages", async () => {
    const { runtimeMessageHandler, renderer, addedDoc } = loadContent();
    await flush();

    runtimeMessageHandler({ type: "setPageActive", active: "yes" });
    await flush();

    expect(renderer.ensureCanvas).not.toHaveBeenCalled();
    expect(addedDoc).toEqual([]);
  });

  it("does not let a queued activation override a newer deactivation", async () => {
    const { runtimeMessageHandler, renderer, deferred, addedDoc } = loadContent({ deferSettings: true });
    const activationResponse = vi.fn();
    const deactivationResponse = vi.fn();

    runtimeMessageHandler({ type: "setPageActive", active: true }, {}, activationResponse);
    runtimeMessageHandler({ type: "setPageActive", active: false }, {}, deactivationResponse);

    expect(deactivationResponse).toHaveBeenCalledWith({ ok: true });
    deferred.settings[0]({ style: "ruler" });
    await flush();
    await flush();

    expect(activationResponse).toHaveBeenCalledWith({ ok: false, error: "superseded" });
    expect(renderer.ensureCanvas).not.toHaveBeenCalled();
    expect(addedDoc).toEqual([]);
  });

  it("ignores page-state responses from an older lifecycle", async () => {
    const { runtimeMessageHandler, renderer, deferred } = loadContent({ deferPageState: true });
    await flush();
    expect(deferred.pageState).toHaveLength(1); // bootstrap read

    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();
    expect(deferred.pageState).toHaveLength(2); // explicit activation read

    runtimeMessageHandler({ type: "setPageActive", active: false });
    renderer.ensureCanvas.mockClear();
    deferred.pageState[1]({
      ok: true,
      state: { version: 1, active: true, mode: "frozen", position: makePosition() }
    });
    deferred.pageState[0]({
      ok: true,
      state: { version: 1, active: true, mode: "following", position: makePosition() }
    });

    expect(renderer.ensureCanvas).not.toHaveBeenCalled();
    expect(renderer.renderRuler).not.toHaveBeenCalledWith(120, expect.anything());
  });

  it("acknowledges deactivation only after its pending checkpoint is saved", async () => {
    vi.useFakeTimers();
    const { runtimeMessageHandler, renderer, deferred } = loadContent({ deferSaves: true });
    await flush();
    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 50 }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 20, clientY: 60 }));
    expect(deferred.saves).toHaveLength(1);

    const response = vi.fn();
    runtimeMessageHandler({ type: "setPageActive", active: false }, {}, response);
    expect(deferred.saves).toHaveLength(2);
    expect(response).not.toHaveBeenCalled();
    expect(renderer.removeCanvas).not.toHaveBeenCalled();

    deferred.saves[1]({ ok: true });
    expect(response).toHaveBeenCalledWith({ ok: true });
    expect(renderer.removeCanvas).toHaveBeenCalled();
  });

  it("keeps the page active when the save-before-off checkpoint fails", async () => {
    vi.useFakeTimers();
    const { runtimeMessageHandler, renderer, deferred } = loadContent({ deferSaves: true });
    await flush();
    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 50 }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 20, clientY: 60 }));
    const response = vi.fn();
    runtimeMessageHandler({ type: "setPageActive", active: false }, {}, response);

    deferred.saves[1]({ ok: false, error: "storage-write-failed" });

    expect(response).toHaveBeenCalledWith({ ok: false, error: "save-failed" });
    expect(renderer.removeCanvas).not.toHaveBeenCalled();
    renderer.renderRuler.mockClear();
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 30, clientY: 70 }));
    expect(renderer.renderRuler).toHaveBeenCalledWith(70, expect.anything());
  });

  it("uses reading lock on interactive targets while preserving selection and non-primary gestures", async () => {
    vi.useFakeTimers();
    const { runtimeMessageHandler, getSaves, docHandlers } = loadContent();
    await flush();
    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    const before = getSaves().length;

    const link = document.createElement("a");
    link.href = "#x";
    link.textContent = "Linked reading text";
    document.body.appendChild(link);
    const linkEvent = trustedPointerEvent({ target: link, clientX: 5, clientY: 5 });
    docHandlers.click(linkEvent);
    vi.advanceTimersByTime(400);
    expect(linkEvent.preventDefault).toHaveBeenCalled();
    expect(linkEvent.stopImmediatePropagation).toHaveBeenCalled();
    expect(getSaves()).toHaveLength(before + 1); // linked text becomes the frozen checkpoint

    const auxPageClick = vi.fn();
    link.addEventListener("auxclick", auxPageClick);
    const auxResult = link.dispatchEvent(new MouseEvent("auxclick", {
      bubbles: true, cancelable: true, button: 1, clientX: 5, clientY: 5
    }));
    expect(auxResult).toBe(true);
    expect(auxPageClick).toHaveBeenCalled();

    const plain = document.createElement("p");
    document.body.appendChild(plain);
    const secondaryEvent = trustedPointerEvent({ button: 2, target: plain, clientX: 5, clientY: 5 });
    docHandlers.click(secondaryEvent);
    vi.advanceTimersByTime(400);
    expect(secondaryEvent.preventDefault).not.toHaveBeenCalled();
    expect(getSaves()).toHaveLength(before + 1); // non-primary click ignored

    window.getSelection = vi.fn(() => ({ isCollapsed: false, length: 3, toString: () => "abc" }));
    const selectionEvent = trustedPointerEvent({ target: plain, clientX: 5, clientY: 5 });
    docHandlers.click(selectionEvent);
    vi.advanceTimersByTime(400);
    expect(selectionEvent.preventDefault).toHaveBeenCalled();
    expect(getSaves()).toHaveLength(before + 1); // active selection does not toggle
  });

  it("does not turn keyboard or programmatic activation into reading checkpoints", async () => {
    vi.useFakeTimers();
    const { runtimeMessageHandler, getSaves, docHandlers } = loadContent();
    await flush();
    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    const before = getSaves().length;
    const keyboardClick = trustedPointerEvent({ detail: 0 });
    docHandlers.click(keyboardClick);
    const scriptedClick = trustedPointerEvent({ isTrusted: false, detail: 1 });
    docHandlers.click(scriptedClick);
    vi.advanceTimersByTime(400);

    expect(keyboardClick.preventDefault).not.toHaveBeenCalled();
    expect(scriptedClick.preventDefault).not.toHaveBeenCalled();
    expect(getSaves()).toHaveLength(before);
  });

  it("deactivation removes listeners and visuals and blocks further reading events", async () => {
    const { runtimeMessageHandler, renderer, getSaves, removedDoc, removedWin } = loadContent();
    await flush();
    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    renderer.ensureCanvas.mockClear();
    renderer.renderRuler.mockClear();
    runtimeMessageHandler({ type: "setPageActive", active: false });

    expect(renderer.removeCanvas).toHaveBeenCalled();
    expect(renderer.clear).toHaveBeenCalled();
    expect(removedDoc).toEqual(expect.arrayContaining(["mousemove", "click", "dblclick"]));
    expect(removedWin).toContain("pagehide");

    const before = getSaves().length;
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 5 }));
    expect(renderer.ensureCanvas).not.toHaveBeenCalled();
    expect(renderer.renderRuler).not.toHaveBeenCalled();
    expect(getSaves()).toHaveLength(before);

    const link = document.createElement("a");
    const pageClick = vi.fn();
    link.addEventListener("click", pageClick);
    document.body.appendChild(link);
    link.click();
    expect(pageClick).toHaveBeenCalled();
  });

  it("deactivates and ignores reading events when the exact URL changes", async () => {
    const { runtimeMessageHandler, renderer, getSaves } = loadContent();
    await flush();
    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    renderer.removeCanvas.mockClear();
    renderer.ensureCanvas.mockClear();
    renderer.renderRuler.mockClear();
    vi.stubGlobal("location", { href: "https://example.com/drifted" });

    const before = getSaves().length;
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 5 }));
    document.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

    expect(renderer.removeCanvas).toHaveBeenCalled(); // fully cleaned up
    expect(renderer.renderRuler).not.toHaveBeenCalled();
    expect(getSaves()).toHaveLength(before);

    // An explicit reactivation is refused while drifted.
    runtimeMessageHandler({ type: "setPageActive", active: true });
    expect(renderer.ensureCanvas).not.toHaveBeenCalled();
  });

  it("flushes a pending checkpoint on pagehide", async () => {
    vi.useFakeTimers();
    const { runtimeMessageHandler, getSaves } = loadContent();
    await flush();
    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 50 }));
    const count = getSaves().length;

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 20, clientY: 60 }));
    expect(getSaves()).toHaveLength(count); // pending, not yet written

    window.dispatchEvent(new Event("pagehide"));
    expect(getSaves()).toHaveLength(count + 1);
  });

  it("preserves appearance updates and highlight cleanup", async () => {
    const line = document.createElement("p");
    line.id = "line";
    line.textContent = "Readable text";
    line.style.backgroundColor = "rgb(1, 2, 3)";
    document.body.appendChild(line);
    document.caretRangeFromPoint = () => ({ startContainer: line.firstChild });

    const { runtimeMessageHandler, storageChangeHandler, renderer } = loadContent({
      settings: { enabled: true, style: "underline", highlightLine: true, highlightColor: "#00FF00", size: 30, opacity: 0.3 }
    });
    await flush();
    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 20 }));
    expect(line.classList.contains("readtrail-highlight")).toBe(true);

    storageChangeHandler({ settings: { newValue: { enabled: true, style: "underline", highlightLine: false, color: "#FF6B6B" } } });
    expect(line.classList.contains("readtrail-highlight")).toBe(false);
    expect(line.style.backgroundColor).toBe("rgb(1, 2, 3)");
    expect(renderer.clear).toHaveBeenCalled();
  });
});
