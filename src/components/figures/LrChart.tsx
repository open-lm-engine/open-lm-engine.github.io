// Interactive learning-rate schedule for the Rigel post, read from
// results/lr.json (compacted W&B export of train/learning_rate vs tokens,
// every logged point). Coloured piecewise by training cluster like the loss
// curve; hover reports tokens, cluster and the learning rate.
import PlotChart, { type ChartSpec } from '../PlotChart';
import { piecewiseTraces, SEGMENT_BOUNDARY_SHAPES, TOKENS_XAXIS } from './hardwareSegments';
import ClusterLegend from './ClusterLegend';
import lr from '../../../results/lr.json';

const DATA = lr as { tokens: number[]; lr: number[]; step: number[] };

const SPEC: ChartSpec = {
  height: 360,
  traces: piecewiseTraces({
    tokens: DATA.tokens,
    values: DATA.lr,
    // pre-formatted so the hover card shows 4.34e-6 rather than a long decimal
    customdata: (i) => [DATA.tokens[i], DATA.step[i], DATA.lr[i].toExponential(2)],
    hovertemplate: (label) =>
      `<b>%{customdata[0]:.3f}T tokens</b><br><b>cluster</b>: ${label}<br><b>learning rate</b>: %{customdata[2]}<extra></extra>`,
    width: 2,
  }),
  layout: {
    showlegend: false,
    hovermode: 'x unified',
    hoverdistance: 3,
    xaxis: TOKENS_XAXIS,
    yaxis: { title: 'learning rate' },
    shapes: SEGMENT_BOUNDARY_SHAPES,
    margin: { l: 64, r: 20, t: 14, b: 52 },
  },
};

export default function LrChart() {
  return (
    <div className="lm-loss">
      <PlotChart spec={SPEC} />
      <ClusterLegend />
    </div>
  );
}
