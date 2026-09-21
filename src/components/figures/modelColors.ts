// Baseline colours for the model comparison charts: one hue per model family
// (every Llama is orange, every SmolLM3 green, Granite purple), and within a
// family a lighter-to-darker ramp per variant, so "Llama-3.2-1B" and
// "Llama-3.2-3B-Instruct" read as siblings rather than as two unrelated
// series that happen to sit next to each other. Each colour comes with a
// dark-mode twin, which the caller registers with PlotChart's DARK map.

export type ColorPair = { light: string; dark: string };

// family → [light-mode hue, dark-mode hue]; families not listed here take
// the EXTRA hues in first-seen order
const FAMILY_HUES: Record<string, ColorPair> = {
  llama: { light: '#eb6834', dark: '#f0883e' },
  smollm: { light: '#1baf7a', dark: '#3fb950' },
  granite: { light: '#7d5ba6', dark: '#b48be0' },
  qwen: { light: '#b98a2e', dark: '#e3b341' },
  gemma: { light: '#176b64', dark: '#4fb3a7' },
};
const EXTRA_HUES: ColorPair[] = [
  { light: '#e34948', dark: '#e66767' },
  { light: '#e87ba4', dark: '#d55181' },
  { light: '#b98a2e', dark: '#e3b341' },
  { light: '#176b64', dark: '#4fb3a7' },
];

const LIGHT_PAPER = '#fffdf8';
const DARK_PAPER = '#1c1a16';

export const familyOf = (key: string) => (key.match(/^[a-z]+/i) ?? [key])[0].toLowerCase();

function mix(hex: string, target: string, amount: number): string {
  const c = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [c(hex), c(target)];
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, '0')).join('');
}

// keys → colour pair per key. Variants within a family are sorted by key and
// spread from lighter (first) to darker (last) around the family hue; a
// family with one member gets the hue itself.
export function familyShades(keys: string[]): Record<string, ColorPair> {
  const families = new Map<string, string[]>();
  for (const k of [...keys].sort()) {
    const f = familyOf(k);
    if (!families.has(f)) families.set(f, []);
    families.get(f)!.push(k);
  }
  const out: Record<string, ColorPair> = {};
  let extra = 0;
  for (const [f, members] of families) {
    const hue = FAMILY_HUES[f] ?? EXTRA_HUES[extra++ % EXTRA_HUES.length];
    const n = members.length;
    members.forEach((k, i) => {
      const t = n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0; // -1 (lightest) … 1 (darkest)
      out[k] = {
        light: t < 0 ? mix(hue.light, LIGHT_PAPER, -t * 0.4) : mix(hue.light, '#000000', t * 0.3),
        dark: t < 0 ? mix(hue.dark, '#ffffff', -t * 0.35) : mix(hue.dark, DARK_PAPER, t * 0.4),
      };
    });
  }
  return out;
}
