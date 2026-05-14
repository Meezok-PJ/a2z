(function () {
  const canvas = document.getElementById('liquid-bg');
  if (!canvas) {
    console.warn('[A2Z Liquid] Missing #liquid-bg canvas target.');
    return;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.warn('[A2Z Liquid] 2D canvas context unavailable.');
    return;
  }

  const blobs = [
    { x: 0.2, y: 0.68, radius: 0.55, hue: 350, alpha: 0.36, speedX: 0.22, speedY: 0.19, phase: 0.0 },
    { x: 0.82, y: 0.26, radius: 0.52, hue: 224, alpha: 0.34, speedX: 0.17, speedY: 0.21, phase: 1.9 }
  ];
  let width = 0;
  let height = 0;
  let lastTime = 0;
  let baseGradient = null;
  let running = true;

  function lerp(a, b, t) {
    return a + ((b - a) * t);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    width = canvas.width;
    height = canvas.height;
    baseGradient = ctx.createLinearGradient(0, 0, width, height);
    baseGradient.addColorStop(0.0, '#13060e');
    baseGradient.addColorStop(0.5, '#241348');
    baseGradient.addColorStop(1.0, '#0a1a43');
  }

  function draw(timeMs) {
    if (!running) return;
    const dt = lastTime ? Math.min((timeMs - lastTime) / 1000, 0.05) : 0.016;
    lastTime = timeMs;
    const t = timeMs * 0.001;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = baseGradient;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = 'screen';
    blobs.forEach((blob) => {
      const driftX = Math.sin(t * blob.speedX + blob.phase) * 0.08;
      const driftY = Math.cos(t * blob.speedY + blob.phase) * 0.08;
      const cx = (blob.x + driftX) * width;
      const cy = (blob.y + driftY) * height;
      const radius = blob.radius * Math.min(width, height);
      const hueShift = (Math.sin(t * 0.35 + blob.phase) + 1) * 0.5;
      const hue = lerp(blob.hue - 8, blob.hue + 8, hueShift);
      const g = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius);
      g.addColorStop(0.0, `hsla(${hue}, 95%, 58%, ${blob.alpha})`);
      g.addColorStop(1.0, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
    });
    ctx.globalCompositeOperation = 'source-over';

    if (dt >= 0) {
      requestAnimationFrame(draw);
    }
  }

  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) {
      lastTime = 0;
      requestAnimationFrame(draw);
    }
  });

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(draw);
})();
