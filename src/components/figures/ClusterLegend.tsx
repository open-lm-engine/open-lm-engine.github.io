// Legend for the cluster-coloured training curves: one row per accelerator
// type, each chip count with its own shade. Swatches carry both theme colours
// as CSS variables; global.css picks the dark one under the dark theme.
import { legendGroups } from './hardwareSegments';

const GROUPS = legendGroups();

export default function ClusterLegend() {
  return (
    <div className="cluster-legend" aria-label="Training cluster colours">
      {GROUPS.map((g) => (
        <div className="group" key={g.hardware}>
          <span className="type">{g.hardware}</span>
          <span className="items">
            {g.items.map((it) => (
              <span className="item" key={it.count}>
                <i className="swatch" style={{ '--c-light': it.light, '--c-dark': it.dark } as React.CSSProperties} />×{it.count}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
