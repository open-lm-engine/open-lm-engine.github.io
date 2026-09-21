// Piecewise colouring of a training curve by the cluster each stretch of the
// run was trained on, from results/hardware-segments.json. Every distinct
// (accelerator, chip count) configuration gets its own colour: hue =
// accelerator type in a fixed order (so a type keeps its hue whatever
// segments are present), shade = chip count within that type — more chips,
// stronger colour. There is no legend; the hover names the configuration.
// Shared by the loss and learning-rate charts.
import { DARK } from '../PlotChart';
import { PALETTE } from './RigelCharts';
import hardware from '../../../results/hardware-segments.json';

export type Segment = { hardware: string; count: number; from_tokens: number; to_tokens: number };
export const SEGMENTS = (hardware as { segments: Segment[] }).segments;

const TYPE_ORDER = ['V100', 'A100 40GB', 'A100 80GB', 'H100', 'TPU v5p', 'TPU v6e'];
const typeHue = (hw: string) => {
  const i = TYPE_ORDER.indexOf(hw);
  return PALETTE[(i < 0 ? TYPE_ORDER.length : i) % PALETTE.length];
};
// the base hue of an accelerator type, for curves that ran on one cluster
// throughout (the long-context phase) and so need no piecewise colouring
export const hardwareHue = typeHue;

// mix a hex colour toward a target (#000 / #fff) by t in [0, 1]
function mix(hex: string, target: number, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => {
    const c = (n >> shift) & 0xff;
    return Math.round(c + (target - c) * t);
  };
  return '#' + [ch(16), ch(8), ch(0)].map((c) => c.toString(16).padStart(2, '0')).join('');
}

// Shades are spread evenly per type across the counts it was run at. On the
// light paper a higher count is darker; on the dark paper it is lighter (a
// darker shade would sink into the background) — the registered DARK pair
// keeps the two themes in step, since PlotChart swaps colours by exact hex.
const MAX_SHIFT = 0.38;
const CONFIG_COLOR = new Map<string, string>();
{
  const countsByType = new Map<string, number[]>();
  for (const s of SEGMENTS) {
    const counts = countsByType.get(s.hardware) ?? [];
    if (!counts.includes(s.count)) counts.push(s.count);
    countsByType.set(s.hardware, counts);
  }
  for (const [hw, counts] of countsByType) {
    counts.sort((a, b) => a - b);
    const base = typeHue(hw);
    const baseDark = DARK[base] ?? base;
    counts.forEach((count, k) => {
      const t = counts.length === 1 ? 0 : -MAX_SHIFT + (2 * MAX_SHIFT * k) / (counts.length - 1);
      const light = t === 0 ? base : t > 0 ? mix(base, 0x00, t) : mix(base, 0xff, -t);
      const dark = t === 0 ? baseDark : t > 0 ? mix(baseDark, 0xff, t) : mix(baseDark, 0x00, -t);
      if (light !== base) DARK[light] = dark;
      CONFIG_COLOR.set(`${hw}|${count}`, light);
    });
  }
}
export const configColor = (hw: string, count: number) => CONFIG_COLOR.get(`${hw}|${count}`) ?? typeHue(hw);

// legend rows: one per accelerator type (in hue order), listing the chip
// counts it was run at with each count's light/dark swatch colour
export type LegendGroup = { hardware: string; items: { count: number; light: string; dark: string }[] };
export function legendGroups(): LegendGroup[] {
  const types = [...new Set(SEGMENTS.map((s) => s.hardware))].sort(
    (a, b) => (TYPE_ORDER.indexOf(a) + 1 || 99) - (TYPE_ORDER.indexOf(b) + 1 || 99)
  );
  return types.map((hardware) => {
    const counts = [...new Set(SEGMENTS.filter((s) => s.hardware === hardware).map((s) => s.count))].sort((a, b) => a - b);
    return {
      hardware,
      items: counts.map((count) => {
        const light = configColor(hardware, count);
        return { count, light, dark: DARK[light] ?? light };
      }),
    };
  });
}

// inclusive index range of a segment's points; the end index is the first
// point of the next segment, shared so the coloured pieces join up
function segmentIndices(tokens: number[], seg: Segment): [number, number] {
  const last = tokens.length - 1;
  const i0 = tokens.findIndex((t) => t >= seg.from_tokens);
  const i1 = tokens.findIndex((t) => t >= seg.to_tokens);
  return [i0 < 0 ? last : i0, i1 < 0 ? last : i1];
}

type PiecewiseOpts = {
  tokens: number[];
  values: number[];
  customdata: (i: number) => unknown[];
  // given "V100 ×48", returns the plotly hovertemplate for that segment
  hovertemplate: (label: string) => string;
  width: number;
};

// one scatter trace per segment
export function piecewiseTraces({ tokens, values, customdata, hovertemplate, width }: PiecewiseOpts): Record<string, any>[] {
  const traces: Record<string, any>[] = [];
  for (const seg of SEGMENTS) {
    const [i0, i1] = segmentIndices(tokens, seg);
    if (i1 < i0) continue;
    const idx = Array.from({ length: i1 - i0 + 1 }, (_, k) => i0 + k);
    const label = `${seg.hardware} ×${seg.count}`;
    traces.push({
      type: 'scatter',
      mode: 'lines',
      name: label,
      showlegend: false,
      x: idx.map((i) => tokens[i]),
      y: idx.map((i) => values[i]),
      customdata: idx.map(customdata),
      line: { color: configColor(seg.hardware, seg.count), width },
      hovertemplate: hovertemplate(label),
    });
  }
  return traces;
}

// faint dotted rule at each cluster boundary (skipping the run's start), so
// the colour changes read as deliberate segment edges rather than a gradient
// — same treatment as the accuracy chart's "average" divider
export const SEGMENT_BOUNDARY_SHAPES = SEGMENTS.slice(1).map((s) => ({
  type: 'line',
  xref: 'x',
  yref: 'paper',
  x0: s.from_tokens,
  x1: s.from_tokens,
  y0: 0,
  y1: 1,
  line: { color: 'rgba(160,150,130,0.45)', width: 1, dash: 'dot' },
}));

// shared axis styling for the token-axis training curves
export const TOKENS_XAXIS = {
  title: 'tokens (trillions)',
  ticksuffix: 'T',
  showgrid: false, // the cluster-boundary rules are the only verticals
  showspikes: true,
  spikemode: 'across',
  spikethickness: 1,
  spikedash: 'dot',
  spikecolor: '#6d6860',
};

// the long-context phase is ~118B tokens, so its curves read in billions
export const TOKENS_B_XAXIS = { ...TOKENS_XAXIS, title: 'tokens (billions)', ticksuffix: 'B' };
