// Generic client island: renders a baked Plotly spec ({traces, layout, height})
// against the site's live theme. Specs are generated for the light paper theme;
// in dark mode the palette is inverted with the map below. Re-renders on theme
// toggle (data-theme attr), OS preference change, and container resize.
//
// Hover is a custom DOM "paper card" tooltip (plotly's native SVG labels can't
// do radius/shadow/type hierarchy). The native hoverlabel is made transparent;
// plotly_hover events feed the card. Style mirrors humansand.ai tooltips.
import { useEffect, useRef, useState } from 'react';

type Trace = Record<string, any>;
export type ChartSpec = {
  traces: Trace[];
  layout: Record<string, any>;
  height?: number;
  // neon glow (CSS drop-shadow, see .plot-chart .glow in global.css) on the
  // leading series: 'trace' lights every bar of the first trace, 'point' only
  // the first bar of the first trace. Colour follows that series' marker.
  glow?: 'trace' | 'point';
};

// light -> dark token inversion for spec-embedded colors (structural colors are
// handled by the base layout overrides; trace accents get dark-readable tints)
export const DARK: Record<string, string> = {
  '#161513': '#ece7db', '#3d3a33': '#d8d3c7', '#6d6860': '#9d968a',
  '#e4ded2': '#38342c', '#d8d0c4': '#4a453b', '#e8e2d5': '#38342c',
  '#176b64': '#4fb3a7', '#2f6f4f': '#3fb950', '#a33e2d': '#e2896a',
  '#a8763e': '#d2a25c', '#b98a2e': '#e3b341', '#7d5ba6': '#b48be0',
  '#2e8b81': '#4fb3a7', '#c2683a': '#f0883e', '#1e3a8a': '#7aa7f0',
  // dataviz-skill default categorical palette (Rigel post's data-mixture pies)
  '#2a78d6': '#3987e5', '#eb6834': '#d95926', '#1baf7a': '#199e70',
  '#eda100': '#c98500', '#e87ba4': '#d55181', '#008300': '#008300',
  '#4a3aa7': '#9085e9', '#e34948': '#e66767',
  // Rigel's own series: electric blue, light → brighter dark token
  '#1f6fe0': '#4da3ff',
  // alpha-0 open-marker rings (stroke = marker.color in plotly-basic): the
  // dark-teal rings would vanish on the dark paper, so lift them to light teal
  'rgba(23,107,100,0)': 'rgba(79,179,167,0)',
  'rgba(23,107,100,0.0)': 'rgba(79,179,167,0)',
};

const clone = (o: any, map: Record<string, string>) => {
  let s = JSON.stringify(o);
  for (const [from, to] of Object.entries(map)) s = s.split(from).join(to);
  return JSON.parse(s);
};

// --- hover helpers ---------------------------------------------------------

type Metric = { label: string; value: string };
type TipBlock = { color: string; title: string; metrics: Metric[] };
type Tip = {
  x: number;
  y: number;
  flipX: boolean;
  flipY: boolean;
  maxW: number;
  header: string;
  blocks: TipBlock[];
} | null;

// minimal d3-format subset for baked hovertemplates: %{y:.2f}, %{x}, %{customdata[0]}.
// ".N%" is d3's percentage type: value is scaled by 100 (not just formatted) —
// plotly's own "percent" pie field is a 0-1 fraction, so this is what turns it
// into an actual "19.9%" instead of the raw "0.199415".
const fmt = (v: any, spec: string | undefined): string => {
  if (v == null) return '';
  const pct = spec?.match(/^\.(\d+)%$/);
  if (pct && typeof v === 'number') return `${(v * 100).toFixed(parseInt(pct[1], 10))}%`;
  const m = spec?.match(/^\.(\d+)f$/);
  if (typeof v === 'number') return m ? v.toFixed(parseInt(m[1], 10)) : String(+v.toPrecision(6));
  return String(v);
};

const resolveTmpl = (tmpl: string, pt: any, trace: Trace): string =>
  tmpl.replace(/%\{([^}]+)\}/g, (_: string, key: string) => {
    const [path, spec] = key.split(':');
    // plotly's own "percent" pie field has no explicit format spec in most
    // hovertemplates (plotly formats it natively); our custom renderer has to
    // be told, so default it to one decimal place when none is given.
    if (path === 'percent') return fmt(pt.percent, spec ?? '.1%');
    const cd = path.match(/^customdata\[(\d+)\]$/);
    if (cd) {
      const cdArr = trace.customdata?.[pt.pointIndex ?? pt.pointNumber];
      return fmt(Array.isArray(cdArr) ? cdArr[+cd[1]] : undefined, spec);
    }
    return fmt(pt[path], spec);
  });

// baked hovertemplates are "<br>"-joined lines: the first line is the point's
// title, every following line is a "<b>label</b>: value" metric — one metric
// per line, so nothing needs to be crammed onto (or overflow off of) a single
// row. A line with no bold label is shown as a plain title-adjacent line.
const strip = (s: string) => s.replace(/<[^>]+>/g, '').trim();
const METRIC_RE = /^<b>([^<]+)<\/b>:\s*(.*)$/;

const parseHover = (tmpl: string): { title: string; metrics: Metric[] } => {
  const main = (tmpl.split(/<extra>/)[0] ?? '').trim();
  const segs = main.split(/<br\s*\/?>/i).map((s) => s.trim()).filter(Boolean);
  if (!segs.length) return { title: '', metrics: [] };
  const title = strip(segs[0]!);
  const metrics: Metric[] = segs.slice(1).map((seg) => {
    const m = seg.match(METRIC_RE);
    return m ? { label: m[1]!, value: strip(m[2]!) } : { label: '', value: strip(seg) };
  });
  return { title, metrics };
};

const traceColor = (t: Trace, dark: boolean): string => {
  const c = t.marker?.color ?? t.line?.color ?? t.marker_color ?? '#6d6860';
  return dark ? DARK[c] ?? c : c;
};
// ----------------------------------------------------------------------------

// Reveal animation for pies: a clockwise clock-wipe from 12 o'clock, matching
// plotly's slice drawing order, so the donut "spins" to fill in. Done as a
// conic-gradient mask over the rendered plot (composited, 60fps) rather than
// by restyling slice values frame by frame. Replays on every scroll-in: the
// donut is held blank while off-screen and sweeps in each time it returns.
export type Sweep = { delay?: number; duration?: number };

const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;

function createSweep(target: HTMLElement, { delay = 0, duration = 1200 }: Sweep) {
  let raf = 0;
  let timer = 0;
  const labels = () => Array.from(target.querySelectorAll<SVGElement>('.slicetext'));
  // measured at play time — the pie re-centers on resize/redraw
  const center = () => {
    const slices = Array.from(target.querySelectorAll<SVGGraphicsElement>('.slice path'));
    if (!slices.length) return null;
    const host = target.getBoundingClientRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of slices) {
      const r = s.getBoundingClientRect();
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top);
      x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
    }
    return { cx: (x0 + x1) / 2 - host.left, cy: (y0 + y1) / 2 - host.top };
  };
  const setMask = (m: string) => {
    target.style.maskImage = m;
    (target.style as any).webkitMaskImage = m;
  };
  const setLabels = (opacity: string, transition = '') => {
    for (const l of labels()) {
      l.style.transition = transition;
      l.style.opacity = opacity;
    }
  };
  const stop = () => {
    window.clearTimeout(timer);
    cancelAnimationFrame(raf);
    raf = 0;
  };
  const show = () => {
    stop();
    setMask('');
    setLabels('1');
  };
  const hide = () => {
    stop();
    const c = center();
    if (!c) return;
    setMask(`conic-gradient(from 0deg at ${c.cx}px ${c.cy}px, transparent 0deg)`);
    setLabels('0');
  };
  const play = () => {
    stop();
    const c = center();
    if (!c) return;
    const wipe = (deg: number) =>
      setMask(deg >= 360 ? '' : `conic-gradient(from 0deg at ${c.cx}px ${c.cy}px, #000 ${deg}deg, transparent ${deg}deg)`);
    wipe(0);
    setLabels('0');
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const p = Math.min(1, (now - start) / duration);
      wipe(360 * easeOutCubic(p));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setLabels('1', 'opacity 0.45s ease');
    };
    timer = window.setTimeout(() => (raf = requestAnimationFrame(tick)), delay);
  };
  return { play, hide, show };
}

// Reveal animation for bar charts: each bar scales up from its own baseline
// (CSS transform, composited — no data restyling), value labels held
// invisible until the bars finish rising then fade in together, mirroring
// how the pie sweep holds its slice labels back during the wipe. Replays on
// every scroll-in, same as the pie sweep.
function createBarGrow(target: HTMLElement, { delay = 0, duration = 800 }: Sweep) {
  let raf = 0;
  let timer = 0;
  const bars = () => Array.from(target.querySelectorAll<SVGPathElement>('.barlayer .point path'));
  const labels = () => Array.from(target.querySelectorAll<SVGElement>('.bartext'));
  const setBars = (scale: number, transition = '') => {
    for (const b of bars()) {
      (b.style as any).transformBox = 'fill-box';
      b.style.transformOrigin = 'bottom';
      b.style.transition = transition;
      b.style.transform = `scaleY(${scale})`;
    }
  };
  const setLabels = (opacity: string, transition = '') => {
    for (const l of labels()) {
      l.style.transition = transition;
      l.style.opacity = opacity;
    }
  };
  const stop = () => {
    window.clearTimeout(timer);
    cancelAnimationFrame(raf);
    raf = 0;
  };
  const show = () => {
    stop();
    setBars(1);
    setLabels('1');
  };
  const hide = () => {
    stop();
    setBars(0);
    setLabels('0');
  };
  const play = () => {
    stop();
    setBars(0);
    setLabels('0');
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const p = Math.min(1, (now - start) / duration);
      setBars(easeOutCubic(p));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setLabels('1', 'opacity 0.45s ease');
    };
    timer = window.setTimeout(() => (raf = requestAnimationFrame(tick)), delay);
  };
  return { play, hide, show };
}

export default function PlotChart({ spec, height, sweep }: { spec: ChartSpec; height?: number; sweep?: Sweep }) {
  const el = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const [dark, setDark] = useState(false);
  // "you are here" dots snapped to the hovered data point(s) of line traces
  const [dots, setDots] = useState<{ x: number; y: number; color: string }[]>([]);
  const swept = useRef(false);
  const cancelSweep = useRef<() => void>(() => {});
  const theme = useRef({ ink: '#161513', muted: '#6d6860', line: '#d8d0c4', paper: '#fffdf8' });
  const lastPointer = useRef({ x: 0, y: 0 });
  // restyle() is async and redraws the plot; firing one on every hover event
  // (a tiny slice can fire several in quick succession as the pointer
  // crosses it) lets calls overlap and land out of order, which is what the
  // flicker was — desired state is tracked separately from what's actually
  // been applied, and only one restyle is ever in flight at a time.
  const pieDesired = useRef<{ curve: number; idx: number } | null>(null);
  const pieApplied = useRef<{ curve: number; idx: number } | null>(null);
  const pieBusy = useRef(false);
  const pieOriginal = useRef<Record<number, { colors: string[] }>>({});

  useEffect(() => {
    let alive = true;
    let Plotly: any = null;
    const target = el.current!;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');

    const isDark = () =>
      document.documentElement.getAttribute('data-theme') === 'dark' ||
      (!document.documentElement.hasAttribute('data-theme') && mq.matches);

    const draw = async () => {
      if (!Plotly) {
        const mod: any = await import('plotly.js-basic-dist-min');
        Plotly = mod.default ?? mod;

      }
      if (!alive) return;
      const dk = isDark();
      setDark(dk);
      const css = getComputedStyle(document.documentElement);
      const v = (n: string, fb: string) => css.getPropertyValue(n).trim() || fb;
      const ink = v('--ink', dk ? '#ece7db' : '#161513');
      const muted = v('--muted', dk ? '#9d968a' : '#6d6860');
      const line = v('--line', dk ? '#38342c' : '#d8d0c4');
      const paper = v('--paper', dk ? '#1c1a16' : '#fffdf8');
      theme.current = { ink, muted, line, paper };

      // plotly's cleanData throws on null object values ("name": null,
      // marker.line: null on traces without the outline) — strip recursively.
      // Nulls inside coordinate arrays (x/y) stay: they're valid line gap
      // markers. Null hovertemplate entries (empty log-axis bars) become ''.
      const stripNulls = (o: any): any => {
        if (Array.isArray(o)) return o.map((v) => (v && typeof v === 'object' ? stripNulls(v) : v));
        if (o && typeof o === 'object') {
          const out: Trace = {};
          for (const k of Object.keys(o)) if (o[k] != null) out[k] = stripNulls(o[k]);
          return out;
        }
        return o;
      };
      const traces = (dk ? clone(spec.traces, DARK) : spec.traces).map((t: Trace) => {
        const out = stripNulls(t);
        if (Array.isArray(out.hovertemplate))
          out.hovertemplate = out.hovertemplate.map((v: any) => v ?? '');
        return out;
      });
      // plotly.react does not clone the arrays it's handed — it mutates
      // trace objects in place on later restyle() calls. Snapshot each pie's
      // real colors now, before anything can touch them, so the hover
      // highlight always has an untouched original to restyle back to
      // (reading it back off `traces` after a restyle would read the
      // already-mutated, greyed-out values).
      const pieSnapshots: Record<number, { colors: string[] }> = {};
      traces.forEach((t: Trace, i: number) => {
        if (t.type === 'pie' && Array.isArray(t.marker?.colors)) {
          pieSnapshots[i] = { colors: [...t.marker.colors] };
        }
      });
      pieOriginal.current = pieSnapshots;
      pieDesired.current = null;
      pieApplied.current = null;
      pieBusy.current = false;

      const sameSel = (a: { curve: number; idx: number } | null, b: { curve: number; idx: number } | null) =>
        a === b || (!!a && !!b && a.curve === b.curve && a.idx === b.idx);

      // Converges to whatever pieDesired last was, one restyle at a time —
      // never starts a second restyle while one is still in flight, so rapid
      // hover/unhover pairs (a small slice's hit-region is easy to skim past)
      // can't have their restyle calls land out of order.
      const applyPieDesired = () => {
        if (pieBusy.current || sameSel(pieDesired.current, pieApplied.current)) return;
        const desired = pieDesired.current;
        pieBusy.current = true;
        const grey = dk ? '#4a453b' : '#d8d3c7';
        const writes = Object.entries(pieOriginal.current).map(([iStr, orig]) => {
          const i = Number(iStr);
          const idx = desired && desired.curve === i ? desired.idx : -1;
          return Plotly.restyle(
            target,
            { 'marker.colors': [orig.colors.map((c: string, k: number) => (!desired || k === idx ? c : grey))] },
            [i]
          );
        });
        Promise.all(writes).then(() => {
          pieApplied.current = desired;
          pieBusy.current = false;
          applyPieDesired();
        });
      };
      const src = dk ? clone(spec.layout, DARK) : spec.layout;
      delete src.title; // the <Figure> caption is the title on the blog
      const grid = dk ? '#29261f' : '#efe9df';
      const axis = {
        gridcolor: grid,
        zerolinecolor: line,
        tickfont: { size: 11, color: muted },
        automargin: true,
      };
      // plotly-basic does NOT coerce string axis titles (title: 'x' silently
      // renders nothing — verified standalone). Normalize to { text, font }.
      // plotly 3.x also removed axis.titlefont: titles must carry their own font,
      // else they inherit a much larger size and clip out of the fixed-height svg.
      const normAxis = (a: any): Trace | undefined => {
        if (!a) return a;
        const t = typeof a.title === 'string' ? { text: a.title } : a.title;
        if (!t?.text) return { ...a, title: t };
        return { ...a, title: { ...t, font: { size: 11.5, color: muted, ...(t.font ?? {}) } } };
      };
      const sxaxis = normAxis(src.xaxis);
      const syaxis = normAxis(src.yaxis);
      const hasLegend = traces.some((t: Trace) => t.showlegend !== false && t.name);
      const sourceMargin = src.margin ?? {};
      const margin = {
        l: 64,
        r: 24,
        t: hasLegend ? 34 : 14,
        b: sxaxis?.title?.text ? 58 : 46,
        ...sourceMargin,
      };
      // A few generated specs reserve a much larger top band for a horizontal
      // legend than the legend actually needs. Keep enough room for the
      // legend, but give that space back to the plot so the graph fills its
      // panel. Specs with long annotations or category labels keep their
      // explicit side/bottom margins unchanged.
      if (hasLegend && margin.t > 56) margin.t = 56;
      const layout: Record<string, any> = {
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { family: 'Inter, system-ui, sans-serif', size: 12, color: ink },
        // deeper bottom edge when an x-axis title exists (automargin under-compensates
        // at the fixed chart heights and the title row clips out of the svg)
        hovermode: 'closest',
        // native SVG label stays invisible — the DOM card below is the tooltip
        hoverlabel: { bgcolor: 'rgba(0,0,0,0)', bordercolor: 'rgba(0,0,0,0)', font: { color: 'rgba(0,0,0,0)', size: 1 } },
        legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, x: 0, bgcolor: 'rgba(0,0,0,0)', font: { size: 11, color: muted }, itemsizing: 'constant' },
        ...src,
        margin,
        dragmode: false,
        xaxis: { ...axis, ...(sxaxis ?? {}), gridcolor: grid, zerolinecolor: line, tickfont: { size: 11, color: muted } },
        yaxis: { ...axis, ...(syaxis ?? {}), gridcolor: grid, zerolinecolor: line, tickfont: { size: 11, color: muted } },
      };
      // Glow: tag the leading trace (or its first bar) by the data plotly binds
      // to each group — DOM order isn't guaranteed to follow trace order — and
      // re-tag after every redraw (resize, theme flip), since plotly may
      // recreate the groups.
      const applyGlow = () => {
        if (!spec.glow) return;
        const c = traces[0]?.marker?.color;
        target.style.setProperty('--glow', (Array.isArray(c) ? c[0] : c) ?? 'currentColor');
        for (const g of Array.from(target.querySelectorAll<SVGGElement>('.barlayer .trace'))) {
          const d = (g as any).__data__;
          const lead = d?.[0]?.trace?.index === 0;
          g.classList.toggle('glow', lead && spec.glow === 'trace');
          const points = Array.from(g.querySelectorAll<SVGGElement>('.point'));
          for (const p of points) {
            const first = ((p as any).__data__?.i ?? points.indexOf(p)) === 0;
            p.classList.toggle('glow', lead && spec.glow === 'point' && first);
          }
        }
      };
      try {
        const drawn = Plotly.react(target, traces, layout, {
          responsive: true,
          displaylogo: false,
          displayModeBar: false,
          doubleClick: false,
          scrollZoom: false,
        });
        if (spec.glow) {
          target.removeAllListeners?.('plotly_afterplot');
          target.on('plotly_afterplot', applyGlow);
          Promise.resolve(drawn).then(() => alive && applyGlow());
        }
        const isPieChart = traces.some((t: Trace) => t.type === 'pie');
        const isBarChart = traces.some((t: Trace) => t.type === 'bar');
        if (sweep && !swept.current && (isPieChart || isBarChart) && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          swept.current = true;
          Promise.resolve(drawn).then(() => {
            if (!alive) return;
            const ctl = isPieChart ? createSweep(target, sweep) : createBarGrow(target, sweep);
            ctl.hide();
            // play once at least half the chart is showing; blank it again only
            // once it has fully left, so nudging around the edge doesn't retrigger
            let visible = false;
            const io = new IntersectionObserver(
              (entries) => {
                for (const e of entries) {
                  if (e.intersectionRatio >= 0.5 && !visible) {
                    visible = true;
                    ctl.play();
                  } else if (!e.isIntersecting && visible) {
                    visible = false;
                    ctl.hide();
                  }
                }
              },
              { threshold: [0, 0.5] }
            );
            io.observe(target);
            window.addEventListener('beforeprint', ctl.show);
            cancelSweep.current = () => {
              io.disconnect();
              window.removeEventListener('beforeprint', ctl.show);
              ctl.show();
            };
          });
        }
      } catch (e) {
        console.error('[PlotChart] render failed:', e, JSON.stringify(traces).slice(0, 400));
      }

      const rawTraces = spec.traces;
      target.removeAllListeners?.('plotly_hover');
      target.removeAllListeners?.('plotly_unhover');
      target.on('plotly_hover', (ev: any) => {
        if (!ev?.points?.length || !wrap.current) return;
        const wrect = wrap.current.getBoundingClientRect();
        // some plotly builds include the raw pointer event; else use the tracked position
        let px = lastPointer.current.x;
        let py = lastPointer.current.y;
        if (ev.event?.clientX != null) {
          px = ev.event.clientX - wrect.left;
          py = ev.event.clientY - wrect.top;
        }
        const blocks: TipBlock[] = [];
        const blockYs: number[] = [];
        const nextDots: { x: number; y: number; color: string }[] = [];
        // axis pixels are relative to plotly's svg, which sits inside the
        // .plot-chart border + padding — measure that offset from the wrap
        const svgRect = target.querySelector('.main-svg')?.getBoundingClientRect();
        const ox = svgRect ? svgRect.left - wrect.left : 0;
        const oy = svgRect ? svgRect.top - wrect.top : 0;
        let header = '';
        // x-hover hands us one point per trace within hoverdistance, which for
        // piecewise-coloured lines drags in the neighbouring segment's
        // endpoint — keep only the point(s) nearest the pointer along x
        // (ties within half a pixel stay, so aligned multi-series still show)
        let pts: any[] = ev.points;
        const clientX = ev.event?.clientX ?? wrect.left + lastPointer.current.x;
        if (pts.length > 1 && svgRect && pts.every((p) => p.xaxis?.d2p && p.x != null)) {
          const dPx = pts.map((p) => Math.abs(p.xaxis.d2p(p.x) + p.xaxis._offset - (clientX - svgRect.left)));
          const min = Math.min(...dPx);
          pts = pts.filter((_, i) => dPx[i] <= min + 0.5);
        }
        // piecewise lines share their boundary point across two traces —
        // report it once
        const seenXY = new Set<string>();
        // x-unified hover on several overlapping series (e.g. loss curves for
        // multiple runs) fires one point per trace at the same x — a
        // hovertemplate's first line is conventionally that shared x value, so
        // with >1 point it's repeated verbatim across every block. Hoist it
        // into the one shared header instead of stacking it under every block.
        const multi = pts.length > 1;
        for (const pt of pts) {
          if (pt.x != null && pt.y != null) {
            const xyKey = `${pt.x}|${pt.y}`;
            if (seenXY.has(xyKey)) continue;
            seenXY.add(xyKey);
          }
          const t: Trace = rawTraces[pt.curveNumber] ?? {};
          // snap a dot onto the hovered point of line traces (axis d2p maps
          // data -> plot pixels on the current range)
          if (t.type === 'scatter' && pt.xaxis?.d2p && pt.yaxis?.d2p && pt.x != null && pt.y != null) {
            nextDots.push({
              x: pt.xaxis.d2p(pt.x) + pt.xaxis._offset + ox,
              y: pt.yaxis.d2p(pt.y) + pt.yaxis._offset + oy,
              color: traceColor(t, dk),
            });
          }
          // pie slices have no cursor/crosshair to mark position on the chart
          // itself — the only "you are here" cue was the mouse arrow. Give
          // the hovered wedge a bright border glow and grey out the rest
          // instead, so the slice itself is the highlight.
          if (t.type === 'pie' && Array.isArray(t.values) && pieOriginal.current[pt.curveNumber]) {
            const idx = pt.pointIndex ?? pt.pointNumber ?? 0;
            pieDesired.current = { curve: pt.curveNumber, idx };
            applyPieDesired();
          }
          if (!header) {
            // only explicit category labels make good headers; raw numeric x would be noise
            if (typeof pt.xLabel === 'string') header = pt.xLabel;
          }
          const htmpl = Array.isArray(t.hovertemplate)
            ? t.hovertemplate[pt.pointIndex ?? pt.pointNumber]
            : typeof t.hovertemplate === 'string'
              ? resolveTmpl(t.hovertemplate, pt, t)
              : null;
          const color = traceColor(t, dk);
          if (htmpl != null) {
            const { title, metrics } = parseHover(String(htmpl));
            if (multi && !header && title) header = title;
            const blockTitle = multi ? t.name || title || '' : title || t.name || '';
            // the block's own title now restates the series name — drop a
            // lone metric label that just repeats it (e.g. "XSA: 0.1234"
            // under a "XSA" heading), leaving just the value
            const blockMetrics =
              multi && metrics.length === 1 && metrics[0].label.toLowerCase() === blockTitle.toLowerCase()
                ? [{ label: '', value: metrics[0].value }]
                : metrics;
            blocks.push({ color, title: blockTitle, metrics: blockMetrics });
          } else {
            blocks.push({ color, title: t.name || '', metrics: [{ label: '', value: fmt(pt.y, undefined) }] });
          }
          blockYs.push(typeof pt.y === 'number' ? pt.y : NaN);
        }
        // several line series at one x: list them highest value first, which
        // is the top-to-bottom order the lines have on the plot at that x
        if (blocks.length > 1 && blockYs.every((y) => !Number.isNaN(y))) {
          const order = blocks.map((_, i) => i).sort((a, b) => blockYs[b] - blockYs[a]);
          blocks.splice(0, blocks.length, ...order.map((i) => blocks[i]));
        }
        // Flip/clamp against the actual viewport, not this chart's own box —
        // the card is a page-level overlay, so it's fine for it to spill past
        // the plot's edges, but it must never spill past the page's. (Using
        // `left` + `translateX(-100%)` for the flipped case used to collapse
        // the card's width to near-zero: an absolutely-positioned box with
        // only `left` set shrink-to-fits within "container width minus left",
        // which is tiny when `left` sits near the container's right edge —
        // the transform then just slides that already-collapsed, very tall
        // card into place. Anchoring with `right`/`bottom` instead sidesteps
        // shrink-to-fit entirely.)
        const vx = wrect.left + px;
        const vy = wrect.top + py;
        const flipX = window.innerWidth - vx < 620;
        const flipY = window.innerHeight - vy < 190;
        const maxW = window.innerWidth - 16;
        setTip({
          x: flipX ? Math.max(8, wrect.right - vx + 14) : Math.max(8, vx - wrect.left + 14),
          y: flipY ? Math.max(8, wrect.bottom - vy + 16) : Math.max(8, vy - wrect.top + 16),
          flipX,
          flipY,
          maxW,
          header,
          blocks,
        });
        setDots(nextDots);
      });
      target.on('plotly_unhover', () => {
        setTip(null);
        setDots([]);
        pieDesired.current = null;
        applyPieDesired();
      });
    };

    draw();
    mq.addEventListener('change', draw);
    const onMove = (e: PointerEvent) => {
      const r = wrap.current?.getBoundingClientRect();
      if (r) lastPointer.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    target.addEventListener('pointermove', onMove);
    const mo = new MutationObserver(draw);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const ro = new ResizeObserver(() => {
      if (Plotly?.Plots && target) Plotly.Plots.resize(target);
    });
    ro.observe(target);
    return () => {
      alive = false;
      cancelSweep.current();
      mq.removeEventListener('change', draw);
      target.removeAllListeners?.('plotly_hover');
      target.removeAllListeners?.('plotly_unhover');
      target.removeEventListener('pointermove', onMove);
      mo.disconnect();
      ro.disconnect();
    };
  }, [spec]);

  const th = theme.current;
  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <div ref={el} className="plot-chart" style={{ height: height ?? spec.height ?? 420 }} />
      {dots.map((d, i) => (
        <span
          key={i}
          className="plot-dot"
          style={{
            position: 'absolute',
            // border-box so the ring is inside the 6px box and the dot's
            // centre lands exactly on the data point
            boxSizing: 'border-box',
            left: d.x - 3,
            top: d.y - 3,
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: th.paper,
            border: `1.5px solid ${d.color}`,
            pointerEvents: 'none',
            zIndex: 4,
          }}
        />
      ))}
      {tip && (
        <div
          className="plot-tip"
          style={{
            position: 'absolute',
            ...(tip.flipX ? { right: tip.x } : { left: tip.x }),
            ...(tip.flipY ? { bottom: tip.y } : { top: tip.y }),
            zIndex: 5,
            pointerEvents: 'none',
            background: th.paper,
            border: `1px solid ${th.line}`,
            borderRadius: 6,
            padding: '8px 10px',
            font: `12.5px/1.5 Inter, system-ui, sans-serif`,
            maxWidth: tip.maxW,
            whiteSpace: 'nowrap',
            boxShadow: dark
              ? '0 8px 28px rgba(0, 0, 0, 0.55)'
              : '0 6px 24px rgba(32, 28, 20, 0.14)',
            opacity: 1,
            transition: 'opacity 0.1s ease',
          }}
        >
          {tip.header && (
            <div
              style={{
                font: '600 10px/1 "SF Mono", Menlo, ui-monospace, monospace',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: th.muted,
                marginBottom: 5,
              }}
            >
              {tip.header}
            </div>
          )}
          {(tip.blocks ?? []).map((b, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                marginTop: i > 0 ? 6 : 0,
              }}
            >
              <span style={{ width: 14, marginTop: 6, flexShrink: 0, borderTop: `2.5px solid ${b.color}`, borderRadius: 2 }} />
              <div style={{ flex: '0 1 auto' }}>
                <div
                  style={{
                    font: '600 11.5px/1.4 "SF Mono", Menlo, ui-monospace, monospace',
                    color: th.ink,
                    paddingBottom: b.metrics.length ? 4 : 0,
                    marginBottom: b.metrics.length ? 4 : 0,
                    borderBottom: b.metrics.length ? `1px solid ${th.line}` : 'none',
                  }}
                >
                  {b.title}
                </div>
                {b.metrics.map((m, j) => (
                  <div
                    key={j}
                    style={{
                      display: 'flex',
                      justifyContent: m.label ? 'space-between' : 'flex-start',
                      gap: 8,
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: '11.5px',
                      lineHeight: 1.5,
                    }}
                  >
                    {m.label && <span style={{ fontWeight: 700, color: th.ink }}>{m.label}</span>}
                    <span style={{ textAlign: 'right', color: th.muted }}>{m.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
