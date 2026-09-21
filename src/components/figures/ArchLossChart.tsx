// Attention-layer ablation for the Rigel post: train/lm_loss vs tokens for
// the four ~105B-token runs (base GQA, gated attention, XSA, gated + XSA),
// from results/arch.json — every logged point of a compacted W&B export.
// XSA, the variant Rigel ships with, takes the Rigel blue; base is the muted
// ink so the three modifications read against it. An optional Gaussian
// smoother (σ in tokens) helps separate runs that end ~0.03 apart.
import { useMemo, useState } from 'react';
import PlotChart, { type ChartSpec } from '../PlotChart';
import arch from '../../../results/arch.json';

const DATA = arch as { tokens: number[]; runs: Record<string, number[]> };

const RUNS: { key: string; name: string; color: string }[] = [
  { key: 'base', name: 'GQA', color: '#6d6860' },
  { key: 'xsa', name: 'XSA', color: '#2a78d6' },
  { key: 'gated-attn', name: 'gated attention', color: '#eb6834' },
  { key: 'gated-xsa', name: 'gated attention + XSA', color: '#1baf7a' },
];

// y window: the runs end within ~0.03 of each other, so the view is pinned
// tight — bottom just under the lowest loss, top at the highest loss once
// 15% of the run is done (past the warmup drop from ~22)
const ALL = Object.values(DATA.runs).flat();
const Y_MIN = Math.floor((Math.min(...ALL) - 0.02) * 20) / 20;
const AT15 = DATA.tokens.findIndex((t) => t >= 0.15 * DATA.tokens[DATA.tokens.length - 1]);
const Y_MAX = Math.ceil(Math.max(...RUNS.map((r) => DATA.runs[r.key][AT15])) * 20) / 20;

// mean spacing between logged points, in billions of tokens — converts the
// slider's σ (tokens) into a kernel width in samples
const SPACING = (DATA.tokens[DATA.tokens.length - 1] - DATA.tokens[0]) / (DATA.tokens.length - 1);
const SIGMA_MAX_B = 3;

// Gaussian kernel smoothing, truncated at 3σ and renormalised at the edges
// (so the ends aren't dragged toward zero)
function gaussianSmooth(values: number[], sigmaPts: number): number[] {
  if (sigmaPts <= 0) return values;
  const radius = Math.ceil(3 * sigmaPts);
  const kernel = Array.from({ length: 2 * radius + 1 }, (_, k) => Math.exp(-((k - radius) ** 2) / (2 * sigmaPts * sigmaPts)));
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let wsum = 0;
    const lo = Math.max(0, i - radius);
    const hi = Math.min(values.length - 1, i + radius);
    for (let j = lo; j <= hi; j++) {
      const w = kernel[j - i + radius];
      sum += w * values[j];
      wsum += w;
    }
    out[i] = sum / wsum;
  }
  return out;
}

function buildSpec(sigmaB: number): ChartSpec {
  const sigmaPts = sigmaB / SPACING;
  return {
    height: 400,
    traces: RUNS.map((r) => ({
      type: 'scatter',
      mode: 'lines',
      name: r.name,
      x: DATA.tokens,
      y: gaussianSmooth(DATA.runs[r.key], sigmaPts),
      line: { color: r.color, width: 1.5 },
      hovertemplate: `<b>%{x:.1f}B tokens</b><br><b>${r.name}</b>: %{y:.4f}<extra></extra>`,
    })),
    layout: {
      showlegend: true,
      hovermode: 'x unified',
      xaxis: { title: 'tokens (billions)', ticksuffix: 'B', showspikes: true, spikemode: 'across', spikethickness: 1, spikedash: 'dot', spikecolor: '#6d6860' },
      yaxis: { title: 'train/lm_loss', range: [Y_MIN, Y_MAX] },
      margin: { l: 60, r: 20, t: 34, b: 52 },
    },
  };
}

export default function ArchLossChart() {
  const [sigmaB, setSigmaB] = useState(0);
  const spec = useMemo(() => buildSpec(sigmaB), [sigmaB]);
  return (
    <div>
      <PlotChart spec={spec} />
      <div className="chart-controls">
        <label>
          Gaussian smoothing σ: {sigmaB === 0 ? 'off' : `${sigmaB.toFixed(1)}B tokens`}
          <input type="range" min={0} max={SIGMA_MAX_B} step={0.1} value={sigmaB} onChange={(e) => setSigmaB(parseFloat(e.target.value))} />
        </label>
      </div>
    </div>
  );
}
