(() => {
  var R = window.ReadTrailRenderer;
  var DEFAULTS = { enabled: true, style: "ruler", color: "#FF6B6B", size: 30, opacity: 0.3, dotCount: 20, fadeSpeed: 0.9, highlightLine: false, highlightColor: "#FFEB3B" };
  var settings = null;
  var enabled = false;
  var trail = [];
  var lastHighlight = null;
  var lastHighlightStyle = null;
  var animFrame = null;
  var cursor = { x: 0, y: 0 };
  var started = false;

  function loadSettings() {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: "getSettings" }, function (s) {
          if (chrome.runtime.lastError || !s) {
            settings = { ...DEFAULTS };
          } else {
            settings = { ...DEFAULTS, ...s };
          }
          enabled = settings.enabled;
          resolve();
        });
      } catch (e) {
        settings = { ...DEFAULTS };
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
      lastHighlight.style.setProperty("background-color", lastHighlightStyle.value, lastHighlightStyle.priority);
      lastHighlightStyle = null;
    }
    if (el && lastHighlight !== el) {
      lastHighlightStyle = {
        value: el.style.getPropertyValue("background-color"),
        priority: el.style.getPropertyPriority("background-color")
      };
      el.classList.add("readtrail-highlight");
      var color = /^#[0-9a-f]{6}$/i.test(settings.highlightColor) ? settings.highlightColor : DEFAULTS.highlightColor;
      var r = parseInt(color.slice(1, 3), 16);
      var g = parseInt(color.slice(3, 5), 16);
      var b = parseInt(color.slice(5, 7), 16);
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

  function onMouseMove(e) {
    cursor.x = e.clientX;
    cursor.y = e.clientY;

    if (settings && settings.highlightLine) {
      var el = getLineAtPoint(cursor.x, cursor.y);
      highlightLine(el);
    }

    if (settings && settings.style === "dots") {
      trail.push({ x: cursor.x, y: cursor.y, alpha: 1 });
      while (trail.length > (settings.dotCount || 20)) {
        trail.shift();
      }
      if (!animFrame) animFrame = requestAnimationFrame(renderLoop);
    } else if (settings && settings.style === "ruler") {
      R.renderRuler(cursor.y, settings);
    } else if (settings && settings.style === "underline") {
      R.renderUnderline(cursor.y, settings);
    }
  }

  function renderLoop() {
    animFrame = null;
    if (!enabled || !settings || settings.style !== "dots") {
      return;
    }

    R.renderDots(trail, settings);
    trail.forEach(function (point) {
      point.alpha *= settings.fadeSpeed;
    });
    trail = trail.filter(function (point) {
      return point.alpha > 0.02;
    });
    if (trail.length) animFrame = requestAnimationFrame(renderLoop);
  }

  function onMouseLeave() {
    R.clear();
    clearHighlight();
    trail = [];
    if (animFrame) {
      cancelAnimationFrame(animFrame);
      animFrame = null;
    }
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
      settings = { ...DEFAULTS, ...(changes.settings.newValue || {}) };
      enabled = settings.enabled;
      R.clear();
      trail = [];
      if (animFrame) {
        cancelAnimationFrame(animFrame);
        animFrame = null;
      }
      if (!settings.highlightLine) clearHighlight();
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
