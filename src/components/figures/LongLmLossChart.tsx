// Training loss over the long-context extension phase, read from
// results/long-lm-loss.json (compacted W&B export of train/lm_loss vs tokens,
// every logged step), smoothed with an EMA over the faint raw curve. This
// phase ran entirely on H100s, so one hue rather than the main run's
// piecewise cluster colouring.
import PlotChart, { type ChartSpec } from '../PlotChart';
import { hardwareHue, TOKENS_B_XAXIS } from './hardwareSegments';
import data from '../../../results/long-lm-loss.json';

const DATA = data as { tokens: number[]; loss: number[]; step: number[] };

// W&B-style exponential moving average (smoothing 0.9), debiased so the first
// points aren't dragged toward zero. Drawn as the main line; the raw per-step
// loss stays behind it as a faint trace so the noise is still visible.
const SMOOTHING = 0.9;
function ema(values: number[], alpha: number): number[] {
  const out: number[] = [];
  let acc = 0;
  let norm = 0;
  for (let i = 0; i < values.length; i++) {
    acc = alpha * acc + (1 - alpha) * values[i];
    norm = alpha * norm + (1 - alpha);
    out.push(acc / norm);
  }
  return out;
}
const SMOOTH = ema(DATA.loss, SMOOTHING);

// the first steps at the new context length start near 12; cap the window so
// the rest of the phase is readable, as the main-run chart does
const Y_MIN = Math.floor((Math.min(...DATA.loss) - 0.05) * 10) / 10;
const Y_MAX = 2;

const COLOR = hardwareHue('H100');

const SPEC: ChartSpec = {
  height: 340,
  traces: [
    {
      type: 'scatter',
      mode: 'lines',
      name: 'raw',
      showlegend: false,
      x: DATA.tokens,
      y: DATA.loss,
      line: { color: COLOR, width: 1 },
      opacity: 0.28,
      hoverinfo: 'skip',
    },
    {
      type: 'scatter',
      mode: 'lines',
      name: 'H100',
      showlegend: false,
      x: DATA.tokens,
      y: SMOOTH,
      customdata: DATA.tokens.map((t, i) => [t, DATA.step[i], DATA.loss[i]]),
      line: { color: COLOR, width: 2 },
      hovertemplate:
        '<b>%{customdata[0]:.1f}B tokens</b><br><b>cluster</b>: H100<br><b>loss</b>: %{y:.3f} (smoothed)<br><b>raw</b>: %{customdata[2]:.3f}<extra></extra>',
    },
  ],
  layout: {
    showlegend: false,
    hovermode: 'x unified',
    hoverdistance: 3,
    xaxis: TOKENS_B_XAXIS,
    yaxis: { title: 'train/lm_loss', range: [Y_MIN, Y_MAX] },
    margin: { l: 60, r: 20, t: 14, b: 52 },
  },
};

export default function LongLmLossChart() {
  return (
    <div className="lm-loss">
      <PlotChart spec={SPEC} />
    </div>
  );
}
