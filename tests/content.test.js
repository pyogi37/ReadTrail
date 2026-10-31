import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sharedConstants = fs.readFileSync(path.join(root, "shared/constants.js"), "utf8");
const script = fs.readFileSync(path.join(root, "content/content.js"), "utf8");

// jsdom shares the window/document across tests in a file, so event listeners
// added by one content.js eval otherwise leak into the next. Capture the true
// DOM registration primitives once and detach every test's listeners between
// runs to keep each test isolated.
const REAL_DOC_ADD = document.addEventListener.bind(document);
const REAL_DOC_REMOVE = document.removeEventListener.bind(document);
const REAL_WIN_ADD = window.addEventListener.bind(window);
const REAL_WIN_REMOVE = window.removeEventListener.bind(window);
const REAL_GET_SELECTION = window.getSelection.bind(window);
const STALE = [];

function resetDom() {
  document.addEventListener = REAL_DOC_ADD;
  document.removeEventListener = REAL_DOC_REMOVE;
  window.addEventListener = REAL_WIN_ADD;
  window.removeEventListener = REAL_WIN_REMOVE;
  window.getSelection = REAL_GET_SELECTION;
  while (STALE.length) {
    const entry = STALE.pop();
    entry.remove(entry.type, entry.handler, entry.options);
  }
  try { window.getSelection()?.removeAllRanges(); } catch (_) {}
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
  deferPersists = false,
  saveResponse = { ok: true },
  persistResponse = { ok: true },
  settings = { enabled: true, style: "ruler", size: 30, opacity: 0.3, color: "#FF6B6B", highlightLine: false }
} = {}) {
  let runtimeMessageHandler;
  let storageChangeHandler;

  const sentMsgs = [];
  const addedDoc = [];
  const docHandlers = {};
  loadedDocHandlers = docHandlers;
  const addedWin = [];
  const removedDoc = [];
  const removedWin = [];
  const deferred = { settings: [], pageState: [], saves: [], persists: [] };

  const renderer = {
    ensureCanvas: vi.fn(), removeCanvas: vi.fn(), clear: vi.fn(),
    renderRuler: vi.fn(), renderDots: vi.fn(), renderUnderline: vi.fn()
  };
  const capture = vi.fn(captureImpl);
  const resolvePosition = vi.fn((position) => ({ range: null, scrollY: position.scrollY, anchorResolved: false }));
  const validatePosition = vi.fn((position) => Boolean(position && position.anchor && Number.isFinite(position.viewportOffset)));

  window.ReadTrailRenderer = renderer;
  const resolveAnchor = vi.fn(() => null);
  window.ReadTrailPosition = { capture, resolvePosition, resolveAnchor, validatePosition };
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
        } else if (message.type === "persistResumePoint") {
          if (deferPersists) deferred.persists.push(callback);
          else callback(persistResponse);
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

  window.eval(sharedConstants);
  window.eval(script);

  const getSaves = () => sentMsgs.filter((m) => m.type === "savePagePosition");

  return {
    renderer, capture, resolvePosition, resolveAnchor, validatePosition,
    runtimeMessageHandler, storageChangeHandler,
    sentMsgs, getSaves, deferred,
    addedDoc, addedWin, removedDoc, removedWin, docHandlers
  };
}

const flush = () => Promise.resolve();

// JSDOM has no layout and no CSS Custom Highlight API. This stubs the highlight
// registry, the Highlight class, caretRangeFromPoint (it hits `layout.hit`) and
// range boxes, keyed by the id of the element a range starts in.
function stubLayout({ hit = null, boxes = {} } = {}) {
  const highlights = new Map();
  vi.stubGlobal("CSS", { highlights });
  vi.stubGlobal("Highlight", class { constructor(...ranges) { this.ranges = ranges; } });
  const layout = { hit, highlights };
  document.caretRangeFromPoint = vi.fn(() => (layout.hit ? { startContainer: layout.hit } : null));
  Range.prototype.getBoundingClientRect = function () {
    const box = boxes[this.startContainer.id] || { left: 0, right: 0 };
    return { ...box, width: box.right - box.left, top: 0, height: 0 };
  };
  return layout;
}

afterEach(() => {
  delete document.caretRangeFromPoint;
  delete Range.prototype.getBoundingClientRect;
  delete window.ReadTrailPassage;
});

function addParagraph(id, text) {
  const p = document.createElement("p");
  p.id = id;
  p.textContent = text;
  document.body.appendChild(p);
  return p;
}

const lineStyles = () => document.querySelectorAll("style[data-readtrail-line]");

// A dispatched event cannot claim isTrusted, so a real mouse move calls the
// listener the last loaded page registered, if any (a dormant page has none).
let loadedDocHandlers = {};
function trustedMove(x, y) {
  loadedDocHandlers.mousemove?.(trustedPointerEvent({ clientX: x, clientY: y }));
}

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

    trustedMove(5, 5);
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
    expect(renderer.renderRuler).toHaveBeenCalledWith(160, expect.anything(), "frozen", null);
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
    expect(renderer.renderRuler).toHaveBeenCalledWith(200, expect.anything(), "frozen", null);
  });

  it("ignores a page script's synthetic mousemove on an active page", async () => {
    const { runtimeMessageHandler, renderer, getSaves, sentMsgs } = loadContent();
    await flush();
    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();
    renderer.renderRuler.mockClear();
    const sent = sentMsgs.length;

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 50 }));
    expect(renderer.renderRuler).not.toHaveBeenCalled();
    expect(getSaves()).toHaveLength(0);
    expect(sentMsgs).toHaveLength(sent);
  });

  it("throttles following checkpoints to once per second", async () => {
    vi.useFakeTimers();
    const { runtimeMessageHandler, getSaves } = loadContent();
    await flush();
    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    trustedMove(10, 50);
    expect(getSaves()).toHaveLength(1); // first write is immediate (nothing saved yet)

    trustedMove(20, 60);
    trustedMove(30, 70);
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
    trustedMove(10, 50);
    const savesBefore = getSaves().length;

    docHandlers.click(trustedPointerEvent());
    expect(getSaves()).toHaveLength(savesBefore); // deferred, not yet frozen
    vi.advanceTimersByTime(400);

    expect(getSaves()).toHaveLength(savesBefore + 1);
    expect(getSaves().at(-1).mode).toBe("frozen");

    // While frozen, movement must not move the marker.
    renderer.renderRuler.mockClear();
    trustedMove(100, 500);
    expect(renderer.renderRuler).toHaveBeenCalledWith(50, expect.anything(), "frozen", null);
    expect(renderer.renderRuler).not.toHaveBeenCalledWith(500, expect.anything());

    // A second click resumes following.
    docHandlers.click(trustedPointerEvent());
    vi.advanceTimersByTime(400);
    renderer.renderRuler.mockClear();
    trustedMove(100, 500);
    expect(renderer.renderRuler).toHaveBeenCalledWith(500, expect.anything(), "following", null);
  });

  it("keeps a frozen marker attached to its text line while the page scrolls", async () => {
    vi.useFakeTimers();
    const { runtimeMessageHandler, renderer, resolveAnchor, docHandlers } = loadContent();
    await flush();
    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    trustedMove(10, 50);
    docHandlers.click(trustedPointerEvent({ clientX: 10, clientY: 50 }));
    vi.advanceTimersByTime(400);

    const range = { getBoundingClientRect: vi.fn(() => ({ top: 180, height: 20 })) };
    resolveAnchor.mockReturnValue(range);
    renderer.renderRuler.mockClear();
    docHandlers.scroll();

    expect(resolveAnchor).toHaveBeenCalledWith(expect.any(Object), document.body);
    expect(renderer.renderRuler).toHaveBeenLastCalledWith(190, expect.anything(), "frozen", null);
    expect(renderer.renderRuler).not.toHaveBeenCalledWith(50, expect.anything(), "frozen", null);
  });

  it("cancels a deferred single click when a double click follows", async () => {
    vi.useFakeTimers();
    const { runtimeMessageHandler, getSaves, docHandlers } = loadContent();
    await flush();
    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    const target = document.createElement("p");
    document.body.appendChild(target);
    trustedMove(10, 50);
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

    trustedMove(10, 50);
    trustedMove(20, 60);
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

    trustedMove(10, 50);
    trustedMove(20, 60);
    const response = vi.fn();
    runtimeMessageHandler({ type: "setPageActive", active: false }, {}, response);

    deferred.saves[1]({ ok: false, error: "storage-write-failed" });

    expect(response).toHaveBeenCalledWith({ ok: false, error: "save-failed" });
    expect(renderer.removeCanvas).not.toHaveBeenCalled();
    renderer.renderRuler.mockClear();
    trustedMove(30, 70);
    expect(renderer.renderRuler).toHaveBeenCalledWith(70, expect.anything(), "following", null);
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
    trustedMove(5, 5);
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
    trustedMove(5, 5);
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

    trustedMove(10, 50);
    const count = getSaves().length;

    trustedMove(20, 60);
    expect(getSaves()).toHaveLength(count); // pending, not yet written

    window.dispatchEvent(new Event("pagehide"));
    expect(getSaves()).toHaveLength(count + 1);
  });

  // Sprint 010 B1 changed this test on purpose: it asserted a class and an
  // inline style on the page's element, which was the defect. Its intent is
  // unchanged: the highlight goes and the page's own style survives.
  it("preserves appearance updates and highlight cleanup", async () => {
    const line = addParagraph("line", "Readable text");
    line.style.backgroundColor = "rgb(1, 2, 3)";
    const layout = stubLayout({ hit: line.firstChild, boxes: { line: { left: 100, right: 400 } } });

    const { runtimeMessageHandler, storageChangeHandler, renderer } = loadContent({
      settings: { enabled: true, style: "underline", highlightLine: true, highlightColor: "#00FF00", size: 30, opacity: 0.3 }
    });
    await flush();
    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    trustedMove(10, 20);
    const [range] = layout.highlights.get("readtrail-line").ranges;
    expect([range.startContainer, range.startOffset, range.endContainer, range.endOffset]).toEqual([line, 0, line, 1]);
    expect(lineStyles()).toHaveLength(1);
    expect(lineStyles()[0].textContent).toContain("::highlight(readtrail-line) { background-color: rgba(0, 255, 0, 0.3);");
    expect(line.getAttribute("class")).toBeNull();
    expect(line.getAttribute("style")).toBe("background-color: rgb(1, 2, 3);");

    storageChangeHandler({ settings: { newValue: { style: "underline", highlightLine: true, highlightColor: "#0000FF" } } });
    expect(lineStyles()).toHaveLength(1);
    expect(lineStyles()[0].textContent).toContain("rgba(0, 0, 255, 0.3)");

    storageChangeHandler({ settings: { newValue: { enabled: true, style: "underline", highlightLine: false, color: "#FF6B6B" } } });
    expect(layout.highlights.has("readtrail-line")).toBe(false);
    expect(lineStyles()).toHaveLength(0);
    expect(line.getAttribute("class")).toBeNull();
    expect(line.style.backgroundColor).toBe("rgb(1, 2, 3)");
    expect(renderer.clear).toHaveBeenCalled();
  });
});

describe("saveForLater bridge", () => {
  beforeEach(() => {
    resetDom();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns inactive when the page has not been activated", async () => {
    const { runtimeMessageHandler } = loadContent();
    await flush();

    const response = vi.fn();
    runtimeMessageHandler({ type: "saveForLater" }, {}, response);

    expect(response).toHaveBeenCalledWith({ ok: false, error: "inactive" });
  });

  it("returns no-checkpoint when active but no position has been captured", async () => {
    const { runtimeMessageHandler } = loadContent();
    await flush();

    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    const response = vi.fn();
    runtimeMessageHandler({ type: "saveForLater" }, {}, response);

    expect(response).toHaveBeenCalledWith({ ok: false, error: "no-checkpoint" });
  });

  it("sends persistResumePoint with the current-tab snapshot and returns ok", async () => {
    const { runtimeMessageHandler, sentMsgs } = loadContent();
    await flush();

    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    trustedMove(10, 50);

    const response = vi.fn();
    runtimeMessageHandler({ type: "saveForLater" }, {}, response);

    const persistMsg = sentMsgs.find((m) => m.type === "persistResumePoint");
    expect(persistMsg).toBeDefined();
    expect(persistMsg.url).toBe(location.href);
    expect(persistMsg.title).toBe(document.title);
    expect(persistMsg.position).toBeDefined();
    expect(persistMsg.position.anchor).toBeDefined();
    expect(Number.isFinite(persistMsg.position.viewportOffset)).toBe(true);

    expect(response).toHaveBeenCalledWith({ ok: true });
  });

  it("snapshot is a deep copy whose mutation does not affect the in-memory checkpoint", async () => {
    const { runtimeMessageHandler, sentMsgs, capture } = loadContent();
    await flush();

    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    const original = makePosition({
      viewportOffset: 42,
      scrollY: 99,
      anchor: { version: 1, path: [0, 1], offset: 5 }
    });
    capture.mockReturnValueOnce(original);
    trustedMove(10, 50);

    const response = vi.fn();
    runtimeMessageHandler({ type: "saveForLater" }, {}, response);

    const persistMsg = sentMsgs.find((m) => m.type === "persistResumePoint");
    expect(persistMsg.position.viewportOffset).toBe(42);
    expect(persistMsg.position.scrollY).toBe(99);
    expect(persistMsg.position.anchor.path).toEqual([0, 1]);

    // Mutate the snapshot; the next save must still see the original values.
    persistMsg.position.viewportOffset = 999;
    persistMsg.position.anchor.path.push(99);

    const response2 = vi.fn();
    runtimeMessageHandler({ type: "saveForLater" }, {}, response2);
    const persistMsg2 = sentMsgs.find(
      (m) => m.type === "persistResumePoint" && m !== persistMsg
    );
    expect(persistMsg2.position.viewportOffset).toBe(42);
    expect(persistMsg2.position.anchor.path).toEqual([0, 1]);
  });

  it("returns persistence-rejected when the service worker rejects the save", async () => {
    const { runtimeMessageHandler } = loadContent({
      persistResponse: { ok: false, error: "invalid-input" }
    });
    await flush();

    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    trustedMove(10, 50);

    const response = vi.fn();
    runtimeMessageHandler({ type: "saveForLater" }, {}, response);

    expect(response).toHaveBeenCalledWith({
      ok: false,
      error: "persistence-rejected",
      detail: "invalid-input"
    });
  });

  it("returns persistence-failure when chrome.runtime.lastError is set", async () => {
    const { runtimeMessageHandler, deferred } = loadContent({ deferPersists: true });
    await flush();

    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    trustedMove(10, 50);

    const response = vi.fn();
    runtimeMessageHandler({ type: "saveForLater" }, {}, response);

    expect(deferred.persists).toHaveLength(1);

    chrome.runtime.lastError = { message: "reconnect" };
    deferred.persists[0](undefined);

    expect(response).toHaveBeenCalledWith({ ok: false, error: "persistence-failure" });
    chrome.runtime.lastError = null;
  });

  it("renders the saved visual state after persistence succeeds", async () => {
    const { runtimeMessageHandler, renderer, sentMsgs } = loadContent();
    await flush();

    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();
    renderer.renderRuler.mockClear();

    trustedMove(10, 50);
    expect(renderer.renderRuler).toHaveBeenLastCalledWith(50, expect.anything(), "following", null);

    const response = vi.fn();
    runtimeMessageHandler({ type: "saveForLater" }, {}, response);
    await flush();

    expect(response).toHaveBeenCalledWith({ ok: true });
    // The successful persist triggers a re-render in the saved treatment, and
    // the persisted session mode is NOT changed (it stays following/frozen).
    expect(renderer.renderRuler).toHaveBeenLastCalledWith(50, expect.anything(), "saved", null);
    const persistMsg = sentMsgs.find((m) => m.type === "persistResumePoint");
    expect(persistMsg).toBeDefined();
  });

  it("does not render a saved visual state when persistence is rejected", async () => {
    const { runtimeMessageHandler, renderer } = loadContent({
      persistResponse: { ok: false, error: "invalid-input" }
    });
    await flush();

    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();
    renderer.renderRuler.mockClear();

    trustedMove(10, 50);

    const response = vi.fn();
    runtimeMessageHandler({ type: "saveForLater" }, {}, response);

    expect(response).toHaveBeenCalledWith({ ok: false, error: "persistence-rejected", detail: "invalid-input" });
    expect(renderer.renderRuler).not.toHaveBeenCalledWith(50, expect.anything(), "saved", null);
  });

  it("renders distinct non-color visual treatments for following, frozen, and saved", async () => {
    vi.useFakeTimers();
    const { runtimeMessageHandler, renderer, docHandlers } = loadContent();
    await flush();

    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();
    renderer.renderRuler.mockClear();

    // Following: ruler renders with "following" state.
    trustedMove(10, 50);
    expect(renderer.renderRuler).toHaveBeenLastCalledWith(50, expect.anything(), "following", null);

    // A deferred click freezes; the marker renders with "frozen".
    docHandlers.click(trustedPointerEvent({ clientX: 10, clientY: 50 }));
    vi.advanceTimersByTime(400);
    expect(renderer.renderRuler).toHaveBeenLastCalledWith(50, expect.anything(), "frozen", null);

    // Save for later; the marker renders with the distinct "saved" state.
    const response = vi.fn();
    runtimeMessageHandler({ type: "saveForLater" }, {}, response);
    await flush();
    expect(response).toHaveBeenCalledWith({ ok: true });
    expect(renderer.renderRuler).toHaveBeenLastCalledWith(50, expect.anything(), "saved", null);

    // All three treatments are mutually distinct by state argument.
    const states = renderer.renderRuler.mock.calls.map((call) => call[2]);
    expect(states).toContain("following");
    expect(states).toContain("frozen");
    expect(states).toContain("saved");
  });

  it("clears the saved visual state back to following when the checkpoint moves", async () => {
    const { runtimeMessageHandler, renderer } = loadContent();
    await flush();

    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    trustedMove(10, 50);
    const response = vi.fn();
    runtimeMessageHandler({ type: "saveForLater" }, {}, response);
    await flush();
    expect(response).toHaveBeenCalledWith({ ok: true });
    expect(renderer.renderRuler).toHaveBeenLastCalledWith(50, expect.anything(), "saved", null);

    renderer.renderRuler.mockClear();
    // Following to a new line clears the saved treatment back to following.
    trustedMove(10, 120);
    expect(renderer.renderRuler).toHaveBeenLastCalledWith(120, expect.anything(), "following", null);
    expect(renderer.renderRuler).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), "saved", null);
  });

  it("clears the saved visual state when the checkpoint is replaced by a freeze", async () => {
    vi.useFakeTimers();
    const { runtimeMessageHandler, renderer, docHandlers } = loadContent();
    await flush();

    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    trustedMove(10, 50);
    const response = vi.fn();
    runtimeMessageHandler({ type: "saveForLater" }, {}, response);
    await flush();
    expect(response).toHaveBeenCalledWith({ ok: true });
    expect(renderer.renderRuler).toHaveBeenLastCalledWith(50, expect.anything(), "saved", null);

    renderer.renderRuler.mockClear();
    // A new freeze replaces the checkpoint and returns to the frozen treatment.
    docHandlers.click(trustedPointerEvent({ clientX: 10, clientY: 90 }));
    vi.advanceTimersByTime(400);
    expect(renderer.renderRuler).toHaveBeenLastCalledWith(90, expect.anything(), "frozen", null);
    expect(renderer.renderRuler).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), "saved", null);
  });

  it("deactivation hides visuals without deleting the saved record", async () => {
    const { runtimeMessageHandler, renderer } = loadContent();
    await flush();

    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    trustedMove(10, 50);
    const response = vi.fn();
    runtimeMessageHandler({ type: "saveForLater" }, {}, response);
    await flush();
    expect(response).toHaveBeenCalledWith({ ok: true });

    renderer.renderRuler.mockClear();
    // Turning off hides all visuals but must leave the durable record intact.
    runtimeMessageHandler({ type: "setPageActive", active: false });
    expect(renderer.removeCanvas).toHaveBeenCalled();
    expect(renderer.clear).toHaveBeenCalled();
  });
});

describe("ReadTrail content per-tab protocol (RT-304)", () => {
  beforeEach(() => {
    resetDom();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reads defaults from the shared module instead of a local copy", () => {
    expect(script).not.toMatch(/highlightColor:\s*"#FFEB3B"/);
    expect(globalThis.ReadTrailShared.DEFAULTS.highlightColor).toBe("#FFEB3B");
  });

  it("includes the document title in every session checkpoint", async () => {
    document.title = "A long article";
    const { runtimeMessageHandler, getSaves } = loadContent();
    await flush();
    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();

    trustedMove(10, 50);
    expect(getSaves()).toHaveLength(1);
    expect(getSaves()[0]).toEqual(expect.objectContaining({
      type: "savePagePosition",
      url: location.href,
      mode: "following",
      title: "A long article"
    }));
  });

  it("reports the restoration quality on the next checkpoint and forgets it on deactivation", async () => {
    vi.useFakeTimers();
    const { runtimeMessageHandler, getSaves, resolvePosition } = loadContent({
      storedState: { version: 1, active: true, mode: "following", position: makePosition() }
    });
    resolvePosition.mockImplementation((position) => ({
      range: null, scrollY: position.scrollY, anchorResolved: false, restoreQuality: "approximate"
    }));
    await flush();
    await flush();
    expect(resolvePosition).toHaveBeenCalled();

    trustedMove(10, 50);
    const saves = getSaves();
    expect(saves.length).toBeGreaterThan(0);
    expect(saves[saves.length - 1].restoreQuality).toBe("approximate");

    // Turning off clears the memory; a fresh activation without a stored
    // position restores nothing, so the next checkpoint carries no quality.
    runtimeMessageHandler({ type: "setPageActive", active: false });
    runtimeMessageHandler({
      type: "setPageActive",
      active: true,
      state: { version: 1, active: true, mode: "following", position: null }
    });
    await flush();
    vi.advanceTimersByTime(1100); // past the checkpoint throttle
    trustedMove(10, 50);
    const after = getSaves();
    expect(after.length).toBeGreaterThan(saves.length);
    expect(after[after.length - 1].restoreQuality).toBeUndefined();
  });

  it("answers pageInfo on a dormant page without activating anything", async () => {
    document.title = "Dormant page";
    const { runtimeMessageHandler, addedDoc, renderer, getSaves } = loadContent();
    await flush();

    const response = vi.fn();
    const keepOpen = runtimeMessageHandler({ type: "pageInfo" }, {}, response);
    expect(response).toHaveBeenCalledWith({ url: location.href, title: "Dormant page" });
    expect(keepOpen).toBe(false);
    expect(addedDoc).toEqual([]);
    expect(renderer.ensureCanvas).not.toHaveBeenCalled();
    expect(getSaves()).toHaveLength(0);
  });
});

describe("the reading guide stays on the text (Sprint 010 part B)", () => {
  beforeEach(() => {
    resetDom();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function activePage(options) {
    const loaded = loadContent(options);
    await flush();
    loaded.runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();
    return loaded;
  }

  const move = trustedMove;

  it("bounds the ruler and the underline by the text of the block under the pointer (B2)", async () => {
    const p = addParagraph("text", "A narrow paragraph");
    stubLayout({ hit: p.firstChild, boxes: { text: { left: 120, right: 360 } } });
    const { storageChangeHandler, renderer } = await activePage();

    move(200, 50);
    expect(renderer.renderRuler).toHaveBeenLastCalledWith(50, expect.anything(), "following", { left: 120, right: 360 });

    storageChangeHandler({ settings: { newValue: { style: "underline" } } });
    move(210, 60);
    expect(renderer.renderUnderline).toHaveBeenLastCalledWith(60, expect.anything(), "following", { left: 120, right: 360 });
  });

  it("spans the viewport before any block, keeps its extent over a gap, and takes the anchor's block when paused (B3)", async () => {
    vi.useFakeTimers();
    const first = addParagraph("first", "The line being read");
    const anchored = addParagraph("anchored", "The paused line");
    const layout = stubLayout({ boxes: { first: { left: 120, right: 360 }, anchored: { left: 80, right: 300 } } });
    const { runtimeMessageHandler, renderer, resolveAnchor, docHandlers } = await activePage();

    move(10, 40);
    expect(renderer.renderRuler).toHaveBeenLastCalledWith(40, expect.anything(), "following", null);

    layout.hit = first.firstChild;
    move(200, 50);
    layout.hit = null; // a margin between blocks
    move(200, 70);
    expect(renderer.renderRuler).toHaveBeenLastCalledWith(70, expect.anything(), "following", { left: 120, right: 360 });

    docHandlers.click(trustedPointerEvent({ clientX: 200, clientY: 70 }));
    vi.advanceTimersByTime(400);
    resolveAnchor.mockReturnValue({ startContainer: anchored.firstChild, getBoundingClientRect: () => ({ top: 180, height: 20 }) });
    docHandlers.scroll();
    expect(renderer.renderRuler).toHaveBeenLastCalledWith(190, expect.anything(), "frozen", { left: 80, right: 300 });

    // Turning off forgets the extent. A restored guide is drawn from its anchor:
    // the viewport when the anchor no longer resolves, else the anchor's block.
    const reload = async () => {
      runtimeMessageHandler({ type: "setPageActive", active: false });
      runtimeMessageHandler({
        type: "setPageActive",
        active: true,
        state: { version: 1, active: true, mode: "frozen", position: makePosition({ viewportOffset: 90 }) }
      });
      await flush();
    };
    resolveAnchor.mockReturnValue(null);
    await reload();
    expect(renderer.renderRuler).toHaveBeenLastCalledWith(90, expect.anything(), "frozen", null);
    resolveAnchor.mockReturnValue({ startContainer: anchored.firstChild, getBoundingClientRect: () => ({ top: 180, height: 20 }) });
    await reload();
    expect(renderer.renderRuler).toHaveBeenLastCalledWith(190, expect.anything(), "frozen", { left: 80, right: 300 });
  });

  it("pausing, turning the highlight off and deactivating each remove the line highlight and its rule (B4)", async () => {
    vi.useFakeTimers();
    const p = addParagraph("text", "A line to read");
    const layout = stubLayout({ hit: p.firstChild, boxes: { text: { left: 120, right: 360 } } });
    const loaded = loadContent({ settings: { style: "dots", highlightLine: true, highlightColor: "#00FF00" } });
    const { runtimeMessageHandler, storageChangeHandler, sentMsgs } = loaded;
    await flush();
    const highlighted = () => layout.highlights.has("readtrail-line") && lineStyles().length === 1;
    const cleared = () => layout.highlights.size === 0 && lineStyles().length === 0;

    // Dormant: nothing is read, drawn or sent.
    const sent = sentMsgs.length;
    move(200, 50);
    storageChangeHandler({ settings: { newValue: { style: "dots", highlightLine: true, highlightColor: "#0000FF" } } });
    expect(document.caretRangeFromPoint).not.toHaveBeenCalled();
    expect(cleared()).toBe(true);
    expect(sentMsgs).toHaveLength(sent);

    runtimeMessageHandler({ type: "setPageActive", active: true });
    await flush();
    move(200, 50);
    expect(highlighted()).toBe(true);

    loaded.docHandlers.click(trustedPointerEvent());
    vi.advanceTimersByTime(400);
    expect(cleared()).toBe(true);
    move(200, 50); // a paused guide does not follow the pointer
    expect(cleared()).toBe(true);

    loaded.docHandlers.click(trustedPointerEvent());
    vi.advanceTimersByTime(400);
    move(200, 50);
    expect(highlighted()).toBe(true);
    storageChangeHandler({ settings: { newValue: { style: "dots", highlightLine: false } } });
    expect(cleared()).toBe(true);

    storageChangeHandler({ settings: { newValue: { style: "dots", highlightLine: true } } });
    move(200, 50);
    expect(highlighted()).toBe(true);
    runtimeMessageHandler({ type: "setPageActive", active: false });
    expect(cleared()).toBe(true);
    expect(p.getAttribute("class")).toBeNull();
    expect(p.getAttribute("style")).toBeNull();
  });

  it("routes flashCapture to passage.js once on a dormant page and does nothing else (B5)", async () => {
    const { runtimeMessageHandler, renderer, addedDoc, sentMsgs } = loadContent();
    await flush();
    const sent = sentMsgs.length;
    const flashCaptured = vi.fn(() => true);
    window.ReadTrailPassage = { flashCaptured };

    const response = vi.fn();
    expect(runtimeMessageHandler({ type: "flashCapture" }, {}, response)).toBe(false);
    expect(flashCaptured).toHaveBeenCalledTimes(1);
    expect(response).toHaveBeenCalledWith({ ok: true });
    expect(sentMsgs).toHaveLength(sent);
    expect(addedDoc).toEqual([]);
    expect(renderer.ensureCanvas).not.toHaveBeenCalled();

    runtimeMessageHandler({ type: "flashCapture" }); // no reply callback: it still flashes
    expect(flashCaptured).toHaveBeenCalledTimes(2);

    flashCaptured.mockReturnValue(false);
    runtimeMessageHandler({ type: "flashCapture" }, {}, response);
    expect(response).toHaveBeenLastCalledWith({ ok: false });
  });

  it("answers flashCapture with ok false when passage.js or its flash is absent or throws (B5)", async () => {
    const { runtimeMessageHandler } = loadContent();
    await flush();
    const response = vi.fn();
    for (const passage of [undefined, {}, { flashCaptured: () => { throw new Error("boom"); } }]) {
      window.ReadTrailPassage = passage;
      expect(runtimeMessageHandler({ type: "flashCapture" }, {}, response)).toBe(false);
      expect(response).toHaveBeenLastCalledWith({ ok: false });
    }
    expect(response).toHaveBeenCalledTimes(3);
  });
});
