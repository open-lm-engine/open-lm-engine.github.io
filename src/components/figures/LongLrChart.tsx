// Learning-rate schedule of the long-context extension phase, read from
// results/long-lr.json (compacted W&B export of train/learning_rate vs
// tokens, every logged step). A 250-step linear warm-up to 5e-5 followed by a
// linear decay to zero; single H100 trace, like the long-context loss curve.
import PlotChart, { type ChartSpec } from '../PlotChart';
import { hardwareHue, TOKENS_B_XAXIS } from './hardwareSegments';
import data from '../../../results/long-lr.json';

const DATA = data as { tokens: number[]; lr: number[]; step: number[] };

const SPEC: ChartSpec = {
  height: 300,
  traces: [
    {
      type: 'scatter',
      mode: 'lines',
      name: 'H100',
      showlegend: false,
      x: DATA.tokens,
      y: DATA.lr,
      customdata: DATA.tokens.map((t, i) => [t, DATA.step[i], DATA.lr[i].toExponential(2)]),
      line: { color: hardwareHue('H100'), width: 2 },
      hovertemplate:
        '<b>%{customdata[0]:.1f}B tokens</b><br><b>cluster</b>: H100<br><b>learning rate</b>: %{customdata[2]}<extra></extra>',
    },
  ],
  layout: {
    showlegend: false,
    hovermode: 'x unified',
    hoverdistance: 3,
    xaxis: TOKENS_B_XAXIS,
    yaxis: { title: 'learning rate', exponentformat: 'e' },
    margin: { l: 64, r: 20, t: 14, b: 52 },
  },
};

export default function LongLrChart() {
  return (
    <div className="lm-loss">
      <PlotChart spec={SPEC} />
    </div>
  );
}
