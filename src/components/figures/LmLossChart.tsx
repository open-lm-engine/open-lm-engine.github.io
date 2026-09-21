// Interactive training-loss curve for the Rigel post, read from
// results/lm-loss.json (a compacted W&B export of train/lm_loss vs tokens —
// every logged point, nothing downsampled or smoothed). Coloured piecewise
// by the cluster each stretch of the run was trained on (see
// hardwareSegments.ts); hover reports tokens, step, cluster and loss through
// PlotChart's card.
import PlotChart, { type ChartSpec } from '../PlotChart';
import { piecewiseTraces, SEGMENT_BOUNDARY_SHAPES, TOKENS_XAXIS } from './hardwareSegments';
import ClusterLegend from './ClusterLegend';
import lmLoss from '../../../results/lm-loss.json';

const DATA = lmLoss as { tokens: number[]; loss: number[]; step: number[] };

// y window: bottom just under the run's minimum, top capped at 3 — clips the
// warmup spike (loss starts near 25) so the rest of the run is readable
const Y_MIN = Math.floor((Math.min(...DATA.loss) - 0.05) * 10) / 10;
const Y_MAX = 3;

const SPEC: ChartSpec = {
  height: 400,
  traces: piecewiseTraces({
    tokens: DATA.tokens,
    values: DATA.loss,
    customdata: (i) => [DATA.tokens[i], DATA.step[i]],
    hovertemplate: (label) =>
      `<b>%{customdata[0]:.3f}T tokens</b><br><b>cluster</b>: ${label}<br><b>step</b>: %{customdata[1]}<br><b>loss</b>: %{y:.3f}<extra></extra>`,
    width: 1.5,
  }),
  layout: {
    showlegend: false,
    hovermode: 'x unified',
    // x-hover includes every trace with a point within hoverdistance px;
    // keep the candidate set small (PlotChart then keeps only the point
    // nearest the pointer, so a neighbouring segment's endpoint never shows)
    hoverdistance: 3,
    xaxis: TOKENS_XAXIS,
    yaxis: { title: 'train/lm_loss', range: [Y_MIN, Y_MAX] },
    shapes: SEGMENT_BOUNDARY_SHAPES,
    margin: { l: 60, r: 20, t: 14, b: 52 },
  },
};

export default function LmLossChart() {
  return (
    <div className="lm-loss">
      <PlotChart spec={SPEC} />
      <ClusterLegend />
    </div>
  );
}
