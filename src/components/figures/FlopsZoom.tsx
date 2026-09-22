// Pretraining-compute comparison as a zoom-out reveal, drawn directly in SVG
// and driven by requestAnimationFrame (Plotly relayout can only step a few
// frames a second, which is what made the first version look jittery).
//
// Storyboard: Rigel's bar grows to a comfortable height — it is the unit of
// measure for everything else. The baselines then shoot straight off the top
// of the frame. The y-axis zooms out (log-space ease, so the pull-back feels
// uniform); the gridlines are Rigel-sized and the bars are ruled into
// Rigel-sized segments, so the ratio is literally countable mid-zoom. Each
// baseline's top comes into view in ascending order. Only once the frame has
// settled do the numbers arrive: the "×N" chips over each bar and the axis
// labels fade in together. Rigel ends as a sliver, which is the point.
import { useEffect, useRef } from 'react';
import { DARK } from '../PlotChart';
import { deriveModelName, PALETTE, RIGEL_COLOR } from './RigelCharts';
import flopsData from '../../../results/flops.json';

const VALUES = flopsData as Record<string, number>;
const RIGEL = VALUES.rigel;
// rigel first; baselines ascending by compute so their tops enter the frame
// one after another during the zoom instead of all at once
const KEYS = Object.keys(VALUES).sort((a, b) => {
  if (a === 'rigel') return -1;
  if (b === 'rigel') return 1;
  return VALUES[a] - VALUES[b] || a.localeCompare(b);
});
const NAMES: Record<string, string> = Object.fromEntries(KEYS.map((k) => [k, deriveModelName(k)]));
const RATIO: Record<string, number> = Object.fromEntries(KEYS.map((k) => [k, VALUES[k] / RIGEL]));
const MAX_RATIO = Math.max(...KEYS.map((k) => RATIO[k]));

// rigel keeps the accent pink used everywhere else in the post; the
// baselines fill the palette slots alphabetically (same rule as the eval
// charts), so a new key in flops.json gets a stable color.
const COLORS: Record<string, string> = (() => {
  const out: Record<string, string> = { rigel: RIGEL_COLOR };
  KEYS.filter((k) => k !== 'rigel')
    .sort()
    .forEach((k, i) => (out[k] = PALETTE[i % PALETTE.length]));
  return out;
})();

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
function formatFlops(v: number): string {
  const exp = Math.floor(Math.log10(v));
  const mant = v / 10 ** exp;
  return `${mant.toFixed(2)} × 10${String(exp).split('').map((c) => SUP[c] ?? c).join('')} FLOPs`;
}

// --- timeline (seconds) ------------------------------------------------------
const T_GROW = [0.0, 0.7] as const; // every bar rises together
const T_ZOOM = [0.2, 4.7] as const; // short beat after the bars land, then pull back
const T_REVEAL = [4.95, 5.6] as const; // numbers fade in only once the frame has settled
const DURATION = 5.7;
const RIGEL_START_FRAC = 0.62; // rigel's bar height as a fraction of the plot at t=0
const START_TOP = 1 / RIGEL_START_FRAC; // frame height in Rigel units at t=0
const END_TOP = MAX_RATIO * 1.16;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const seg = (t: number, [a, b]: readonly [number, number]) => clamp01((t - a) / (b - a));

function frameTopAt(t: number): number {
  const p = easeInOut(seg(t, T_ZOOM));
  return Math.exp(Math.log(START_TOP) + (Math.log(END_TOP) - Math.log(START_TOP)) * p);
}

function unitsAt(key: string, t: number): number {
  const p = easeOutCubic(seg(t, T_GROW));
  if (key === 'rigel') return p;
  // a baseline is 35-117 frames tall, so growing it in data units would
  // clear the top edge in a few ms — rise visibly to just past the frame
  // edge instead, then hand over to the true value (clipped identically)
  if (p < 1) return Math.min(RATIO[key], frameTopAt(t) * 1.08) * p;
  return RATIO[key];
}

// --- svg helpers -----------------------------------------------------------
const NS = 'http://www.w3.org/2000/svg';
function mk<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent?.appendChild(el);
  return el;
}

function barPath(x: number, yTop: number, w: number, yBase: number, r: number): string {
  const rr = Math.min(r, w / 2, Math.max(0, yBase - yTop));
  return `M${x},${yBase} V${yTop + rr} Q${x},${yTop} ${x + rr},${yTop} H${x + w - rr} Q${x + w},${yTop} ${x + w},${yTop + rr} V${yBase} Z`;
}

const GRID_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500];
// only label steps that nest (each divides the next), so a coarser label set
// is always a subset of the finer one and the two never interleave (×4 ×5 ×6)
const LABEL_STEPS = new Set([1, 2, 10, 20, 100, 200]);
const POOL = 72;
const CHIP_H = 20;
const HEIGHT = 540;
const MARGIN = { l: 60, r: 20, t: 30, b: 62 };

const isDark = () =>
  document.documentElement.getAttribute('data-theme') === 'dark' ||
  (!document.documentElement.hasAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
const colorOf = (key: string, dk: boolean) => (dk ? DARK[COLORS[key]] ?? COLORS[key] : COLORS[key]);

const MONO = '"SF Mono", Menlo, ui-monospace, monospace';
const SANS = 'Inter, system-ui, sans-serif';

export default function FlopsZoom() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = host.current!;
    const motionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const colorMq = window.matchMedia('(prefers-color-scheme: dark)');

    const svg = mk('svg', { width: '100%', height: HEIGHT, role: 'img' }, root);
    svg.setAttribute('aria-label', `Pretraining compute of ${KEYS.map((k) => NAMES[k]).join(', ')}, in multiples of Rigel's run.`);
    svg.style.display = 'block';
    svg.style.overflow = 'visible';
    svg.style.fontFamily = SANS;

    const defs = mk('defs', {}, svg);
    const uid = Math.random().toString(36).slice(2, 8);
    const plotClip = mk('clipPath', { id: `fz-plot-${uid}` }, defs);
    const plotClipRect = mk('rect', {}, plotClip);
    const barsClip = mk('clipPath', { id: `fz-bars-${uid}` }, defs);
    const barsClipRects = KEYS.map(() => mk('rect', {}, barsClip));

    const gridG = mk('g', { 'clip-path': `url(#fz-plot-${uid})` }, svg);
    const grid = Array.from({ length: POOL }, () => {
      const l = mk('line', {}, gridG);
      l.style.stroke = 'var(--line)';
      l.style.strokeWidth = '1';
      return l;
    });
    const gridLabels = Array.from({ length: 24 }, () => {
      const tx = mk('text', { 'text-anchor': 'end', 'font-size': 10.5 }, svg);
      tx.style.fill = 'var(--muted)';
      tx.style.fontFamily = MONO;
      return tx;
    });

    const barsG = mk('g', { 'clip-path': `url(#fz-plot-${uid})` }, svg);
    const bars = Object.fromEntries(KEYS.map((k) => [k, mk('path', {}, barsG)]));
    const sepG = mk('g', { 'clip-path': `url(#fz-bars-${uid})` }, svg);
    const seps = Array.from({ length: POOL }, () => {
      const l = mk('line', {}, sepG);
      l.style.stroke = 'var(--paper)';
      l.style.strokeWidth = '1';
      return l;
    });

    const baseline = mk('line', {}, svg);
    baseline.style.stroke = 'var(--line)';
    baseline.style.strokeWidth = '1';

    const axisTitle = mk('text', { 'text-anchor': 'middle', 'font-size': 11 }, svg);
    axisTitle.style.fill = 'var(--muted)';
    axisTitle.textContent = 'Pretraining FLOPs';

    const nameT = Object.fromEntries(
      KEYS.map((k) => {
        const tx = mk('text', { 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 600 }, svg);
        tx.style.fill = 'var(--ink)';
        tx.textContent = NAMES[k];
        return [k, tx];
      })
    );
    const flopsT = Object.fromEntries(
      KEYS.map((k) => {
        const tx = mk('text', { 'text-anchor': 'middle', 'font-size': 10.5 }, svg);
        tx.style.fill = 'var(--muted)';
        tx.style.fontVariantNumeric = 'tabular-nums';
        tx.textContent = formatFlops(VALUES[k]);
        return [k, tx];
      })
    );

    const chips = Object.fromEntries(
      KEYS.map((k) => {
        const g = mk('g', {}, svg);
        const rect = mk('rect', { rx: 4, ry: 4, height: CHIP_H }, g);
        rect.style.fill = 'var(--paper)';
        rect.style.strokeWidth = '1.5';
        const tx = mk('text', { 'text-anchor': 'middle', 'font-size': 11.5, 'font-weight': 600, y: 14 }, g);
        tx.style.fontFamily = MONO;
        tx.style.fontVariantNumeric = 'tabular-nums';
        tx.style.fill = 'var(--ink)';
        return [k, { g, rect, tx }];
      })
    );

    let W = 0;
    let dk = isDark();
    const applyTheme = () => {
      dk = isDark();
      for (const k of KEYS) {
        bars[k].style.fill = colorOf(k, dk);
        chips[k].rect.style.stroke = colorOf(k, dk);
      }
      // same neon treatment as the plotly charts' leading series
      const glow = colorOf('rigel', dk);
      bars.rigel.style.filter = `drop-shadow(0 0 2px ${glow}) drop-shadow(0 0 7px ${glow})`;
    };
    applyTheme();

    const geom = () => {
      const x0 = MARGIN.l;
      const x1 = W - MARGIN.r;
      const y0 = MARGIN.t;
      const y1 = HEIGHT - MARGIN.b;
      const slot = (x1 - x0) / KEYS.length;
      const bw = Math.min(64, slot * 0.56);
      return { x0, x1, y0, y1, plotH: y1 - y0, slot, bw, cx: (i: number) => x0 + slot * (i + 0.5) };
    };

    const render = (t: number) => {
      if (W <= 0) return;
      const { x0, x1, y0, y1, plotH, slot, bw, cx } = geom();
      const top = frameTopAt(t);
      const yOf = (u: number) => y1 - (u / top) * plotH;
      const reveal = easeOutCubic(seg(t, T_REVEAL));

      plotClipRect.setAttribute('x', String(x0));
      plotClipRect.setAttribute('y', String(y0));
      plotClipRect.setAttribute('width', String(x1 - x0));
      plotClipRect.setAttribute('height', String(plotH));
      baseline.setAttribute('x1', String(x0));
      baseline.setAttribute('x2', String(x1));
      baseline.setAttribute('y1', String(y1));
      baseline.setAttribute('y2', String(y1));
      axisTitle.setAttribute('transform', `translate(14 ${(y0 + y1) / 2}) rotate(-90)`);

      // gridlines at Rigel multiples: several step sizes at once, each fading
      // with its pixel spacing, so the ruling densifies and relabels smoothly
      // as the frame pulls back instead of popping between tick schemes
      let gi = 0;
      let li = 0;
      const labelled = new Set<number>();
      for (const step of GRID_STEPS) {
        const spacing = (step / top) * plotH;
        if (spacing < 12) continue;
        const lineA = clamp01((spacing - 12) / 26);
        const labelA = LABEL_STEPS.has(step) ? clamp01((spacing - 32) / 22) : 0;
        for (let u = step; u < top && gi < POOL; u += step) {
          const y = yOf(u);
          const l = grid[gi];
          const s = seps[gi];
          gi++;
          for (const el of [l, s]) {
            el.setAttribute('x1', String(x0));
            el.setAttribute('x2', String(x1));
            el.setAttribute('y1', String(y));
            el.setAttribute('y2', String(y));
            el.style.display = '';
          }
          l.style.opacity = String(lineA);
          s.style.opacity = String(0.55 * lineA);
          if (labelA > 0 && !labelled.has(u) && li < gridLabels.length) {
            labelled.add(u);
            const tx = gridLabels[li++];
            tx.setAttribute('x', String(x0 - 8));
            tx.setAttribute('y', String(y + 3.5));
            tx.textContent = `×${u}`;
            tx.style.opacity = String(labelA * reveal);
            tx.style.display = '';
          }
        }
      }
      for (; gi < POOL; gi++) {
        grid[gi].style.display = 'none';
        seps[gi].style.display = 'none';
      }
      for (; li < gridLabels.length; li++) gridLabels[li].style.display = 'none';

      KEYS.forEach((k, i) => {
        const units = unitsAt(k, t);
        const x = cx(i) - bw / 2;
        // rigel ends up a couple of pixels tall — keep it perceptible
        const yTop = Math.min(yOf(units), y1 - (units > 0 ? 2 : 0));
        bars[k].setAttribute('d', barPath(x, yTop, bw, y1, 4));
        bars[k].style.opacity = String(clamp01(seg(t, T_GROW) / 0.4));
        const clipR = barsClipRects[i];
        clipR.setAttribute('x', String(x));
        clipR.setAttribute('y', String(Math.max(y0, yTop)));
        clipR.setAttribute('width', String(bw));
        clipR.setAttribute('height', String(Math.max(0, y1 - Math.max(y0, yTop))));

        nameT[k].setAttribute('x', String(cx(i)));
        nameT[k].setAttribute('y', String(y1 + 20));
        flopsT[k].setAttribute('x', String(cx(i)));
        flopsT[k].setAttribute('y', String(y1 + 37));

        // chip: hidden through the whole zoom, then fades in just above the
        // settled bar top with a short upward drift (every bar fits the frame
        // by the time the reveal starts, so no clipped case to handle)
        const { g, rect, tx } = chips[k];
        // rigel is the unit and carries no chip; baselines read "53× more
        // FLOPs", falling back to the short form where a bar's slot is too
        // narrow for the chip to fit without colliding with its neighbour
        const n = Math.round(RATIO[k]);
        tx.textContent = `${n}× more FLOPs`;
        if (tx.getComputedTextLength() + 16 > slot - 6) tx.textContent = `${n}×`;
        const tw = tx.getComputedTextLength() + 16;
        rect.setAttribute('width', String(tw));
        rect.setAttribute('x', String(-tw / 2));
        const chipY = Math.max(4, Math.min(yTop, y1 - 2) - CHIP_H - 6) + 8 * (1 - reveal);
        g.setAttribute('transform', `translate(${cx(i)} ${chipY})`);
        g.style.opacity = String(reveal);
        g.style.display = reveal > 0 && k !== 'rigel' ? '' : 'none';
      });
    };

    // --- playback ------------------------------------------------------------
    let raf = 0;
    let start = 0;
    let current = 0;
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const finish = () => {
      stop();
      current = DURATION;
      render(DURATION);
    };
    const tick = (now: number) => {
      current = Math.min(DURATION, (now - start) / 1000);
      render(current);
      if (current < DURATION) raf = requestAnimationFrame(tick);
      else finish();
    };
    const play = () => {
      stop();
      if (motionMq.matches) {
        finish();
        return;
      }
      start = performance.now();
      raf = requestAnimationFrame(tick);
    };

    let visible = false;
    const ro = new ResizeObserver(() => {
      const w = root.clientWidth;
      if (w === W) return;
      const first = W === 0;
      W = w;
      if (!first) render(current);
      else if (visible) play();
      else render(0);
    });
    ro.observe(root);

    // replay on every scroll-in: start once half the figure is showing, and
    // rewind to the opening frame once it has fully left the viewport
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.intersectionRatio >= 0.5 && !visible) {
            visible = true;
            if (W > 0) play();
          } else if (!e.isIntersecting && visible) {
            visible = false;
            stop();
            current = 0;
            if (W > 0) render(0);
          }
        }
      },
      { threshold: [0, 0.5] }
    );
    io.observe(root);

    colorMq.addEventListener('change', applyTheme);
    const mo = new MutationObserver(applyTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.addEventListener('beforeprint', finish);

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      colorMq.removeEventListener('change', applyTheme);
      window.removeEventListener('beforeprint', finish);
      svg.remove();
    };
  }, []);

  return <div ref={host} />;
}
