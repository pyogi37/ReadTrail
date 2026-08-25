(() => {
  var R = window.ReadTrailRenderer;
  var settings = null;
  var enabled = false;
  var trail = [];
  var lastHighlight = null;
  var animFrame = null;
  var cursor = { x: 0, y: 0 };
  var started = false;

  function loadSettings() {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: "getSettings" }, function (s) {
          if (chrome.runtime.lastError || !s) {
            settings = { enabled: true, style: "ruler", color: "#FF6B6B", size: 30, opacity: 0.3, dotCount: 20, fadeSpeed: 0.9, highlightLine: false, highlightColor: "#FFEB3B" };
          } else {
            settings = s;
          }
          enabled = settings.enabled;
          resolve();
        });
      } catch (e) {
        settings = { enabled: true, style: "ruler", color: "#FF6B6B", size: 30, opacity: 0.3, dotCount: 20, fadeSpeed: 0.9, highlightLine: false, highlightColor: "#FFEB3B" };
        enabled = settings.enabled;
        resolve();
      }
    });
  }

  function getLineAtPoint(x, y) {
    var range = document.caretRangeFromPoint(x, y);
    if (!range) return null;
    var node = range.startContainer;
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;
    var el = node.parentElement;
    if (!el) return null;
    return el.closest("p, div, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, dt, dd, section, article");
  }

  function highlightLine(el) {
    if (lastHighlight && lastHighlight !== el) {
      lastHighlight.classList.remove("readtrail-highlight");
    }
    if (el) {
      el.classList.add("readtrail-highlight");
    }
    lastHighlight = el;
  }

  function clearHighlight() {
    if (lastHighlight) {
      lastHighlight.classList.remove("readtrail-highlight");
      lastHighlight = null;
    }
  }

  function onMouseMove(e) {
    cursor.x = e.clientX;
    cursor.y = e.clientY;

    if (settings && settings.highlightLine) {
      var el = getLineAtPoint(cursor.x, cursor.y);
      highlightLine(el);
    }

    if (settings && settings.style === "dots") {
      trail.push({ x: cursor.x, y: cursor.y });
      while (trail.length > (settings.dotCount || 20)) {
        trail.shift();
      }
    }
  }

  function renderLoop() {
    if (!enabled || !settings) {
      animFrame = requestAnimationFrame(renderLoop);
      return;
    }

    if (settings.style === "ruler") {
      R.renderRuler(cursor.y, settings);
    } else if (settings.style === "dots") {
      R.renderDots(trail, settings);
    } else if (settings.style === "underline") {
      R.renderUnderline(cursor.y, settings);
    }

    animFrame = requestAnimationFrame(renderLoop);
  }

  function onMouseLeave() {
    R.clear();
    clearHighlight();
    trail = [];
  }

  function onMouseEnter() {
    R.ensureCanvas();
  }

  function start() {
    if (started) return;
    started = true;
    R.ensureCanvas();
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseleave", onMouseLeave);
    document.addEventListener("mouseenter", onMouseEnter);
    animFrame = requestAnimationFrame(renderLoop);
  }

  function stop() {
    started = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseleave", onMouseLeave);
    document.removeEventListener("mouseenter", onMouseEnter);
    R.clear();
    R.removeCanvas();
    clearHighlight();
    trail = [];
    if (animFrame) {
      cancelAnimationFrame(animFrame);
      animFrame = null;
    }
  }

  chrome.storage.onChanged.addListener(function (changes) {
    if (changes.settings) {
      settings = changes.settings.newValue;
      enabled = settings.enabled;
      if (enabled && !started) start();
      if (!enabled && started) stop();
    }
  });

  loadSettings().then(function () {
    if (enabled) start();
  });

  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg.type === "toggleEnabled") {
      enabled = msg.enabled;
      if (enabled && !started) start();
      if (!enabled && started) stop();
    }
  });
})();
