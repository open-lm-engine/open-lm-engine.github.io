// Dark-mode sky: an animated canvas behind the page.
//
//   * a deep background of small galaxies (spiral, elliptical, edge-on) and
//     large faint nebulae, pre-rendered once and drifting slowest of all
//   * stars, weighted toward the margins so the text column stays quiet, each
//     at its own depth (parallax rate) with a slow twinkle
//   * the blue star off the left edge (Rigel is a blue supergiant) with three
//     planets on near edge-on orbits, passing in front of and behind it
//   * a ringed giant you pass on the right a few screens down, with two moons
//   * a small distant red planet further down on the left
//   * a black hole with a lensed accretion disc, deeper still on the right
//   * a wormhole on the left near the end, out of which a warship jumps
//   * comets streaking across at random intervals
//
// Everything is drawn with 2D canvas on one requestAnimationFrame loop. The
// loop only runs while the sky is visible (dark theme, not switched off by the
// header toggle, tab in the foreground). Under reduced motion we draw a static
// frame and only redraw on scroll/resize.

type Star = {
  x: number;
  y: number;
  z: number; // depth 0..1, 1 = nearest (fastest parallax, brightest)
  r: number;
  a: number;
  phase: number;
  speed: number;
  tint: string;
};

type DeepObject = {
  sprite: HTMLCanvasElement;
  x: number; // field-space position (see drawStars for the wrap)
  y: number;
  w: number; // drawn size in CSS px
  h: number;
  rate: number; // parallax rate, slower than any star
  alpha: number;
  side: -1 | 1; // which margin it lives in (left / right); drawing clips to it
};

type Comet = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  len: number;
};

const TAU = Math.PI * 2;
const STAR_TINTS = ['255,255,255', '255,255,255', '255,255,255', '214,228,255', '255,238,214', '196,216,255'];

const canvas = document.querySelector<HTMLCanvasElement>('.sky-canvas');
const root = document.documentElement;

if (canvas) {
  // desynchronized lets the browser present the canvas without waiting on
  // the DOM compositor, which is cheaper for a full-screen animated layer
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true })!;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const darkMq = window.matchMedia('(prefers-color-scheme: dark)');

  let W = 0;
  let H = 0;
  let dpr = 1;
  let stars: Star[] = [];
  let deep: DeepObject[] = [];
  let comets: Comet[] = [];
  let nextComet = 0;
  let glow: HTMLCanvasElement | null = null;
  let glowR = 0;
  let active = false;
  let raf = 0;
  let last = 0;
  let t = 0; // seconds of animation time
  let scrollY = 0;
  let scheduled = false;

  const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

  // High quality (header control) restores the retina canvas, the full frame
  // rate and the CSS far-layer parallax; the default is the cheaper mode.
  const highQuality = () => root.getAttribute('data-sky-quality') === 'high';

  // ---- visibility -------------------------------------------------------

  function skyVisible(): boolean {
    if (root.getAttribute('data-sky') !== 'on') return false; // visitor turned the stars off
    const theme = root.getAttribute('data-theme');
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return darkMq.matches;
  }

  function updateActive() {
    const next = skyVisible() && !document.hidden;
    if (next === active) return;
    active = next;
    if (active) {
      last = 0;
      if (!raf) raf = requestAnimationFrame(frame);
    }
  }

  // ---- layout ------------------------------------------------------------

  function columnBounds(): [number, number] {
    // most specific first: a single selector list would return whichever
    // matches first in document order, which is the full-width <main>
    const el =
      document.querySelector('.article-content') ??
      document.querySelector('.home-shell') ??
      document.querySelector('main');
    if (!el) return [W / 2, W / 2];
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.width >= W - 40) return [W / 2, W / 2]; // no real margins to speak of
    return [r.left, r.right];
  }

  function buildStars() {
    const [colL, colR] = columnBounds();
    const count = Math.round((W * (H + 600)) / 11000);
    stars = [];
    let guard = 0;
    while (stars.length < count && guard++ < count * 6) {
      const x = Math.random() * W;
      const inColumn = x > colL - 40 && x < colR + 40;
      if (inColumn && Math.random() > 0.22) continue; // sparse over the text
      const z = Math.pow(Math.random(), 1.6);
      stars.push({
        x,
        y: Math.random() * (H + 600),
        z,
        r: 0.5 + z * 1.3,
        a: 0.25 + z * 0.6,
        phase: Math.random() * TAU,
        speed: rand(0.35, 1.3),
        tint: STAR_TINTS[Math.floor(Math.random() * STAR_TINTS.length)],
      });
    }
  }


  // ---- deep background: galaxies and nebulae ------------------------------

  function spriteCanvas(size: number) {
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(size * dpr);
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.translate(size / 2, size / 2);
    return { c, g };
  }

  // a spiral, elliptical or edge-on galaxy, seen at a random tilt
  function renderGalaxy(size: number): HTMLCanvasElement {
    const { c, g } = spriteCanvas(size);
    const R = size * 0.42;
    const kind = Math.random();
    const tilt = rand(0, Math.PI);
    const squash = kind < 0.55 ? rand(0.35, 0.8) : kind < 0.8 ? rand(0.6, 0.9) : rand(0.12, 0.2);
    g.rotate(tilt);
    g.globalCompositeOperation = 'lighter';

    // disc glow
    g.save();
    g.scale(1, squash);
    const disc = g.createRadialGradient(0, 0, 0, 0, 0, R);
    disc.addColorStop(0, 'rgba(255,240,220,0.55)');
    disc.addColorStop(0.25, 'rgba(210,205,240,0.28)');
    disc.addColorStop(0.7, 'rgba(150,160,230,0.08)');
    disc.addColorStop(1, 'rgba(150,160,230,0)');
    g.fillStyle = disc;
    g.beginPath();
    g.arc(0, 0, R, 0, TAU);
    g.fill();
    g.restore();

    if (kind < 0.55) {
      // spiral: two or three log-spiral arms traced with faint dots
      const arms = Math.random() < 0.6 ? 2 : 3;
      const wind = rand(2.2, 3.4);
      const n = 260;
      for (let i = 0; i < n; i++) {
        const t = Math.pow(Math.random(), 0.7);
        const arm = i % arms;
        const theta = t * wind + (arm * TAU) / arms + rand(-0.25, 0.25) * (1 - t * 0.5);
        const r = R * (0.12 + 0.88 * t) * rand(0.92, 1.08);
        const x = r * Math.cos(theta);
        const y = r * Math.sin(theta) * squash;
        const a = (0.5 - 0.35 * t) * rand(0.5, 1);
        const blue = t > 0.45 && Math.random() < 0.5;
        g.fillStyle = blue ? `rgba(190,210,255,${a.toFixed(3)})` : `rgba(255,236,210,${a.toFixed(3)})`;
        g.beginPath();
        g.arc(x, y, rand(0.4, 1.1), 0, TAU);
        g.fill();
      }
    } else if (kind >= 0.8) {
      // edge-on: a bright thin lens with a dark dust lane
      g.save();
      g.scale(1, squash);
      const lens = g.createRadialGradient(0, 0, 0, 0, 0, R);
      lens.addColorStop(0, 'rgba(255,238,215,0.6)');
      lens.addColorStop(0.5, 'rgba(230,220,240,0.22)');
      lens.addColorStop(1, 'rgba(200,200,240,0)');
      g.fillStyle = lens;
      g.beginPath();
      g.arc(0, 0, R, 0, TAU);
      g.fill();
      g.restore();
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(-R * 0.9, -R * squash * 0.12, R * 1.8, R * squash * 0.24);
      g.globalCompositeOperation = 'lighter';
    }

    // core
    const core = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.22);
    core.addColorStop(0, 'rgba(255,250,240,0.95)');
    core.addColorStop(0.4, 'rgba(255,236,210,0.5)');
    core.addColorStop(1, 'rgba(255,230,200,0)');
    g.fillStyle = core;
    g.beginPath();
    g.arc(0, 0, R * 0.22, 0, TAU);
    g.fill();
    return c;
  }

  const NEBULA_PALETTES: [string, string][] = [
    ['60,140,170', '120,90,200'],   // teal into violet
    ['190,70,140', '90,60,180'],    // magenta into indigo
    ['200,120,70', '150,60,90'],    // amber into rose
    ['70,110,200', '150,120,220'],  // blue into lavender
  ];

  // a diffuse cloud: a dozen soft blobs in two colours, a few knots of stars
  // `fadeEnd` is the distance (px) from the sprite's centre to the text
  // column's edge: the cloud is fully transparent from there on, so it needs
  // no clipping and never shows a hard edge
  function renderNebula(size: number, side: -1 | 1, fadeEnd: number): HTMLCanvasElement {
    const { c, g } = spriteCanvas(size);
    const [c1, c2] = NEBULA_PALETTES[Math.floor(Math.random() * NEBULA_PALETTES.length)];
    g.globalCompositeOperation = 'lighter';
    const blobs = 12;
    for (let i = 0; i < blobs; i++) {
      const ang = rand(0, TAU);
      const d = rand(0, size * 0.22);
      const x = Math.cos(ang) * d;
      const y = Math.sin(ang) * d * rand(0.5, 1);
      const r = rand(size * 0.16, size * 0.34);
      const col = Math.random() < 0.55 ? c1 : c2;
      const a = rand(0.05, 0.11);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${col},${a.toFixed(3)})`);
      grad.addColorStop(0.5, `rgba(${col},${(a * 0.45).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }
    // dark rifts, so it isn't one smooth blob
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 4; i++) {
      const x = rand(-size * 0.2, size * 0.2);
      const y = rand(-size * 0.2, size * 0.2);
      const r = rand(size * 0.08, size * 0.18);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(0,0,0,0.5)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }
    // a few young stars lighting it from inside
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const x = rand(-size * 0.22, size * 0.22);
      const y = rand(-size * 0.22, size * 0.22);
      const r = rand(3, 6);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.85)');
      grad.addColorStop(0.25, 'rgba(235,240,255,0.35)');
      grad.addColorStop(1, 'rgba(230,235,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }
    // fade out toward the text column, reaching zero just short of its edge
    g.globalCompositeOperation = 'destination-out';
    const end = Math.min(fadeEnd * 0.92, size / 2);
    const fade = g.createLinearGradient(side * end * 0.25, 0, side * end, 0);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(0.5, 'rgba(0,0,0,0.55)');
    fade.addColorStop(0.85, 'rgba(0,0,0,0.95)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = fade;
    g.fillRect(-size / 2, -size / 2, size, size);
    // and everything beyond that edge is removed outright
    g.fillStyle = 'rgba(0,0,0,1)';
    if (side < 0) g.fillRect(-size / 2, -size / 2, size / 2 - end, size);
    else g.fillRect(end, -size / 2, size / 2 - end, size);
    return c;
  }

  // Galaxies and nebulae live only in the margins beside the text column, so
  // they never clutter the words. Galaxies must fit entirely in a margin;
  // nebulae are sized to the margin and fade to nothing before the column's
  // edge (baked into the sprite, so no clipping and no hard edge). Too little
  // margin → none at all.
  let marginEdgeL = 0; // right edge of the left margin (column left − gap)
  let marginEdgeR = 0; // left edge of the right margin (column right + gap)

  function buildDeep() {
    const [colL, colR] = columnBounds();
    const gap = 24;
    marginEdgeL = colL - gap;
    marginEdgeR = colR + gap;
    const widthL = marginEdgeL;
    const widthR = W - marginEdgeR;
    const span = H + 600;
    deep = [];
    if (Math.max(widthL, widthR) < 90) return;

    const pickSide = (): -1 | 1 => (Math.random() * (widthL + widthR) < widthL ? -1 : 1);
    const marginWidth = (side: -1 | 1) => (side < 0 ? widthL : widthR);

    const galaxies = Math.max(3, Math.round((W * span) / 300000));
    for (let i = 0; i < galaxies; i++) {
      const side = pickSide();
      const mw = marginWidth(side);
      const size = Math.min(rand(26, 74), mw * 0.7);
      const w = size * 1.2;
      if (mw < w + 8) continue;
      const off = rand(w / 2 + 4, mw - w / 2 - 4); // distance from the screen edge
      deep.push({
        sprite: renderGalaxy(w),
        x: side < 0 ? off : W - off,
        y: Math.random() * span,
        w,
        h: w,
        rate: rand(0.025, 0.04),
        alpha: rand(0.55, 0.9),
        side,
      });
    }
    const nebulae = Math.max(2, Math.round((W * span) / 700000));
    for (let i = 0; i < nebulae; i++) {
      const side = pickSide();
      const mw = marginWidth(side);
      if (mw < 90) continue;
      const size = Math.min(rand(320, 620), mw * 2.1);
      const centre = rand(mw * 0.3, mw * 0.6); // sits well inside the margin
      deep.push({
        sprite: renderNebula(size, side, mw - centre),
        x: side < 0 ? centre : W - centre,
        y: Math.random() * span,
        w: size,
        h: size,
        rate: rand(0.015, 0.025),
        alpha: rand(0.55, 0.8),
        side,
      });
    }
    // farthest first, so galaxies can sit in front of nebulae
    deep.sort((a, b) => a.rate - b.rate);
  }

  function drawDeep() {
    if (!deep.length) return;
    const span = H + 600;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const o of deep) {
      let y = (o.y - scrollY * o.rate) % span;
      if (y < 0) y += span;
      y -= 300;
      if (y + o.h / 2 < -20 || y - o.h / 2 > H + 20) continue;
      ctx.globalAlpha = o.alpha;
      ctx.drawImage(o.sprite, o.x - o.w / 2, y - o.h / 2, o.w, o.h);
    }
    ctx.restore();
  }

  function buildGlow(R: number) {
    // The star's glow, pre-rendered once per size: a radial gradient faded out
    // toward the right so it never washes over the text column.
    const size = Math.ceil(R * 2.6);
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(size * dpr);
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    const m = size / 2;
    const grad = g.createRadialGradient(m, m, 0, m, m, size / 2);
    grad.addColorStop(0, 'rgba(232,242,255,0.95)');
    grad.addColorStop(0.05, 'rgba(178,206,255,0.62)');
    grad.addColorStop(0.14, 'rgba(112,158,255,0.3)');
    grad.addColorStop(0.28, 'rgba(82,120,236,0.14)');
    grad.addColorStop(0.5, 'rgba(60,92,210,0.05)');
    grad.addColorStop(1, 'rgba(60,92,210,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    const fade = g.createLinearGradient(0, 0, size, 0);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(0.58, 'rgba(0,0,0,0)');
    fade.addColorStop(0.72, 'rgba(0,0,0,0.55)');
    fade.addColorStop(0.9, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = fade;
    g.fillRect(0, 0, size, size);
    glow = c;
    glowR = R;
  }

  function resize() {
    // a soft background doesn't need retina resolution: capping at 1.5 cuts
    // the pixels committed per frame by ~44% on 2x displays; high quality
    // allows the full 2x
    dpr = Math.min(window.devicePixelRatio || 1, highQuality() ? 2 : 1.5);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas!.width = Math.round(W * dpr);
    canvas!.height = Math.round(H * dpr);
    canvas!.style.width = `${W}px`;
    canvas!.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildStars();
    buildDeep();
    buildGlow(Math.min(360, Math.max(210, W * 0.22)));
    comets = [];
  }

  // ---- drawing helpers --------------------------------------------------

  function shadedDisc(x: number, y: number, r: number, lx: number, ly: number, lit: string, dark: string) {
    // a planet: radial gradient whose bright centre is pulled toward the light
    const d = Math.hypot(lx - x, ly - y) || 1;
    const ox = ((lx - x) / d) * r * 0.45;
    const oy = ((ly - y) / d) * r * 0.45;
    const g = ctx.createRadialGradient(x + ox, y + oy, r * 0.1, x, y, r);
    g.addColorStop(0, lit);
    g.addColorStop(1, dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  function orbitPoint(cx: number, cy: number, a: number, squash: number, tilt: number, theta: number) {
    // point on an ellipse of semi-axes (a*squash, a), rotated by tilt
    const ex = a * squash * Math.cos(theta);
    const ey = a * Math.sin(theta);
    const c = Math.cos(tilt);
    const s = Math.sin(tilt);
    return { x: cx + ex * c - ey * s, y: cy + ex * s + ey * c, front: Math.cos(theta) > 0 };
  }

  // ---- scene ---------------------------------------------------------------

  // Deep-page objects sit at a document offset D: centred on screen when the
  // reader has scrolled to D, and moving at f times scroll speed around it.
  const anchorY = (D: number, f: number) => H * 0.5 + (D - scrollY) * f;

  // Stars are batched: one fillStyle per (tint, quantised alpha) bucket and a
  // fillRect per star (at 1–3px a square is indistinguishable from a disc),
  // instead of a path + gradient string per star per frame.
  const starBuckets = new Map<string, number[]>();
  function drawStars(time: number) {
    const span = H + 600;
    for (const b of starBuckets.values()) b.length = 0;
    for (const s of stars) {
      const rate = 0.05 + 0.2 * s.z;
      let y = (s.y - scrollY * rate) % span;
      if (y < 0) y += span;
      y -= 300;
      if (y < -4 || y > H + 4) continue;
      const tw = reduced.matches ? 1 : 0.72 + 0.28 * Math.sin(time * s.speed + s.phase);
      const q = Math.round(s.a * tw * 12) / 12; // 12 alpha levels
      const key = `rgba(${s.tint},${q})`;
      let b = starBuckets.get(key);
      if (!b) starBuckets.set(key, (b = []));
      b.push(s.x - s.r, y - s.r, s.r * 2);
    }
    for (const [style, b] of starBuckets) {
      if (!b.length) continue;
      ctx.fillStyle = style;
      for (let i = 0; i < b.length; i += 3) ctx.fillRect(b[i], b[i + 1], b[i + 2], b[i + 2]);
    }
  }

  const BLUE_PLANETS = [
    { a: 0.52, squash: 0.26, tilt: -0.22, period: 34, r: 3.2, phase: 0.9, lit: '#dfe9ff', dark: '#2a3b70' },
    { a: 0.78, squash: 0.3, tilt: -0.18, period: 57, r: 4.6, phase: 3.4, lit: '#f1e4d2', dark: '#5a3f2c' },
    { a: 1.08, squash: 0.34, tilt: -0.12, period: 92, r: 3.8, phase: 5.2, lit: '#cfe8e2', dark: '#22484a' },
  ];

  function drawBlueStar(time: number) {
    if (!glow) return;
    const R = glowR;
    const cx = W * 0.02;
    const cy = H * 0.62 - scrollY * 0.34;
    if (cy < -R * 1.6 || cy > H + R * 1.6) return;

    const orbit = (p: (typeof BLUE_PLANETS)[number]) =>
      orbitPoint(cx, cy, p.a * R, p.squash, p.tilt, p.phase + (reduced.matches ? 0 : (time / p.period) * TAU));
    const placed = BLUE_PLANETS.map((p) => ({ p, ...orbit(p) }));

    // planets behind the star first
    for (const { p, x, y, front } of placed) {
      if (!front) shadedDisc(x, y, p.r * 0.9, cx, cy, p.lit, p.dark);
    }

    // glow (breathes very slowly) + crisp core
    const breathe = reduced.matches ? 1 : 1 + 0.03 * Math.sin(time * 0.45);
    const size = (glow.width / dpr) * breathe;
    ctx.drawImage(glow, cx - size / 2, cy - size / 2, size, size);
    const coreR = Math.max(5, R * 0.03);
    const core = ctx.createRadialGradient(cx - coreR * 0.2, cy - coreR * 0.2, 0, cx, cy, coreR * 2.2);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(0.35, 'rgba(226,238,255,0.95)');
    core.addColorStop(0.6, 'rgba(170,200,255,0.45)');
    core.addColorStop(1, 'rgba(150,190,255,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 2.2, 0, TAU);
    ctx.fill();

    // planets in front
    for (const { p, x, y, front } of placed) {
      if (front) shadedDisc(x, y, p.r, cx, cy, p.lit, p.dark);
    }
  }

  function drawRingedGiant(time: number) {
    const R = Math.min(120, Math.max(72, W * 0.075));
    const cx = W - R * 0.35;
    const cy = anchorY(2600, 0.55);
    if (cy < -R * 3 || cy > H + R * 3) return;

    const tilt = -0.32;
    const squash = 0.24; // how far from edge-on we see the ring plane
    const ringIn = R * 1.22;
    const ringOut = R * 2.3;
    const lx = cx - W; // lit from the far left, where the blue star was
    const ly = cy - H;

    const moons = [
      { a: R * 1.62, squash: 0.28, tilt: -0.5, period: 21, r: 4, phase: 1.1, lit: '#e6e1d8', dark: '#4a4640' },
      { a: R * 2.12, squash: 0.22, tilt: -0.42, period: 37, r: 3, phase: 4.0, lit: '#d8d2c8', dark: '#3c3934' },
    ];
    const placed = moons.map((m) => ({
      m,
      ...orbitPoint(cx, cy, m.a, m.squash, m.tilt, m.phase + (reduced.matches ? 0 : (time / m.period) * TAU)),
    }));

    // One flat annulus, its bands defined as gradient stops in ring-plane
    // space, drawn under a squash transform. `half` clips to the far side
    // (behind the planet) or the near side (in front of it).
    const rings = (half: 'back' | 'front', alpha: number) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tilt);
      ctx.scale(1, squash);
      ctx.beginPath();
      if (half === 'back') ctx.rect(-ringOut * 1.1, -ringOut * 1.1, ringOut * 2.2, ringOut * 1.1);
      else ctx.rect(-ringOut * 1.1, 0, ringOut * 2.2, ringOut * 1.1);
      ctx.clip();
      const g = ctx.createRadialGradient(0, 0, ringIn, 0, 0, ringOut);
      const c = (a: number) => `rgba(222,204,176,${(a * alpha).toFixed(3)})`;
      g.addColorStop(0, c(0));
      g.addColorStop(0.05, c(0.28));   // faint inner ring
      g.addColorStop(0.2, c(0.34));
      g.addColorStop(0.24, c(0.62));   // bright main ring
      g.addColorStop(0.5, c(0.58));
      g.addColorStop(0.56, c(0.1));    // the gap
      g.addColorStop(0.61, c(0.46));
      g.addColorStop(0.82, c(0.36));
      g.addColorStop(0.93, c(0.12));
      g.addColorStop(1, c(0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, ringOut, 0, TAU);
      ctx.arc(0, 0, ringIn, 0, TAU, true);
      ctx.fill('evenodd');
      ctx.restore();
    };

    for (const { m, x, y, front } of placed) if (!front) shadedDisc(x, y, m.r * 0.9, lx, ly, m.lit, m.dark);

    rings('back', 0.8);

    // the planet: banded amber giant
    const g = ctx.createRadialGradient(cx - R * 0.45, cy - R * 0.4, R * 0.1, cx, cy, R);
    g.addColorStop(0, '#e9cfa6');
    g.addColorStop(0.55, '#b98a5a');
    g.addColorStop(1, '#4a3222');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();
    // soft cloud bands, parallel to the ring plane
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    const bands = ctx.createLinearGradient(0, -R, 0, R);
    for (let i = 0; i <= 12; i++) {
      const k = i / 12;
      const a = 0.05 + 0.1 * Math.abs(Math.sin(i * 1.9 + 0.4));
      bands.addColorStop(k, `rgba(70,46,30,${a.toFixed(3)})`);
      if (i < 12) bands.addColorStop(k + 0.04, `rgba(255,236,200,${(0.03 + 0.04 * Math.abs(Math.cos(i * 1.3))).toFixed(3)})`);
    }
    ctx.fillStyle = bands;
    ctx.fillRect(-R, -R, R * 2, R * 2);
    // ring shadow falling across the upper half of the globe
    ctx.scale(1, squash);
    ctx.beginPath();
    ctx.arc(0, -R * 0.55, ringOut * 0.98, 0, TAU);
    ctx.arc(0, -R * 0.55, ringIn * 0.98, 0, TAU, true);
    ctx.fillStyle = 'rgba(16,10,6,0.42)';
    ctx.fill('evenodd');
    ctx.restore();

    rings('front', 1);

    for (const { m, x, y, front } of placed) if (front) shadedDisc(x, y, m.r, lx, ly, m.lit, m.dark);
  }

  function drawRedPlanet(time: number) {
    const R = Math.min(34, Math.max(22, W * 0.02));
    const cx = W * 0.06;
    const cy = anchorY(5200, 0.42);
    if (cy < -R * 4 || cy > H + R * 4) return;
    const moon = orbitPoint(cx, cy, R * 2.1, 0.32, 0.6, 2.2 + (reduced.matches ? 0 : (time / 27) * TAU));
    if (!moon.front) shadedDisc(moon.x, moon.y, 2.4, cx - W, cy, '#ddd6cc', '#3a3632');
    shadedDisc(cx, cy, R, cx - W, cy - H, '#e0977a', '#4a1e16');
    if (moon.front) shadedDisc(moon.x, moon.y, 2.8, cx - W, cy, '#ddd6cc', '#3a3632');
  }


  // ---- black hole ---------------------------------------------------------

  type Infall = { theta: number; rad: number; speed: number; size: number };
  const infall: Infall[] = Array.from({ length: 46 }, () => ({
    theta: Math.random() * TAU,
    rad: rand(1.3, 3.4),
    speed: rand(0.5, 1.1),
    size: rand(0.7, 1.6),
  }));

  // The accretion disc is a flat annulus with a white-hot inner rim, rendered
  // once into textures and drawn rotated each frame. The near side uses the
  // long flat texture seen almost edge-on. The far side, lensed up over the
  // shadow, uses a shorter texture drawn at (slightly more than) full height
  // so its bright rim lands just above the photon ring instead of inside the
  // shadow. Conic modulation baked into the textures gives streaks that turn.
  let discTex: HTMLCanvasElement | null = null;
  let backTex: HTMLCanvasElement | null = null;
  let bloomTex: HTMLCanvasElement | null = null;
  let backBloom: HTMLCanvasElement | null = null;
  let discTexR = 0;

  function buildDisc(R: number) {
    const rIn = R * 1.0; // hugs the photon ring on every side
    const mk = (rOut: number) => {
      const size = Math.ceil(rOut * 2 + 8);
      const c = document.createElement('canvas');
      c.width = c.height = Math.ceil(size * dpr);
      const g = c.getContext('2d')!;
      g.scale(dpr, dpr);
      g.translate(size / 2, size / 2);
      return { c, g };
    };
    const streaks = (g: CanvasRenderingContext2D, rOut: number) => {
      if (typeof g.createConicGradient !== 'function') return;
      const con = g.createConicGradient(0, 0, 0);
      const lobes = 7;
      for (let i = 0; i <= lobes * 4; i++) {
        const k = i / (lobes * 4);
        const a = 0.06 + 0.26 * Math.pow(0.5 + 0.5 * Math.sin(k * TAU * lobes + Math.sin(k * TAU * 2.3) * 1.4), 2.2);
        con.addColorStop(k, `rgba(0,0,0,${a.toFixed(3)})`);
      }
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = con;
      g.beginPath();
      g.arc(0, 0, rOut, 0, TAU);
      g.fill();
    };
    // disc heat: the rim is a fixed 0.3R wide whatever the outer radius, the
    // cooler tail is stretched to fit
    const disc = (rOut: number) => {
      const { c, g } = mk(rOut);
      const rad = g.createRadialGradient(0, 0, rIn * 0.97, 0, 0, rOut);
      const fr = (0.3 * R) / (rOut - rIn * 0.97);
      const tail = (k: number) => fr + (1 - fr) * k;
      rad.addColorStop(0, 'rgba(255,252,242,0)');
      rad.addColorStop(0.012, 'rgba(255,252,242,1)');
      rad.addColorStop(fr * 0.35, 'rgba(255,238,196,1)');
      rad.addColorStop(fr, 'rgba(255,206,130,0.96)');
      rad.addColorStop(tail(0.22), 'rgba(255,166,86,0.74)');
      rad.addColorStop(tail(0.5), 'rgba(238,116,54,0.38)');
      rad.addColorStop(tail(0.78), 'rgba(196,74,36,0.13)');
      rad.addColorStop(1, 'rgba(180,60,30,0)');
      g.fillStyle = rad;
      g.beginPath();
      g.arc(0, 0, rOut, 0, TAU);
      g.fill();
      streaks(g, rOut);
      return c;
    };
    // bloom: wide, soft and warm, a little brighter on the approaching side
    const bloom = (rOut: number) => {
      const { c, g } = mk(rOut);
      const rad = g.createRadialGradient(0, 0, rIn * 0.6, 0, 0, rOut);
      rad.addColorStop(0, 'rgba(255,226,180,0)');
      rad.addColorStop(0.12, 'rgba(255,228,184,0.62)');
      rad.addColorStop(0.3, 'rgba(255,190,120,0.4)');
      rad.addColorStop(0.58, 'rgba(255,150,80,0.18)');
      rad.addColorStop(1, 'rgba(255,120,60,0)');
      g.fillStyle = rad;
      g.beginPath();
      g.arc(0, 0, rOut, 0, TAU);
      g.fill();
      const dop = g.createLinearGradient(-rOut, 0, rOut, 0);
      dop.addColorStop(0, 'rgba(0,0,0,0)');
      dop.addColorStop(1, 'rgba(0,0,0,0.45)');
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = dop;
      g.fillRect(-rOut, -rOut, rOut * 2, rOut * 2);
      return c;
    };
    discTex = disc(R * 3.5);
    backTex = disc(R * 2.3);
    bloomTex = bloom(R * 3.5);
    backBloom = bloom(R * 2.7);
    discTexR = R;
  }

  function drawBlackHole(time: number, dt: number) {
    const R = Math.min(64, Math.max(40, W * 0.04)); // event horizon radius
    const cx = W * 0.9;
    const cy = anchorY(8000, 0.5);
    if (cy < -R * 5 || cy > H + R * 5) return;
    if (!discTex || discTexR !== R) buildDisc(R);

    const tilt = -0.28;
    const squash = 0.2; // near side: seen almost edge-on
    const lift = 1.14; // far side: its rim lands a hair above the photon ring
    const spin = reduced.matches ? 0 : time * 0.22;

    // draw a texture in the disc plane: `half` selects which side, `sy` is
    // the vertical scale that side is seen with, `alpha` its weight
    const plane = (
      tex: HTMLCanvasElement,
      half: 'back' | 'front',
      sy: number,
      alpha: number,
      opts: { flip?: boolean; additive?: boolean; grow?: number } = {},
    ) => {
      const size = tex.width / dpr;
      ctx.save();
      ctx.globalAlpha = alpha;
      if (opts.additive) ctx.globalCompositeOperation = 'lighter';
      ctx.translate(cx, cy);
      ctx.rotate(tilt);
      ctx.scale(opts.grow ?? 1, (opts.flip ? -sy : sy) * (opts.grow ?? 1));
      ctx.beginPath();
      if (half === 'back') ctx.rect(-size, -size, size * 2, size);
      else ctx.rect(-size, 0, size * 2, size);
      ctx.clip();
      ctx.rotate(spin);
      ctx.drawImage(tex, -size / 2, -size / 2, size, size);
      ctx.restore();
    };

    // far side: a faint flat band for continuity at the sides, then the
    // lensed image arcing up over the shadow with its bloom
    plane(bloomTex!, 'back', squash, 0.3, { additive: true });
    plane(discTex!, 'back', squash, 0.35);
    plane(backBloom!, 'back', lift, 0.35, { additive: true, grow: 1.25 });
    plane(backBloom!, 'back', lift, 0.7, { additive: true });
    plane(backTex!, 'back', lift, 1);
    plane(backTex!, 'back', lift, 0.45, { additive: true });
    // secondary image: a thin, faint copy of the far side under the shadow
    plane(discTex!, 'back', 0.36, 0.4, { flip: true });

    // infalling matter, near side of the disc plane
    if (!reduced.matches) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tilt);
      for (const p of infall) {
        p.theta += (0.9 / p.rad) * p.speed * dt;
        p.rad -= 0.0022 * p.speed * (4 - p.rad) * (dt / 0.016);
        if (p.rad < 1.15) {
          p.rad = rand(2.8, 3.5);
          p.theta = Math.random() * TAU;
        }
        if (Math.sin(p.theta) <= 0) continue;
        const a = p.rad * R;
        const k = (p.rad - 1.15) / 2.35;
        ctx.fillStyle = `rgba(255,${Math.round(210 + 45 * (1 - k))},${Math.round(170 + 85 * (1 - k))},${(0.9 - 0.6 * k).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(a * Math.cos(p.theta), a * squash * Math.sin(p.theta), p.size * (1.4 - k * 0.6), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    // the shadow, with a soft gravitationally darkened rim
    const shadow = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 1.04);
    shadow.addColorStop(0, 'rgba(0,0,0,1)');
    shadow.addColorStop(0.9, 'rgba(0,0,0,1)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.04, 0, TAU);
    ctx.fill();

    // photon ring: a thin white-hot ring with a glowing falloff
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const pr = ctx.createRadialGradient(cx, cy, R * 0.97, cx, cy, R * 1.3);
    pr.addColorStop(0, 'rgba(255,250,240,0)');
    pr.addColorStop(0.1, 'rgba(255,252,244,1)');
    pr.addColorStop(0.22, 'rgba(255,232,196,0.55)');
    pr.addColorStop(0.5, 'rgba(255,190,120,0.12)');
    pr.addColorStop(1, 'rgba(255,160,90,0)');
    ctx.fillStyle = pr;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.3, 0, TAU);
    ctx.arc(cx, cy, R * 0.97, 0, TAU, true);
    ctx.fill('evenodd');
    ctx.restore();

    // near side: disc in front of the shadow, then its bloom and halo
    plane(discTex!, 'front', squash, 1);
    plane(bloomTex!, 'front', squash, 0.85, { additive: true });
    plane(bloomTex!, 'front', squash, 0.35, { additive: true, grow: 1.3 });
  }

  // ---- wormhole + warship ---------------------------------------------------

  // The wormhole is seen side-on: a tall thin ring whose plane is a vertical
  // line on screen. It is normally closed. Every five minutes it opens somewhere
  // new — a random side of the screen at a random height, never on the left
  // while the blue star is in view — and a warship slides out through the
  // ring nose-first, heading up and toward the middle of the page (a portal
  // on the right sends it left, one on the left sends it right). Only the
  // part of the hull on our side of the plane is drawn. The portal seals
  // behind it and after six seconds of slow flight the engines flare, the
  // ship accelerates hard for a second and then jumps to warp. One state machine, so there is never more than one ship.
  let swirlTex: HTMLCanvasElement | null = null;
  let swirlR = 0;

  type JumpPhase = 'closed' | 'open' | 'emerge' | 'burn' | 'warpout';
  const PHASE_LEN: Record<JumpPhase, number> = { closed: 0, open: 0.5, emerge: 6.0, burn: 1.1, warpout: 0.5 };
  const PORTAL_SX = 0.3; // side view: the ring is a tall, thin ellipse
  const SHIP_INTERVAL = 30; // seconds between replays; the ship is a rare event
  const jump = {
    phase: 'closed' as JumpPhase,
    t: 0,
    next: SHIP_INTERVAL,
    heading: -0.55,
    dist: 0,
    speed: 0,
    // where this replay's portal is: a screen x, and a screen y anchored to
    // the scroll position at spawn so it drifts with parallax like the rest
    x: 0,
    screenY: 0,
    scrollAt: 0,
  };

  const easeOutBack = (k: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
  };

  function buildSwirl(R: number) {
    const size = Math.ceil(R * 2 + 4);
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(size * dpr);
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.translate(size / 2, size / 2);
    const rad = g.createRadialGradient(0, 0, 0, 0, 0, R);
    rad.addColorStop(0, 'rgba(240,250,255,0.95)');
    rad.addColorStop(0.08, 'rgba(150,210,255,0.7)');
    rad.addColorStop(0.3, 'rgba(90,140,255,0.5)');
    rad.addColorStop(0.6, 'rgba(120,90,220,0.42)');
    rad.addColorStop(0.9, 'rgba(60,40,140,0.3)');
    rad.addColorStop(1, 'rgba(60,40,140,0)');
    g.fillStyle = rad;
    g.beginPath();
    g.arc(0, 0, R, 0, TAU);
    g.fill();
    if (typeof g.createConicGradient === 'function') {
      g.globalCompositeOperation = 'destination-out';
      const rings = 18;
      for (let i = 0; i < rings; i++) {
        const r0 = (i / rings) * R;
        const r1 = ((i + 1) / rings) * R;
        const con = g.createConicGradient((i / rings) * 2.6, 0, 0);
        for (let k = 0; k <= 24; k++) {
          const u = k / 24;
          const a = 0.25 + 0.55 * Math.pow(0.5 + 0.5 * Math.sin(u * TAU * 3), 1.8);
          con.addColorStop(u, `rgba(0,0,0,${a.toFixed(3)})`);
        }
        g.fillStyle = con;
        g.beginPath();
        g.arc(0, 0, r1, 0, TAU);
        g.arc(0, 0, Math.max(0, r0), 0, TAU, true);
        g.fill('evenodd');
      }
    }
    swirlTex = c;
    swirlR = R;
  }

  // `stretch` > 1 elongates the ship along its heading (dropping out of, or
  // jumping to, warp) and adds a light streak of matching length.
  function drawShip(x: number, y: number, ang: number, sc: number, alpha: number, thrust: number, stretch = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.scale(sc, Math.cos(ang) < 0 ? -sc : sc); // flying left: mirror so the hull's lit side stays up

    if (stretch > 1.02) {
      const len = 140 * (stretch - 1);
      const a = Math.min(1, (stretch - 1) / 3);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(-len, 0, len, 0);
      g.addColorStop(0, 'rgba(160,220,255,0)');
      g.addColorStop(0.5, `rgba(235,248,255,${0.9 * a})`);
      g.addColorStop(1, 'rgba(160,220,255,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(-len, 0);
      ctx.lineTo(len, 0);
      ctx.stroke();
      ctx.lineWidth = 8;
      ctx.globalAlpha = alpha * 0.35 * a;
      ctx.stroke();
      ctx.restore();
    }
    ctx.scale(stretch, 1 / Math.sqrt(stretch));

    // engine trails, behind the hull
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const trail = (ex: number, ey: number, len: number, w: number) => {
      if (len < 2) return;
      const g = ctx.createLinearGradient(ex, ey, ex - len, ey);
      g.addColorStop(0, `rgba(210,245,255,${0.95 * thrust})`);
      g.addColorStop(0.2, `rgba(120,200,255,${0.6 * thrust})`);
      g.addColorStop(1, 'rgba(80,140,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(ex, ey - w);
      ctx.lineTo(ex - len, ey);
      ctx.lineTo(ex, ey + w);
      ctx.closePath();
      ctx.fill();
    };
    trail(-58, 0, 150 * thrust, 5);
    trail(-52, -19, 110 * thrust, 3.2);
    trail(-52, 19, 110 * thrust, 3.2);
    ctx.restore();

    // wings: swept, layered
    const hull = ctx.createLinearGradient(0, -36, 0, 36);
    hull.addColorStop(0, '#3b4557');
    hull.addColorStop(0.45, '#1a2130');
    hull.addColorStop(0.55, '#0e131c');
    hull.addColorStop(1, '#232b3a');
    ctx.fillStyle = hull;
    ctx.strokeStyle = 'rgba(160,220,255,0.55)';
    ctx.lineWidth = 0.9;
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(12, sgn * 6);
      ctx.lineTo(-30, sgn * 12);
      ctx.lineTo(-62, sgn * 36);
      ctx.lineTo(-66, sgn * 30);
      ctx.lineTo(-52, sgn * 14);
      ctx.lineTo(-56, sgn * 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // main hull: a long dagger
    const body = ctx.createLinearGradient(0, -12, 0, 12);
    body.addColorStop(0, '#5a667a');
    body.addColorStop(0.5, '#222a38');
    body.addColorStop(1, '#3a4455');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(70, 0);
    ctx.lineTo(20, -9);
    ctx.lineTo(-50, -11);
    ctx.lineTo(-60, -6);
    ctx.lineTo(-60, 6);
    ctx.lineTo(-50, 11);
    ctx.lineTo(20, 9);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(180,230,255,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // dorsal spine and bridge
    ctx.fillStyle = '#6d7b92';
    ctx.beginPath();
    ctx.moveTo(30, 0);
    ctx.lineTo(-20, -4);
    ctx.lineTo(-44, -3);
    ctx.lineTo(-44, 3);
    ctx.lineTo(-20, 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(150,230,255,0.9)';
    ctx.fillRect(-6, -2, 10, 4);

    // running lights, engines and wing-edge glow, additive
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(120,220,255,0.9)';
    for (const [lx, ly] of [[-60, -33], [-60, 33], [62, 0]] as [number, number][]) {
      ctx.beginPath();
      ctx.arc(lx, ly, 1.6, 0, TAU);
      ctx.fill();
    }
    const engine = (ex: number, ey: number, r: number) => {
      const glow = 0.35 + 0.65 * thrust;
      const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, r * 2.2);
      g.addColorStop(0, `rgba(240,252,255,${glow})`);
      g.addColorStop(0.35, `rgba(140,210,255,${0.8 * glow})`);
      g.addColorStop(1, 'rgba(80,140,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(ex, ey, r * 2.2, 0, TAU);
      ctx.fill();
    };
    engine(-59, 0, 5);
    engine(-54, -19, 3.4);
    engine(-54, 19, 3.4);
    ctx.strokeStyle = 'rgba(110,200,255,0.35)';
    ctx.lineWidth = 2.5;
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(12, sgn * 6);
      ctx.lineTo(-62, sgn * 36);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  }

  function flash(x: number, y: number, r: number, a: number) {
    if (a <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.3, `rgba(200,235,255,${0.6 * a})`);
    g.addColorStop(1, 'rgba(150,200,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawPortal(cx: number, cy: number, R0: number, open: number, glowBoost: number) {
    if (open <= 0.01) return;
    const R = R0 * open;
    const spin = reduced.matches ? 0 : t * 0.5;
    const size = (swirlTex!.width / dpr) * open;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(PORTAL_SX, 1);

    // lensing halo
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(0, 0, R * 0.9, 0, 0, R * (2.2 + glowBoost));
    halo.addColorStop(0, `rgba(140,190,255,${0.3 + 0.4 * glowBoost})`);
    halo.addColorStop(0.35, `rgba(120,140,255,${0.1 + 0.2 * glowBoost})`);
    halo.addColorStop(1, 'rgba(100,120,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, R * 3.2, 0, TAU);
    ctx.fill();
    ctx.restore();

    // throat: counter-rotating swirls clipped to the opening
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.94, 0, TAU);
    ctx.clip();
    ctx.fillStyle = '#04060f';
    ctx.fillRect(-R, -R, R * 2, R * 2);
    ctx.save();
    ctx.rotate(spin);
    ctx.drawImage(swirlTex!, -size / 2, -size / 2, size, size);
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55;
    ctx.rotate(-spin * 0.7 + 1.3);
    ctx.scale(0.72, 0.72);
    ctx.drawImage(swirlTex!, -size / 2, -size / 2, size, size);
    ctx.restore();
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, R * (0.3 + glowBoost * 0.5));
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(0.4, `rgba(190,230,255,${0.5 + 0.4 * glowBoost})`);
    core.addColorStop(1, 'rgba(150,200,255,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Einstein ring
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const ring = ctx.createRadialGradient(0, 0, R * 0.86, 0, 0, R * 1.3);
    ring.addColorStop(0, 'rgba(200,235,255,0)');
    ring.addColorStop(0.18, 'rgba(235,248,255,0.95)');
    ring.addColorStop(0.3, `rgba(160,210,255,${0.55 + 0.35 * glowBoost})`);
    ring.addColorStop(0.6, `rgba(120,150,255,${0.15 + 0.25 * glowBoost})`);
    ring.addColorStop(1, 'rgba(120,150,255,0)');
    ctx.fillStyle = ring;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.3, 0, TAU);
    ctx.arc(0, 0, R * 0.86, 0, TAU, true);
    ctx.fill('evenodd');
    ctx.restore();

    ctx.restore();

    // a sharper highlight on the near edge of the ring, for a little depth
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(240,250,255,${0.5 + 0.3 * glowBoost})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * 0.95 * PORTAL_SX, R * 0.95, 0, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawWormhole(time: number, dt: number) {
    // set well back in the scene: smaller than the foreground objects, a
    // touch dimmer, and drifting slowly with scroll
    const R = Math.min(30, Math.max(18, W * 0.02));
    const shipScale = R / 72;
    const shipLen = 136 * shipScale;

    // ---- sequence
    if (!reduced.matches) {
      jump.t += dt;
      if (jump.phase === 'closed') {
        if (jump.t >= jump.next) {
          // pick a spot: a side (not the left while the blue star is in
          // view), a height clear of the top and bottom edges
          const starY = H * 0.62 - scrollY * 0.34;
          const starVisible = starY > -H * 0.3 && starY < H * 1.1;
          const side = starVisible ? 1 : Math.random() < 0.5 ? -1 : 1;
          const a = rand(0.45, 0.7); // climb angle
          jump.heading = side < 0 ? -a : -Math.PI + a; // left → up-right, right → up-left
          jump.x = side < 0 ? W * 0.1 : W * 0.9;
          jump.screenY = rand(H * 0.22, H * 0.82);
          jump.scrollAt = scrollY;
          jump.phase = 'open';
          jump.t = 0;
          jump.speed = shipLen * 0.62; // slow: clears the ring in ~1.6s
          jump.dist = -shipLen * 0.55; // starts entirely inside the wormhole
        }
      } else if (jump.t >= PHASE_LEN[jump.phase]) {
        const order: JumpPhase[] = ['open', 'emerge', 'burn', 'warpout', 'closed'];
        jump.phase = order[order.indexOf(jump.phase) + 1];
        jump.t = 0;
        if (jump.phase === 'closed') jump.next = SHIP_INTERVAL;
      }
    }
    if (jump.phase === 'closed') return;

    if (!swirlTex || swirlR !== R) buildSwirl(R);
    const cx = jump.x;
    const cy = jump.screenY + (jump.scrollAt - scrollY) * 0.18;
    if (cy < -R * 3 || cy > H + R * 3) {
      // scrolled away mid-replay: abandon it, try again somewhere else soon
      jump.phase = 'closed';
      jump.t = 0;
      jump.next = SHIP_INTERVAL;
      return;
    }

    // ---- portal openness and glow for this frame
    let open = 0;
    let boost = 0;
    if (jump.phase === 'open') {
      open = easeOutBack(Math.min(1, jump.t / PHASE_LEN.open));
      boost = 0.6;
    } else if (jump.phase === 'emerge') {
      // stays open while the ship is passing through, then seals behind it
      const sealStart = 1.9;
      const sealLen = 0.6;
      const k = Math.min(1, Math.max(0, (jump.t - sealStart) / sealLen));
      open = 1 - k * k;
      boost = jump.t < sealStart ? 0.9 : 0.4 + 0.8 * k;
      // a brief flash as the portal winks out: a pulse centred on the moment
      // it closes, gone within a third of a second either side
      const sinceSeal = jump.t - (sealStart + sealLen);
      flash(cx, cy, R * 1.1, 0.8 * Math.max(0, 1 - Math.abs(sinceSeal) / 0.32));
    }
    if (open > 0.01) drawPortal(cx, cy, R, open, boost);

    // ---- the warship
    if (jump.phase === 'emerge' || jump.phase === 'burn' || jump.phase === 'warpout') {
      const dirx = Math.cos(jump.heading);
      const diry = Math.sin(jump.heading);
      const cruise = shipLen * 0.62;
      const burnTop = cruise * 9; // speed at the end of the burn
      let stretch = 1;
      let alpha = 1;
      let thrust = 0.35;
      if (jump.phase === 'emerge') {
        jump.speed = cruise;
        jump.dist += jump.speed * dt;
        thrust = 0.3 + 0.1 * Math.sin(time * 3);
      } else if (jump.phase === 'burn') {
        // engines to full: speed ramps hard, the hull starts to draw out
        const k = Math.min(1, jump.t / PHASE_LEN.burn);
        const e = k * k * k;
        jump.speed = cruise + (burnTop - cruise) * e;
        jump.dist += jump.speed * dt;
        thrust = 1 + 0.6 * k; // trails grow past their normal length
        stretch = 1 + 0.7 * e;
      } else {
        // the jump: stretch along the heading, streak away and vanish
        const k = Math.min(1, jump.t / PHASE_LEN.warpout);
        stretch = 1.7 + 16 * k * k;
        alpha = k < 0.55 ? 1 : 1 - Math.pow((k - 0.55) / 0.45, 1.4);
        thrust = 1.6;
        jump.dist += (burnTop + 5000 * k * k) * dt;
        flash(cx + dirx * jump.dist, cy + diry * jump.dist, R * 1.6 * k + 6, 0.9 * (1 - k) * (k > 0.04 ? 1 : 0));
      }
      const x = cx + dirx * jump.dist;
      const y = cy + diry * jump.dist;
      // only the part of the ship on our side of the portal plane exists yet;
      // the plane is the vertical line through the ring's centre
      ctx.save();
      if (jump.phase === 'emerge') {
        ctx.beginPath();
        if (dirx > 0) ctx.rect(cx, -H, W * 2, H * 3);
        else ctx.rect(cx - W * 2, -H, W * 2, H * 3);
        ctx.clip();
      }
      drawShip(x, y, jump.heading, shipScale, alpha * 0.8, thrust * (0.92 + 0.08 * Math.sin(time * 18)), stretch);
      ctx.restore();
      // where the hull cuts the plane, the ring glows harder
      if (jump.phase === 'emerge' && open > 0.5) {
        const along = -jump.dist; // positive while the hull still straddles the plane
        if (along > -shipLen * 0.6 && along < shipLen * 0.6) {
          flash(cx, cy + diry * (jump.dist + 0) , R * 0.55, 0.35);
        }
      }
    }
  }

  // ---- comets -----------------------------------------------------------

  function spawnComet() {
    // enter from a random edge, cross at a shallow random angle
    const side = Math.random();
    const speed = rand(650, 1100);
    let x: number, y: number, ang: number;
    if (side < 0.45) {
      // from the top
      x = rand(-0.1, 1.1) * W;
      y = -40;
      ang = rand(0.35, 0.75) * Math.PI * (x > W / 2 ? 1 : 1) + (x > W / 2 ? 0.4 : -0.4);
    } else if (side < 0.75) {
      // from the left
      x = -40;
      y = rand(0, 0.7) * H;
      ang = rand(-0.05, 0.45);
    } else {
      // from the right
      x = W + 40;
      y = rand(0, 0.7) * H;
      ang = Math.PI - rand(-0.05, 0.45);
    }
    const vx = Math.cos(ang) * speed;
    const vy = Math.abs(Math.sin(ang)) * speed * (side < 0.45 ? 1 : 0.6) + 40;
    comets.push({ x, y, vx, vy, life: 0, ttl: rand(1.1, 2.0), len: rand(120, 260) });
  }

  function drawComets(dt: number) {
    for (const c of comets) {
      c.life += dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      const k = c.life / c.ttl;
      const fade = k < 0.15 ? k / 0.15 : k > 0.7 ? Math.max(0, (1 - k) / 0.3) : 1;
      const sp = Math.hypot(c.vx, c.vy);
      const tx = c.x - (c.vx / sp) * c.len;
      const ty = c.y - (c.vy / sp) * c.len;
      const tail = ctx.createLinearGradient(c.x, c.y, tx, ty);
      tail.addColorStop(0, `rgba(235,244,255,${0.9 * fade})`);
      tail.addColorStop(0.25, `rgba(190,214,255,${0.45 * fade})`);
      tail.addColorStop(1, 'rgba(150,190,255,0)');
      ctx.strokeStyle = tail;
      ctx.lineCap = 'round';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      const head = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 7);
      head.addColorStop(0, `rgba(255,255,255,${fade})`);
      head.addColorStop(0.4, `rgba(220,234,255,${0.6 * fade})`);
      head.addColorStop(1, 'rgba(200,220,255,0)');
      ctx.fillStyle = head;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 7, 0, TAU);
      ctx.fill();
    }
    comets = comets.filter((c) => c.life < c.ttl && c.x > -400 && c.x < W + 400 && c.y < H + 400);
  }

  // ---- loop ---------------------------------------------------------------

  function render(dt: number) {
    ctx.clearRect(0, 0, W, H);
    drawDeep();
    drawStars(t);
    drawRedPlanet(t);
    drawRingedGiant(t);
    drawBlackHole(t, dt);
    drawWormhole(t, dt);
    drawBlueStar(t);
    if (!reduced.matches) drawComets(dt);
  }

  // Anything fast on screen (a comet, the portal snapping open, the warp
  // jump) gets the full display rate; the ambient sky — twinkle, orbits, the
  // slowly turning disc — is drawn at 30fps, halving what the compositor has
  // to upload each second without a visible difference.
  function wantsFullRate(): boolean {
    return comets.length > 0 || jump.phase === 'open' || jump.phase === 'warpout';
  }

  function frame(now: number) {
    raf = 0;
    if (!active) return;
    if (!last) last = now - 16;
    const elapsed = now - last;
    const minInterval = reduced.matches || highQuality() || wantsFullRate() ? 0 : 1000 / 30;
    if (elapsed < minInterval - 2) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min(0.1, elapsed / 1000);
    last = now;
    if (!reduced.matches) {
      t += dt;
      nextComet -= dt;
      if (nextComet <= 0) {
        spawnComet();
        nextComet = rand(5, 13);
      }
    }
    render(dt);
    if (!reduced.matches) raf = requestAnimationFrame(frame);
  }

  function onScroll() {
    scrollY = window.scrollY || 0;
    if (highQuality()) root.style.setProperty('--sy', `${scrollY}px`); // drives the CSS far-layer parallax
    if (reduced.matches && active && !scheduled) {
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        render(0);
      });
    }
  }

  // ---- wiring -------------------------------------------------------------

  resize();
  onScroll();
  nextComet = rand(2, 5);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => {
    resize();
    if (reduced.matches && active) render(0);
  });
  document.addEventListener('visibilitychange', updateActive);
  darkMq.addEventListener('change', updateActive);
  new MutationObserver(updateActive).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-sky'] });
  new MutationObserver(() => {
    resize(); // the DPR cap changed: rebuild the canvas and its textures
    onScroll();
    if (reduced.matches && active) render(0);
  }).observe(root, { attributes: true, attributeFilter: ['data-sky-quality'] });
  updateActive();
  if (reduced.matches && active) render(0);
}
