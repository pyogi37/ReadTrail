(() => {
  "use strict";

  const DEFAULTS = {
    style: "ruler",
    color: "#FF6B6B",
    size: 30,
    opacity: 0.3,
    dotCount: 20,
    fadeSpeed: 0.9,
    highlightLine: false,
    highlightColor: "#FFEB3B"
  };
  const THROTTLE_MS = 1000; // Maximum frequency for session checkpoint writes.
  const CLICK_DEFER_MS = 400; // Supported double-click window before a single click commits.

  // Activation is scoped to the exact URL observed when the script first ran so
  // an SPA route/hash change can never bleed the trail into another page.
  const initialUrl = (typeof location !== "undefined" && location.href) || "";

  let settings = null;
  let pageActive = false;
  let mode = "dormant"; // "dormant" | "following" | "frozen"
  let listenersAttached = false;

  // In-memory-only "just explicitly saved" visual state. It is NOT a durable
  // mode: the persisted session mode stays "following"/"frozen". Any checkpoint
  // movement or replacement clears it back to the correct following/frozen
  // rendering until the reader saves again.
  let savedVisual = false;

  let trail = [];
  let lastHighlight = null;
  let lastHighlightStyle = null;
  let animFrame = null;
  let cursor = { x: 0, y: 0 };

  let lastPosition = null; // Most recently captured position record.
  let pendingSave = null; // Position awaiting a throttled write.
  let lastSavedAt = 0;
  let saveTimer = null;
  let clickTimer = null;
  let lifecycleRevision = 0;

  // Dependencies are optional so an unavailable renderer/position module or
  // missing Chrome bridge degrades to "render nothing" instead of throwing.
  function getRenderer() {
    return (typeof window !== "undefined" && window.ReadTrailRenderer) || null;
  }

  function getPosition() {
    return (typeof window !== "undefined" && window.ReadTrailPosition) || null;
  }

  function hasChrome() {
    return typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.sendMessage === "function";
  }

  function loadSettings() {
    if (!hasChrome()) {
      settings = { ...DEFAULTS };
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "getSettings" }, (s) => {
          if (chrome.runtime.lastError || !s || typeof s !== "object") {
            settings = { ...DEFAULTS };
          } else {
            settings = { ...DEFAULTS, ...s };
          }
          resolve();
        });
      } catch (_) {
        settings = { ...DEFAULTS };
        resolve();
      }
    });
  }

  function emptyActiveState() {
    return { version: 1, active: true, mode: "following", position: null };
  }

  function normalizePageState(value) {
    if (!value || typeof value !== "object" || value.version !== 1) return null;
    if (typeof value.active !== "boolean") return null;
    if (value.mode !== "following" && value.mode !== "frozen") return null;
    if (value.position !== null) {
      const P = getPosition();
      if (!P || typeof P.validatePosition !== "function" || !P.validatePosition(value.position)) {
        return null;
      }
    }
    return {
      version: 1,
      active: value.active,
      mode: value.mode,
      position: value.position
    };
  }

  function fetchPageState(callback) {
    if (!hasChrome()) {
      callback(null);
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: "getPageState", url: initialUrl }, (res) => {
        if (chrome.runtime.lastError || !res || !res.ok) {
          callback(null);
          return;
        }
        callback(normalizePageState(res.state));
      });
    } catch (_) {
      callback(null);
    }
  }

  function savePosition(position, saveMode, done) {
    if (!pageActive || !position || !hasChrome()) {
      if (done) done(false);
      return;
    }
    lastSavedAt = Date.now();
    const finish = (ok) => {
      if (!ok && pageActive && !pendingSave) pendingSave = position;
      if (done) done(ok);
    };
    try {
      chrome.runtime.sendMessage(
        { type: "savePagePosition", url: initialUrl, mode: saveMode, position: position },
        (response) => {
          if (chrome.runtime.lastError || !response || !response.ok) {
            finish(false);
            return;
          }
          finish(true);
        }
      );
    } catch (_) {
      finish(false);
    }
  }

  // --- URL drift protection ---

  function isDrifted() {
    return (typeof location !== "undefined" && location.href) !== initialUrl;
  }

  // Deactivate fully if the exact URL changed; otherwise report active status.
  function guardActive() {
    if (isDrifted()) {
      flushPendingSave();
      deactivate();
      return false;
    }
    return pageActive;
  }

  function isActive() {
    return pageActive && !isDrifted();
  }

  // --- Visual helpers ---

  function lineAtPoint(x, y) {
    let range = null;
    try {
      range = typeof document.caretRangeFromPoint === "function" ? document.caretRangeFromPoint(x, y) : null;
    } catch (_) {
      return null;
    }
    if (!range || !range.startContainer) return null;
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return null;
    const el = node.parentElement;
    if (!el) return null;
    return el.closest("p, div, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, dt, dd, section, article");
  }

  function highlightLine(el) {
    if (lastHighlight && lastHighlight !== el) {
      lastHighlight.classList.remove("readtrail-highlight");
      lastHighlight.style.setProperty("background-color", lastHighlightStyle.value, lastHighlightStyle.priority);
      lastHighlightStyle = null;
    }
    if (el && lastHighlight !== el) {
      lastHighlightStyle = {
        value: el.style.getPropertyValue("background-color"),
        priority: el.style.getPropertyPriority("background-color")
      };
      el.classList.add("readtrail-highlight");
      const color = /^#[0-9a-f]{6}$/i.test(settings.highlightColor) ? settings.highlightColor : DEFAULTS.highlightColor;
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      el.style.setProperty("background-color", `rgba(${r}, ${g}, ${b}, 0.3)`, "important");
    }
    lastHighlight = el;
  }

  function clearHighlight() {
    if (lastHighlight) {
      lastHighlight.classList.remove("readtrail-highlight");
      lastHighlight.style.setProperty("background-color", lastHighlightStyle.value, lastHighlightStyle.priority);
      lastHighlight = null;
      lastHighlightStyle = null;
    }
  }

  function ensureVisuals() {
    const R = getRenderer();
    if (!R || typeof R.ensureCanvas !== "function") return;
    try { R.ensureCanvas(); } catch (_) {}
  }

  function renderAtY(y) {
    const R = getRenderer();
    const s = settings;
    if (!R || !s || !Number.isFinite(y)) return;
    try {
      const state = savedVisual ? "saved" : mode;
      if (s.style === "ruler") R.renderRuler(y, s, state);
      else if (s.style === "underline") R.renderUnderline(y, s, state);
      else if (s.style === "dots") {
        const x = Number.isFinite(window.innerWidth) ? window.innerWidth / 2 : 0;
        R.renderDots([{ x: x, y: y, alpha: 1 }], s);
      }
    } catch (_) { /* fail safely */ }
  }

  function renderAtPoint(x, y) {
    const R = getRenderer();
    const s = settings;
    if (!R || !s) return;
    try {
      if (s.highlightLine) highlightLine(lineAtPoint(x, y));
      const state = savedVisual ? "saved" : mode;
      if (s.style === "dots") addTrailPoint(x, y);
      else if (s.style === "ruler") R.renderRuler(y, s, state);
      else if (s.style === "underline") R.renderUnderline(y, s, state);
    } catch (_) { /* fail safely */ }
  }

  function renderFrozenAnchor() {
    if (!lastPosition) return;
    let y = lastPosition.viewportOffset;
    const P = getPosition();
    try {
      const range = P && typeof P.resolveAnchor === "function"
        ? P.resolveAnchor(lastPosition.anchor, document.body)
        : null;
      const rect = range && typeof range.getBoundingClientRect === "function"
        ? range.getBoundingClientRect()
        : null;
      if (rect && Number.isFinite(rect.top)) {
        const height = Number.isFinite(rect.height) && rect.height > 0 ? rect.height : 0;
        y = rect.top + (height / 2);
      }
    } catch (_) { /* retain the captured viewport offset as a safe fallback */ }
    renderAtY(y);
  }

  function addTrailPoint(x, y) {
    trail.push({ x: x, y: y, alpha: 1 });
    while (trail.length > (settings.dotCount || 20)) trail.shift();
    if (!animFrame) animFrame = requestAnimationFrame(renderLoop);
  }

  function renderLoop() {
    animFrame = null;
    if (!isActive() || !settings || settings.style !== "dots") return;
    const R = getRenderer();
    if (!R) return;
    R.renderDots(trail, settings);
    trail.forEach((point) => { point.alpha *= settings.fadeSpeed; });
    trail = trail.filter((point) => point.alpha > 0.02);
    if (trail.length) animFrame = requestAnimationFrame(renderLoop);
  }

  function cancelTrailFrame() {
    if (animFrame) {
      cancelAnimationFrame(animFrame);
      animFrame = null;
    }
  }

  function clearVisual() {
    cancelTrailFrame();
    trail = [];
    clearHighlight();
    const R = getRenderer();
    if (!R) return;
    try {
      if (typeof R.clear === "function") R.clear();
      if (typeof R.removeCanvas === "function") R.removeCanvas();
    } catch (_) {}
  }

  // --- Position capture and throttled checkpoints ---

  function captureAt(x, y) {
    const P = getPosition();
    if (!P || typeof P.capture !== "function") return null;
    try {
      return P.capture(x, y);
    } catch (_) {
      return null;
    }
  }

  function currentSaveMode() {
    return mode === "frozen" ? "frozen" : "following";
  }

  function throttleSave(position) {
    if (!pageActive || !position) return;
    const elapsed = Date.now() - lastSavedAt;
    if (elapsed >= THROTTLE_MS) {
      clearSaveTimer();
      savePosition(position, currentSaveMode());
      return;
    }
    pendingSave = position;
    if (saveTimer != null) return;
    const remaining = THROTTLE_MS - elapsed;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (pendingSave && pageActive) {
        const pending = pendingSave;
        pendingSave = null;
        savePosition(pending, currentSaveMode());
      }
    }, remaining);
  }

  function clearSaveTimer() {
    if (saveTimer != null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    pendingSave = null;
  }

  function flushPendingSave(done) {
    if (!pageActive || !pendingSave) {
      if (done) done(true);
      return;
    }
    const position = pendingSave;
    clearSaveTimer();
    savePosition(position, currentSaveMode(), done);
  }

  // --- Click handling ---

  function clearClickTimer() {
    if (clickTimer != null) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
  }

  function hasTextSelection() {
    try {
      const sel = window.getSelection();
      return Boolean(sel && !sel.isCollapsed && String(sel).length > 0);
    } catch (_) {
      return false;
    }
  }

  function isValidReadingClick(e) {
    // Only a real pointer-originated primary click belongs to reading lock.
    // Keyboard activation and script-generated clicks remain an open product
    // question and must not silently create checkpoints.
    if (e.button !== 0 || e.detail < 1 || e.isTrusted !== true) return false;
    // Reading lock owns primary clicks before the page can act on them. Text
    // selection still wins: the click is blocked from the page but does not
    // change the checkpoint.
    e.preventDefault();
    e.stopImmediatePropagation();
    if (hasTextSelection()) return false;
    return true;
  }

  function deferClickToggle(clickPosition) {
    clearClickTimer();
    clickTimer = setTimeout(() => {
      clickTimer = null;
      toggleMode(clickPosition);
    }, CLICK_DEFER_MS);
  }

  function toggleMode(clickPosition) {
    if (!guardActive()) return;
    // A deliberate pause/resume is a checkpoint replacement: it clears any
    // transient "just saved" visual until the reader saves again.
    savedVisual = false;
    if (mode === "frozen") {
      setMode("following");
      lastPosition = clickPosition;
      renderAtY(clickPosition.viewportOffset);
      clearSaveTimer();
      savePosition(clickPosition, "following");
    } else if (mode === "following") {
      setMode("frozen");
      lastPosition = clickPosition;
      renderAtY(clickPosition.viewportOffset);
      clearSaveTimer();
      savePosition(clickPosition, "frozen"); // Freeze saves its position immediately.
    }
  }

  // --- Reading event handlers ---

  function onMouseMove(e) {
    if (!guardActive()) return;
    cursor.x = e.clientX;
    cursor.y = e.clientY;
    if (mode === "frozen") {
      // Frozen follows its anchored text line, not a fixed screen coordinate.
      renderFrozenAnchor();
      return;
    }
    const position = captureAt(cursor.x, cursor.y);
    if (position) {
      lastPosition = position;
      savedVisual = false; // Following to a new line clears the saved visual.
      renderAtPoint(cursor.x, cursor.y);
      throttleSave(position);
    }
  }

  function onClick(e) {
    if (!guardActive()) return;
    if (!isValidReadingClick(e)) return;
    const clickPosition = captureAt(e.clientX, e.clientY);
    if (!clickPosition) return;
    deferClickToggle(clickPosition);
  }

  function onDblClick(e) {
    if (!guardActive()) return;
    if (e.button !== 0 || e.detail < 2 || e.isTrusted !== true) return;
    // Double click is reserved for a later bookmark sprint; just cancel the
    // single-click transition so it cannot toggle state twice. Stop page
    // handlers while leaving the browser's native word selection available.
    e.stopImmediatePropagation();
    clearClickTimer();
  }

  function onScroll() {
    if (!guardActive() || mode !== "frozen") return;
    renderFrozenAnchor();
  }

  function onPageHide() {
    flushPendingSave();
  }

  // --- State transitions ---

  function attachListeners() {
    if (listenersAttached) return;
    listenersAttached = true;
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("click", onClick, true);
    document.addEventListener("dblclick", onDblClick, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("pagehide", onPageHide);
  }

  function removeListeners() {
    if (!listenersAttached) return;
    listenersAttached = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("dblclick", onDblClick, true);
    document.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("pagehide", onPageHide);
  }

  function setMode(next) {
    mode = next;
    if (next === "following") {
      ensureVisuals();
    }
  }

  function restoreScroll(position) {
    const P = getPosition();
    if (!P || typeof P.resolvePosition !== "function") return;
    let resolved = null;
    try {
      resolved = P.resolvePosition(position, document.body);
    } catch (_) {
      return;
    }
    if (!resolved || !Number.isFinite(resolved.scrollY)) return;
    try {
      window.scrollTo(0, resolved.scrollY);
    } catch (_) { /* fail safely when scrolling is unsupported */ }
  }

  function applyState(st) {
    if (!pageActive) return;
    const applied = normalizePageState(st) || emptyActiveState();
    setMode(applied.mode);
    if (applied.position) {
      lastPosition = applied.position;
      restoreScroll(applied.position);
      renderAtY(applied.position.viewportOffset);
    }
  }

  function activate(suppliedState, expectedRevision) {
    if (isDrifted() || (expectedRevision !== undefined && lifecycleRevision !== expectedRevision)) return;
    pageActive = true;
    ensureVisuals();
    attachListeners();
    const applied = normalizePageState(suppliedState);
    if (applied && applied.active) {
      applyState(applied);
    } else {
      fetchPageState((state) => {
        if (!pageActive || isDrifted()) return;
        if (expectedRevision !== undefined && lifecycleRevision !== expectedRevision) return;
        applyState(state && state.active ? state : emptyActiveState());
      });
    }
  }

  function deactivate() {
    lifecycleRevision += 1;
    pageActive = false;
    mode = "dormant";
    savedVisual = false;
    clearClickTimer();
    clearSaveTimer();
    removeListeners();
    clearVisual();
    lastPosition = null;
  }

  // --- Save for later bridge ---

  // Deep-clone a position record so the caller cannot mutate the in-memory
  // checkpoint after receiving the snapshot.
  function snapshotPosition(position) {
    if (!position || typeof position !== "object") return null;
    if (
      !position.anchor || typeof position.anchor !== "object"
      || !Array.isArray(position.anchor.path)
    ) return null;
    return {
      anchor: {
        version: position.anchor.version,
        path: [...position.anchor.path],
        offset: position.anchor.offset
      },
      viewportOffset: position.viewportOffset,
      scrollY: position.scrollY,
      scrollRatio: position.scrollRatio,
      savedAt: position.savedAt
    };
  }

  function handleSaveForLater(sendResponse) {
    if (!hasChrome()) {
      if (sendResponse) sendResponse({ ok: false, error: "runtime-unavailable" });
      return false;
    }

    if (!isActive()) {
      if (sendResponse) sendResponse({ ok: false, error: "inactive" });
      return false;
    }

    if (!lastPosition) {
      if (sendResponse) sendResponse({ ok: false, error: "no-checkpoint" });
      return false;
    }

    const snapshot = snapshotPosition(lastPosition);
    if (!snapshot) {
      if (sendResponse) sendResponse({ ok: false, error: "no-checkpoint" });
      return false;
    }

    try {
      chrome.runtime.sendMessage(
        {
          type: "persistResumePoint",
          url: location.href,
          title: document.title,
          position: snapshot
        },
        (response) => {
          if (chrome.runtime.lastError) {
            if (sendResponse) sendResponse({ ok: false, error: "persistence-failure" });
            return;
          }
          if (!response || !response.ok) {
            if (sendResponse) sendResponse({
              ok: false,
              error: "persistence-rejected",
              detail: response && response.error
            });
            return;
          }
          // Persistence succeeded: render the in-memory saved visual state for
          // this checkpoint. This is not a durable mode change and never writes
          // to session state.
          if (pageActive && lastPosition) {
            savedVisual = true;
            renderAtY(lastPosition.viewportOffset);
          }
          if (sendResponse) sendResponse({ ok: true });
        }
      );
    } catch (_) {
      if (sendResponse) sendResponse({ ok: false, error: "runtime-unavailable" });
      return false;
    }

    return true;
  }

  // --- Message and storage listeners ---

  function onRuntimeMessage(msg, _sender, sendResponse) {
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "setPageActive") {
      if (typeof msg.active !== "boolean") return;
      if (msg.active === true) {
        const revision = lifecycleRevision + 1;
        lifecycleRevision = revision;
        settingsReady.then(() => {
          if (lifecycleRevision !== revision) {
            if (sendResponse) sendResponse({ ok: false, error: "superseded" });
            return;
          }
          activate(msg.state, revision);
          if (sendResponse) sendResponse({ ok: pageActive });
        });
      } else {
        clearClickTimer();
        flushPendingSave((saved) => {
          if (!saved) {
            if (sendResponse) sendResponse({ ok: false, error: "save-failed" });
            return;
          }
          deactivate();
          if (sendResponse) sendResponse({ ok: true });
        });
      }
      return true;
    }
    if (msg.type === "saveForLater") {
      return handleSaveForLater(sendResponse);
    }
  }

  if (hasChrome()) {
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
  }

  const bindStorageEvents = (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged)
    ? chrome.storage.onChanged
    : null;
  if (bindStorageEvents) bindStorageEvents.addListener((changes) => {
    if (!changes.settings) return;
    settings = { ...DEFAULTS, ...(changes.settings.newValue || {}) };
    cancelTrailFrame();
    trail = [];
    const R = getRenderer();
    if (R && typeof R.clear === "function") {
      try { R.clear(); } catch (_) {}
    }
    if (!settings.highlightLine) clearHighlight();
    // Re-render the current marker so appearance edits apply immediately.
    if ((mode === "following" || mode === "frozen") && lastPosition) {
      renderAtY(lastPosition.viewportOffset);
    }
  });

  const settingsReady = loadSettings();
  const bootstrapRevision = lifecycleRevision;
  settingsReady.then(() => {
    fetchPageState((state) => {
      if (lifecycleRevision !== bootstrapRevision) return;
      if (state && state.active) activate(state, bootstrapRevision);
    });
  });
})();
