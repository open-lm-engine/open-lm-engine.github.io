// Data-curriculum small multiples for the Rigel post: one donut per training
// phase (h1 -> h6), computed from the `data_path` sampling weights in
// lm-engine's configs/test/mgsa-small-3x-h{1..6}.yml, grouped into 8 named
// buckets + "Other" and renormalized to 100% per phase. ("1x"/"1x-h5"/
// "3x-h5-old" are infra-only restarts of h1/h5 at different GPU topologies —
// same data mixture, not separate phases.) Do not hand-edit the numbers —
// recompute from the yamls.
//
// Every tile uses the SAME fixed category order (present categories only,
// absent ones simply omitted) rather than sorting each pie by its own value —
// that's what keeps a category's angular position (and its color) consistent
// across all six tiles, which is the whole point of small multiples. Colors
// are the dataviz-skill default categorical palette in that same fixed order;
// re-sorting per phase, or reassigning colors by rank, would have broken the
// palette's own validated adjacent-pair CVD ordering (checked directly against
// each phase's actual slice sequence — a value-sorted order failed for
// several phases where two similar hues ended up adjacent). "Other" is the
// site's own muted-ink token, not a generated 9th hue.
import PlotChart, { type ChartSpec } from '../PlotChart';

const ONE_SHOT_MODULES = import.meta.glob<{ default: HarnessResults }>('../../../results/0-shot/*.json', { eager: true });
const FIVE_SHOT_MODULES = import.meta.glob<{ default: HarnessResults }>('../../../results/5-shot/*.json', { eager: true });

type Category =
  | 'General web & reference'
  | 'Code'
  | 'Math'
  | 'Multilingual'
  | 'STEM / specialized reasoning'
  | 'Nemotron-CC-v2'
  | 'FinePDF'
  | 'Long-CoT reasoning QA'
  | 'Other';

const GRAY = '#6d6860'; // site muted-ink token — PlotChart's DARK map lightens it to #9d968a
const LINE_LIGHT = '#fffdf8';

// Fixed order = fixed angular position = fixed color, across every tile.
const CATEGORY_ORDER: Category[] = [
  'General web & reference',
  'Code',
  'Math',
  'Multilingual',
  'STEM / specialized reasoning',
  'Nemotron-CC-v2',
  'FinePDF',
  'Long-CoT reasoning QA',
  'Other',
];

const CATEGORY_COLOR: Record<Category, string> = {
  'General web & reference': '#2a78d6',
  Code: '#eb6834',
  Math: '#1baf7a',
  Multilingual: '#eda100',
  'STEM / specialized reasoning': '#e87ba4',
  'Nemotron-CC-v2': '#008300',
  FinePDF: '#4a3aa7',
  'Long-CoT reasoning QA': '#e34948',
  Other: GRAY,
};

type Phase = { key: string; title: string; note: string; shares: Partial<Record<Category, number>> };

const PHASES: Phase[] = [
  {
    key: 'h1',
    title: 'Phase 1',
    note: 'the original base-training mix',
    shares: { 'General web & reference': 71.0, Code: 20.0, Math: 7.0, Multilingual: 2.0 },
  },
  {
    key: 'h2',
    title: 'Phase 2',
    note: 'web swapped for STEM-heavy data',
    shares: { 'General web & reference': 15.0, Code: 20.0, Math: 7.0, Multilingual: 2.0, 'STEM / specialized reasoning': 56.0 },
  },
  {
    key: 'h3',
    title: 'Phase 3',
    note: 'web source swapped again, math share grows',
    shares: { 'General web & reference': 57.0, Code: 18.0, Math: 19.0, Multilingual: 6.0 },
  },
  {
    key: 'h4',
    title: 'Phase 4',
    note: 'Nemotron-CC v2 introduced; math/code balloon to 35% each',
    shares: { 'General web & reference': 2.2, Code: 35.0, Math: 35.0, Multilingual: 3.5, 'Nemotron-CC-v2': 20.0, FinePDF: 4.3 },
  },
  {
    key: 'h5',
    title: 'Phase 5',
    note: 'Nemotron-CC becomes the dominant data source',
    shares: { Code: 19.1, Math: 6.9, Multilingual: 0.8, 'STEM / specialized reasoning': 11.5, 'Nemotron-CC-v2': 45.8, FinePDF: 11.0, Other: 4.9 },
  },
  {
    key: 'h6',
    title: 'Phase 6',
    note: 'long-context stage (294,912 tokens): long-CoT QA takes over',
    shares: { Code: 11.8, Math: 4.3, Multilingual: 0.5, 'STEM / specialized reasoning': 7.1, 'Nemotron-CC-v2': 28.2, FinePDF: 6.8, 'Long-CoT reasoning QA': 33.9, Other: 7.4 },
  },
];

function phaseSpec(phase: Phase): ChartSpec {
  const present = CATEGORY_ORDER.filter((c) => phase.shares[c] != null);
  return {
    height: 260,
    traces: [
      {
        type: 'pie',
        labels: present,
        values: present.map((c) => phase.shares[c]),
        marker: {
          colors: present.map((c) => CATEGORY_COLOR[c]),
          line: { color: LINE_LIGHT, width: 2 },
        },
        textinfo: 'percent',
        texttemplate: '%{percent:.0%}',
        textposition: 'inside',
        textfont: { size: 10 },
        hovertemplate: '<b>%{label}</b><br><b>share</b>: %{percent:.0%}<extra></extra>',
        sort: false,
        direction: 'clockwise',
        hole: 0.4,
        name: phase.key,
        showlegend: false,
      },
    ],
    layout: { showlegend: false, margin: { t: 8, b: 8, l: 8, r: 8 } },
  };
}

const legendCss = `
.rigel-curriculum {
  --cat-web:      ${CATEGORY_COLOR['General web & reference']};
  --cat-code:     ${CATEGORY_COLOR['Code']};
  --cat-math:     ${CATEGORY_COLOR['Math']};
  --cat-multi:    ${CATEGORY_COLOR['Multilingual']};
  --cat-stem:     ${CATEGORY_COLOR['STEM / specialized reasoning']};
  --cat-nemo:     ${CATEGORY_COLOR['Nemotron-CC-v2']};
  --cat-finepdf:  ${CATEGORY_COLOR['FinePDF']};
  --cat-longcot:  ${CATEGORY_COLOR['Long-CoT reasoning QA']};
  --cat-other:    ${CATEGORY_COLOR['Other']};
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .rigel-curriculum {
    --cat-web: #3987e5; --cat-code: #d95926; --cat-math: #199e70;
    --cat-multi: #c98500; --cat-stem: #d55181; --cat-nemo: #008300;
    --cat-finepdf: #9085e9; --cat-longcot: #e66767; --cat-other: #9d968a;
  }
}
:root[data-theme="dark"] .rigel-curriculum {
  --cat-web: #3987e5; --cat-code: #d95926; --cat-math: #199e70;
  --cat-multi: #c98500; --cat-stem: #d55181; --cat-nemo: #008300;
  --cat-finepdf: #9085e9; --cat-longcot: #e66767; --cat-other: #9d968a;
}
.rigel-curriculum .grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px 16px;
}
@media (max-width: 640px) {
  .rigel-curriculum .grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 420px) {
  .rigel-curriculum .grid {
    grid-template-columns: 1fr;
  }
}
.rigel-curriculum .tile h4 {
  margin: 0 0 2px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.rigel-curriculum .tile p {
  margin: 0 0 6px;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.3;
  /* Notes vary a lot in length (Phase 1's is one short line, Phase 6's
     wraps to two) — without a reserved height here, tiles whose note wraps
     to fewer lines start their pie higher than the ones that wrap to more,
     so the row of pies doesn't line up. Reserve 2 lines everywhere so every
     pie starts at the same y regardless of its own note's length. */
  min-height: 2.6em;
}
.rigel-curriculum .legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin-top: 18px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.rigel-curriculum .legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--muted);
}
.rigel-curriculum .swatch {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex-shrink: 0;
}
`;

const LEGEND_ITEMS: { label: Category; varName: string }[] = [
  { label: 'General web & reference', varName: '--cat-web' },
  { label: 'Code', varName: '--cat-code' },
  { label: 'Math', varName: '--cat-math' },
  { label: 'Multilingual', varName: '--cat-multi' },
  { label: 'STEM / specialized reasoning', varName: '--cat-stem' },
  { label: 'Nemotron-CC-v2', varName: '--cat-nemo' },
  { label: 'FinePDF', varName: '--cat-finepdf' },
  { label: 'Long-CoT reasoning QA', varName: '--cat-longcot' },
  { label: 'Other', varName: '--cat-other' },
];

export function DataCurriculumCharts() {
  return (
    <div className="rigel-curriculum">
      <style>{legendCss}</style>
      <div className="grid">
        {PHASES.map((phase, i) => (
          <div className="tile" key={phase.key}>
            <h4>{phase.title}</h4>
            <p>{phase.note}</p>
            {/* staggered so the six donuts fill in one after another, h1 -> h6 */}
            <PlotChart spec={phaseSpec(phase)} sweep={{ delay: i * 160, duration: 1200 }} />
          </div>
        ))}
      </div>
      <div className="legend">
        {LEGEND_ITEMS.map((item) => (
          <div className="legend-item" key={item.label}>
            <span className="swatch" style={{ background: `var(${item.varName})` }} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Accuracy + WikiText charts, for every model whose eval-harness JSON shows
// up under results/0-shot/ or results/5-shot/ — see the import.meta.glob
// calls up top. One metric per task — acc_norm where the harness reports
// it, else plain acc — matching the metric each benchmark is conventionally
// reported with, applied identically to every model. wikitext (perplexity,
// not accuracy) and the four MMLU subject-category rows are omitted in
// favor of the single overall "mmlu" aggregate row also present in every
// JSON.
type HarnessResults = { results: Record<string, Record<string, number>> };

function harnessMetric(json: HarnessResults, task: string, metric: 'acc' | 'acc_norm' | 'bits_per_byte'): number {
  const entry = json.results[task];
  const key = `${metric},none`;
  const value = entry?.[key];
  if (typeof value !== 'number') {
    throw new Error(`Missing ${key} for task "${task}" in harness results`);
  }
  return value;
}

// "granite-4.2-8b" -> "Granite-4.2-8B": capitalize the first hyphen segment,
// and uppercase a trailing letter that follows a parameter-count number
// ("8b" -> "8B") — covers every filename seen so far without a per-model
// entry. NAME_OVERRIDE is the escape hatch for the rare case where that
// isn't the name you want (kept small on purpose — most new files need
// nothing here).
const NAME_OVERRIDE: Record<string, string> = {
  'rigel-base-long': 'Rigel-long-base',
  'smollm-3-3b': 'SmolLM3-3B',
};

export function deriveModelName(key: string): string {
  if (NAME_OVERRIDE[key]) return NAME_OVERRIDE[key];
  return key
    .split('-')
    .map((part, i) => {
      const sizeMatch = part.match(/^(\d+(?:\.\d+)?)([a-zA-Z]+)$/);
      if (sizeMatch) return `${sizeMatch[1]}${sizeMatch[2].toUpperCase()}`;
      return i === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part;
    })
    .join('-');
}

type ModelEntry = { key: string; name: string; results: HarnessResults };

function loadModels(modules: Record<string, { default: HarnessResults }>): ModelEntry[] {
  return Object.entries(modules)
    .map(([path, mod]) => {
      const key = path.split('/').pop()!.replace(/\.json$/, '');
      return { key, name: deriveModelName(key), results: mod.default };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

const ONE_SHOT_MODELS = loadModels(ONE_SHOT_MODULES);
const FIVE_SHOT_MODELS = loadModels(FIVE_SHOT_MODULES);

// Rigel's own checkpoints (any key named rigel or rigel-*) share the site's
// accent pink and always lead (in this progression order) in every chart,
// regardless of which external baselines happen to be present; baselines
// fill the remaining validated palette slots in alphabetical order, so a
// newly-dropped-in JSON gets a stable color across a session without a manual
// entry here. Palette is the dataviz-skill default categorical order
// (validated adjacent-pair-safe), minus its own pink so nothing competes with
// Rigel — PlotChart's DARK map lightens each of these for dark mode.
const RIGEL_KEY_ORDER = ['rigel-mid'];
export const RIGEL_COLOR = '#c94f7c'; // --accent (light); DARK maps it to the dark-mode accent
export const isRigel = (key: string) => key === 'rigel' || key.startsWith('rigel-');
export const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948'];
// ink / muted tokens, in their light values; PlotChart's DARK map inverts them
const INK = '#161513';
const MUTED = '#6d6860';

function orderModels(models: ModelEntry[]): ModelEntry[] {
  const rigel = RIGEL_KEY_ORDER.map((k) => models.find((m) => m.key === k)).filter((m): m is ModelEntry => !!m);
  const rest = models.filter((m) => !RIGEL_KEY_ORDER.includes(m.key)).sort((a, b) => a.key.localeCompare(b.key));
  return [...rigel, ...rest];
}

function colorsFor(models: ModelEntry[]): Record<string, string> {
  const colors: Record<string, string> = {};
  let i = 0;
  for (const m of orderModels(models)) {
    colors[m.key] = isRigel(m.key) ? RIGEL_COLOR : PALETTE[i++ % PALETTE.length];
  }
  return colors;
}

const TASK_METRICS: { task: string; metric: 'acc' | 'acc_norm' }[] = [
  // { task: 'copa', metric: 'acc' },
  { task: 'sciq', metric: 'acc_norm' },
  { task: 'piqa', metric: 'acc_norm' },
  { task: 'arc_easy', metric: 'acc_norm' },
  { task: 'boolq', metric: 'acc' },
  { task: 'hellaswag', metric: 'acc_norm' },
  { task: 'winogrande', metric: 'acc' },
  // { task: 'lambada_openai', metric: 'acc' },
  { task: 'mmlu', metric: 'acc' },
  { task: 'arc_challenge', metric: 'acc_norm' },
  { task: 'openbookqa', metric: 'acc_norm' },
  // { task: 'race', metric: 'acc' },
];

type EvalRow = { task: string; metric: 'acc' | 'acc_norm'; values: Record<string, number> };

function buildEvalRows(models: ModelEntry[]): EvalRow[] {
  return TASK_METRICS.map(({ task, metric }) => ({
    task,
    metric,
    values: Object.fromEntries(models.map((m) => [m.key, harnessMetric(m.results, task, metric)])),
  }));
}

function buildAccuracySpec(models: ModelEntry[]): ChartSpec {
  const ordered = orderModels(models);
  const colors = colorsFor(models);
  // Descending by whichever model sorts first (a Rigel checkpoint if one is
  // present, else alphabetically first baseline), left to right — the usual
  // reading order for vertical bars, keeping one fixed category order
  // across all series.
  const sortKey = ordered[0].key;
  const rows = [...buildEvalRows(models)].sort((a, b) => b.values[sortKey] - a.values[sortKey]);
  // Unweighted mean over these 12 tasks (mixing acc and acc_norm as each
  // task itself reports) — a derived summary column, appended last rather
  // than sorted in among the individual benchmarks, so it reads as a
  // distinct "Average" rather than just another task.
  const tasks = [...rows.map((r) => r.task), 'average'];
  const metrics = [...rows.map((r) => r.metric), 'mean' as const];
  return {
    height: 460,
    // Rigel's bars are solid, outlined in ink and labelled in bold accent;
    // the baselines sit back at partial opacity with muted labels, so the
    // eye lands on our model first in every group.
    traces: ordered.map(({ key, name }) => {
      const perTask = rows.map((r) => r.values[key] * 100);
      const avg = perTask.reduce((sum, v) => sum + v, 0) / perTask.length;
      const ours = isRigel(key);
      return {
        type: 'bar',
        orientation: 'v',
        name: ours ? `<b>${name}</b>` : name,
        x: tasks,
        y: [...perTask, avg],
        customdata: metrics,
        marker: {
          color: [...perTask.map(() => colors[key]), colors[key]],
          opacity: ours ? 1 : 0.6,
          line: ours ? { color: INK, width: 1.2 } : { width: 0 },
        },
        texttemplate: '%{y:.1f}',
        textposition: 'outside',
        textfont: ours ? { size: 10, color: RIGEL_COLOR, weight: 700 } : { size: 9, color: MUTED },
        cliponaxis: false,
        hovertemplate: `<b>%{x}</b><br><b>${name} %{customdata}</b>: %{y:.1f}%<extra></extra>`,
      };
    }),
    layout: {
      barmode: 'group',
      showlegend: true,
      yaxis: { title: 'Accuracy (%)', range: [0, 100] },
      xaxis: { tickangle: -40 },
      margin: { l: 50, r: 20, t: 34, b: 100 },
      shapes: [
        {
          type: 'line',
          xref: 'x',
          yref: 'paper',
          x0: tasks.length - 1.5,
          x1: tasks.length - 1.5,
          y0: 0,
          y1: 1,
          line: { color: 'rgba(160,150,130,0.4)', width: 1, dash: 'dot' },
        },
      ],
    },
  };
}

export function EvalAccuracyChart() {
  return <PlotChart spec={buildAccuracySpec(ONE_SHOT_MODELS)} sweep={{ duration: 900 }} />;
}

export function EvalAccuracy5ShotChart() {
  return <PlotChart spec={buildAccuracySpec(FIVE_SHOT_MODELS)} />;
}

// WikiText-103 bits-per-byte (lower is better) — the primary, tokenizer-
// agnostic language-modeling metric, read from the same discovered models
// as the 0-shot accuracy chart (wikitext isn't shot-count-sensitive, so
// there's no separate 5-shot version of this one).
function wikitextBpbSpec(): ChartSpec {
  const ordered = orderModels(ONE_SHOT_MODELS);
  const colors = colorsFor(ONE_SHOT_MODELS);
  const bpb = ordered.map((m) => harnessMetric(m.results, 'wikitext', 'bits_per_byte'));
  return {
    height: 380,
    traces: [
      {
        type: 'bar',
        orientation: 'v',
        x: ordered.map((m) => m.name),
        y: bpb,
        marker: {
          color: ordered.map((m) => colors[m.key]),
          opacity: ordered.map((m) => (isRigel(m.key) ? 1 : 0.6)),
          line: { color: INK, width: ordered.map((m) => (isRigel(m.key) ? 1.2 : 0)) },
        },
        texttemplate: '%{y:.3f}',
        textposition: 'outside',
        textfont: { size: 11, color: ordered.map((m) => (isRigel(m.key) ? RIGEL_COLOR : MUTED)) },
        cliponaxis: false,
        hovertemplate: '<b>%{x}</b><br><b>bits/byte</b>: %{y:.3f}<extra></extra>',
      },
    ],
    layout: {
      showlegend: false,
      yaxis: { title: 'Bits per byte (lower is better)' },
      margin: { l: 60, r: 20, t: 20, b: 40 },
    },
  };
}

export function WikitextBpbChart() {
  return <PlotChart spec={wikitextBpbSpec()} />;
}
