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

  function renderRuler(y, settings) {
    ensureCanvas();
    if (!ctx) return;
    var halfH = settings.size / 2;
    ctx.clearRect(0, 0, viewportWidth, viewportHeight);

    ctx.fillStyle = parseColor(settings.color, settings.opacity);
    ctx.fillRect(0, y - halfH, viewportWidth, settings.size);

    ctx.strokeStyle = parseColor(settings.color, Math.min(settings.opacity + 0.3, 1));
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y - halfH);
    ctx.lineTo(viewportWidth, y - halfH);
    ctx.moveTo(0, y + halfH);
    ctx.lineTo(viewportWidth, y + halfH);
    ctx.stroke();
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

  function renderUnderline(y, settings) {
    ensureCanvas();
    if (!ctx) return;
    ctx.clearRect(0, 0, viewportWidth, viewportHeight);

    ctx.save();
    ctx.shadowColor = settings.color;
    ctx.shadowBlur = settings.size;
    ctx.strokeStyle = parseColor(settings.color, Math.min(settings.opacity + 0.2, 1));
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(viewportWidth, y);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = parseColor(settings.color, settings.opacity);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(viewportWidth, y);
    ctx.stroke();
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
