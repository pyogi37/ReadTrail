(() => {
  let canvas = null;
  let ctx = null;
  let viewportWidth = 0;
  let viewportHeight = 0;

  function resizeCanvas() {
    if (!canvas || !ctx) return;
    const scale = Math.max(1, window.devicePixelRatio || 1);
    viewportWidth = window.innerWidth;
    viewportHeight = window.innerHeight;
    canvas.width = Math.round(viewportWidth * scale);
    canvas.height = Math.round(viewportHeight * scale);
    canvas.style.width = `${viewportWidth}px`;
    canvas.style.height = `${viewportHeight}px`;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  function ensureCanvas() {
    if (canvas && document.body.contains(canvas)) return;
    canvas = document.createElement("canvas");
    canvas.dataset.readtrailCanvas = "true";
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100vw",
      height: "100vh",
      pointerEvents: "none",
      zIndex: "2147483647"
    });
    document.body.appendChild(canvas);
    ctx = canvas.getContext("2d");
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas, { passive: true });
  }

  function removeCanvas() {
    window.removeEventListener("resize", resizeCanvas);
    if (canvas && canvas.parentNode) {
      canvas.remove();
    }
    canvas = null;
    ctx = null;
  }

  function parseColor(hex, alpha) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) hex = "#FF6B6B";
    alpha = Math.min(1, Math.max(0, Number(alpha) || 0));
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  // Visual state affects the shape and emphasis of the line marker so that
  // following, frozen, and saved are distinguishable without relying on color
  // alone. State is purely a rendering hint; it never drives persisted modes.
  var SAVED_COLOR = "#C9A227"; // Warm-gold distinguishes a deliberate save.
  var STATIC_COLOR = "#FFFFFF"; // Strong neutral for the frozen "stopped" caps.

  // The ruler and underline span the text they are on, {left, right} in
  // viewport pixels. Without an extent they span the viewport.
  function spanOf(extent) {
    var left = extent && Number.isFinite(extent.left) ? Math.max(0, extent.left) : 0;
    var right = extent && Number.isFinite(extent.right) ? Math.min(viewportWidth, extent.right) : viewportWidth;
    return right > left ? { left: left, right: right } : { left: 0, right: viewportWidth };
  }

  function renderRuler(y, settings, state, extent) {
    ensureCanvas();
    if (!ctx) return;
    var halfH = settings.size / 2;
    var span = spanOf(extent);
    var left = span.left;
    var right = span.right;
    ctx.clearRect(0, 0, viewportWidth, viewportHeight);

    if (state === "saved") {
      // Saved: warm-gold band with dashed edges and a left edge flag so it is
      // distinguishable by shape as well as color. Dashes imply "a placed mark".
      ctx.fillStyle = parseColor(SAVED_COLOR, settings.opacity);
      ctx.fillRect(left, y - halfH, right - left, settings.size);
      ctx.strokeStyle = parseColor(SAVED_COLOR, Math.min(settings.opacity + 0.35, 1));
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(left, y - halfH);
      ctx.lineTo(right, y - halfH);
      ctx.moveTo(left, y + halfH);
      ctx.lineTo(right, y + halfH);
      ctx.stroke();
      ctx.setLineDash([]);
      // Flag protruding from the left end.
      ctx.fillStyle = parseColor(SAVED_COLOR, 1);
      ctx.fillRect(left + 4, y - halfH - 10, 8, 10);
    } else if (state === "frozen") {
      // Frozen: translucent band with solid "stopped" end caps on both ends
      // and a solid center line to read as an explicitly halted marker.
      ctx.fillStyle = parseColor(settings.color, settings.opacity);
      ctx.fillRect(left, y - halfH, right - left, settings.size);
      ctx.strokeStyle = parseColor(STATIC_COLOR, 0.9);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      // Solid end caps (a visual "stopper").
      ctx.fillStyle = parseColor(STATIC_COLOR, 0.9);
      ctx.fillRect(left, y - halfH, 5, settings.size);
      ctx.fillRect(right - 5, y - halfH, 5, settings.size);
    } else {
      // Following: light, translucent band with thin edges (the default).
      ctx.fillStyle = parseColor(settings.color, settings.opacity);
      ctx.fillRect(left, y - halfH, right - left, settings.size);

      ctx.strokeStyle = parseColor(settings.color, Math.min(settings.opacity + 0.3, 1));
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(left, y - halfH);
      ctx.lineTo(right, y - halfH);
      ctx.moveTo(left, y + halfH);
      ctx.lineTo(right, y + halfH);
      ctx.stroke();
    }
  }

  function renderDots(trail, settings) {
    ensureCanvas();
    if (!ctx) return;
    ctx.clearRect(0, 0, viewportWidth, viewportHeight);

    for (var i = 0; i < trail.length; i++) {
      var t = trail[i];
      var progress = (i + 1) / trail.length;
      var alpha = progress * settings.opacity * (t.alpha ?? 1);
      var radius = Math.max(2, (settings.size / 10) * progress);

      ctx.beginPath();
      ctx.arc(t.x, t.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = parseColor(settings.color, alpha);
      ctx.fill();
    }
  }

  function renderUnderline(y, settings, state, extent) {
    ensureCanvas();
    if (!ctx) return;
    var span = spanOf(extent);
    var left = span.left;
    var right = span.right;
    ctx.clearRect(0, 0, viewportWidth, viewportHeight);
    // The glow (shadowBlur) spreads past the line's ends, so it is cut at the text's.
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, 0, right - left, viewportHeight);
    ctx.clip();

    if (state === "saved") {
      // Saved: dashed warm-gold underline with a filled end badge, making it
      // structurally distinct from the solid following/frozen lines.
      ctx.strokeStyle = parseColor(SAVED_COLOR, Math.min(settings.opacity + 0.3, 1));
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 7]);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = parseColor(SAVED_COLOR, 1);
      ctx.beginPath();
      ctx.arc(right - 10, y, 5, 0, Math.PI * 2);
      ctx.fill();
    } else if (state === "frozen") {
      // Frozen: bright, thick solid line reading as a "stopped" marker.
      ctx.save();
      ctx.shadowColor = settings.color;
      ctx.shadowBlur = settings.size;
      ctx.strokeStyle = parseColor(STATIC_COLOR, 0.9);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = parseColor(STATIC_COLOR, 0.9);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    } else {
      // Following: soft translucent glow line (the default).
      ctx.save();
      ctx.shadowColor = settings.color;
      ctx.shadowBlur = settings.size;
      ctx.strokeStyle = parseColor(settings.color, Math.min(settings.opacity + 0.2, 1));
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = parseColor(settings.color, settings.opacity);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function clear() {
    if (ctx && canvas) {
      ctx.clearRect(0, 0, viewportWidth, viewportHeight);
    }
  }

  window.ReadTrailRenderer = {
    ensureCanvas: ensureCanvas,
    removeCanvas: removeCanvas,
    renderRuler: renderRuler,
    renderDots: renderDots,
    renderUnderline: renderUnderline,
    clear: clear
  };
})();
