"use strict";

// The flowing sky behind the page: a slow current of stardust, one golden lucky
// star riding it with a glitter trail, and now and then a shooting star.
// Decorative only (the canvas is aria-hidden); a still frame under reduced motion.
(() => {
  const canvas = document.getElementById("sky-bg");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  let W = 0, H = 0, dust = [], trail = [], shot = null, nextShot = 2600, colors = {}, raf = 0, last = 0;

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name) => cs.getPropertyValue(name).trim();
    colors = { dust: [v("--dust-1"), v("--dust-2"), v("--dust-3")], lucky: v("--lucky"), glow: v("--lucky-glow"), edge: v("--lucky-edge") || "transparent" };
  }

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(190, Math.max(60, (W * H) / 7000)));
    dust = Array.from({ length: n }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: 0.8 + Math.random() ** 2 * 2.4,
      speed: 0.12 + Math.random() * 0.35,
      phase: Math.random() * Math.PI * 2,
      tw: 0.4 + Math.random() * 1.2,
      c: Math.random() < 0.55 ? 0 : Math.random() < 0.6 ? 1 : 2,
    }));
    trail = [];
  }

  // A gentle rightward current that bends in slow waves.
  function flow(x, y, t) {
    const a = Math.sin(y * 0.0045 + t * 0.00012) * 0.55 + Math.sin(x * 0.0021 - t * 0.00008) * 0.35;
    return [Math.cos(a), Math.sin(a) * 0.7];
  }

  function sparkle(x, y, r) {
    const k = r * 2.6;
    ctx.beginPath();
    ctx.moveTo(x, y - k);
    ctx.quadraticCurveTo(x, y, x + k, y);
    ctx.quadraticCurveTo(x, y, x, y + k);
    ctx.quadraticCurveTo(x, y, x - k, y);
    ctx.quadraticCurveTo(x, y, x, y - k);
    ctx.fill();
  }

  function starPath(x, y, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = rot - Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.46 : r;
      ctx[i ? "lineTo" : "moveTo"](x + rr * Math.cos(a), y + rr * Math.sin(a));
    }
    ctx.closePath();
  }

  // The lucky star crosses the upper sky once every 32 s on a soft wave.
  function luckyAt(t) {
    const u = (t / 32000) % 1;
    return [-60 + u * (W + 120), H * 0.24 + Math.sin(u * Math.PI * 3) * H * 0.07 + Math.sin(t * 0.0011) * 5];
  }

  function draw(t, dt) {
    ctx.clearRect(0, 0, W, H);
    // Quieter once the header has scrolled away, so reading stays calm.
    const calm = 1 - Math.min(0.45, scrollY / 1400);

    for (const p of dust) {
      if (dt) {
        const [vx, vy] = flow(p.x, p.y, t);
        p.x += vx * p.speed * dt * 0.075;
        p.y += vy * p.speed * dt * 0.075;
        if (p.x > W + 12) { p.x = -12; p.y = Math.random() * H; }
        else if (p.x < -12) p.x = W + 12;
        if (p.y > H + 12) p.y = -12;
        else if (p.y < -12) p.y = H + 12;
      }
      ctx.globalAlpha = (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(p.phase + t * 0.001 * p.tw))) * calm;
      ctx.fillStyle = colors.dust[p.c];
      if (p.r > 1.9) sparkle(p.x, p.y, p.r * 0.75);
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
    }

    if (dt && !shot && t > nextShot) {
      shot = { x: W * (0.35 + Math.random() * 0.6), y: H * Math.random() * 0.25, born: t };
      nextShot = t + 9000 + Math.random() * 9000;
    }
    if (shot) {
      const age = t - shot.born, life = 950;
      if (age > life) shot = null;
      else {
        const vx = -0.62, vy = 0.45, hx = shot.x + vx * age, hy = shot.y + vy * age;
        const len = 150 * Math.sin((Math.PI * age) / life);
        const g = ctx.createLinearGradient(hx, hy, hx - vx * len, hy - vy * len);
        g.addColorStop(0, colors.lucky);
        g.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.globalAlpha = 0.9 * calm;
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.8;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx - vx * len, hy - vy * len);
        ctx.stroke();
      }
    }

    const [lx, ly] = luckyAt(t);
    if (dt) {
      trail.push({ x: lx + (Math.random() - 0.5) * 8, y: ly + (Math.random() - 0.5) * 8, r: 0.7 + Math.random() * 1.5, life: 1 });
      if (trail.length > 180) trail.shift();
    }
    ctx.fillStyle = colors.lucky;
    for (const s of trail) {
      if (dt) { s.life -= dt / 2200; s.y += dt * 0.004; }
      if (s.life <= 0) continue;
      ctx.globalAlpha = s.life * 0.75 * calm;
      if (s.r > 1.8) sparkle(s.x, s.y, s.r * 0.6);
      else { ctx.beginPath(); ctx.arc(s.x, s.y, s.r * s.life, 0, Math.PI * 2); ctx.fill(); }
    }
    trail = trail.filter((s) => s.life > 0);

    const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, 46);
    glow.addColorStop(0, colors.glow);
    glow.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.globalAlpha = calm;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(lx, ly, 46, 0, Math.PI * 2);
    ctx.fill();
    starPath(lx, ly, 12, t * 0.0005);
    ctx.fillStyle = colors.lucky;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.edge;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    const dt = last ? Math.min(50, now - last) : 16;
    last = now;
    draw(now, dt);
    raf = requestAnimationFrame(frame);
  }
  function start() {
    cancelAnimationFrame(raf);
    last = 0;
    if (still.matches || document.hidden) draw(12000, 0);
    else raf = requestAnimationFrame(frame);
  }

  readColors();
  resize();
  start();
  addEventListener("resize", () => { resize(); if (still.matches) draw(12000, 0); });
  document.addEventListener("visibilitychange", start);
  still.addEventListener("change", start);
  const recolor = () => { readColors(); if (still.matches) draw(12000, 0); };
  new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", recolor);
})();
