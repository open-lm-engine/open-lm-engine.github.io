import { useEffect, useMemo, useRef, useState } from 'react';

const T = 80;

function simulate(gamma: number, sigmaW: number, trials: number) {
  // one sample path (for visual texture) plus the running cross-trial mean
  const sample = new Float64Array(T);
  const meanAcc = new Float64Array(T);

  for (let trial = 0; trial < trials; trial++) {
    const wk = sigmaW * gaussian();
    const wv = sigmaW * gaussian();
    let h = 0;
    for (let t = 0; t < T; t++) {
      const x = gaussian();
      const k = wk * x;
      const v = wv * x;
      h = gamma * h + k * v;
      meanAcc[t] += h;
      if (trial === 0) sample[t] = h;
    }
  }
  const mean = Float64Array.from(meanAcc, (v) => v / trials);
  return { sample, mean };
}

function gaussian() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function cssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export default function RecurrenceSimulator() {
  const [gamma, setGamma] = useState(0.9);
  const [sigmaW, setSigmaW] = useState(1);
  const [trials, setTrials] = useState(300);
  const [seed, setSeed] = useState(0);
  const [themeTick, setThemeTick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { sample, mean } = useMemo(
    () => simulate(gamma, sigmaW, trials),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gamma, sigmaW, trials, seed]
  );

  useEffect(() => {
    const onThemeChange = () => setThemeTick((t) => t + 1);
    window.addEventListener('themechange', onThemeChange);
    return () => window.removeEventListener('themechange', onThemeChange);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const line = cssVar('--line', '#d8d0c4');
    const accent = cssVar('--accent', '#176b64');
    const accentStrong = cssVar('--accent-strong', '#a33e2d');

    const all = [...sample, ...mean];
    const bound = Math.max(0.5, ...all.map((v) => Math.abs(v)));
    const pad = 28;
    const toX = (t: number) => pad + (t / (T - 1)) * (width - pad * 2);
    const toY = (v: number) => height / 2 - (v / bound) * (height / 2 - pad / 2);

    // zero line
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, toY(0));
    ctx.lineTo(width - pad, toY(0));
    ctx.stroke();

    const drawLine = (data: Float64Array, color: string, lineWidth: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      data.forEach((v, t) => {
        const x = toX(t);
        const y = toY(v);
        if (t === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };

    ctx.globalAlpha = 0.55;
    drawLine(sample, accentStrong, 1.5);
    ctx.globalAlpha = 1;
    drawLine(mean, accent, 2.25);
  }, [sample, mean, themeTick]);

  return (
    <div className="recurrence-sim">
      <canvas ref={canvasRef} className="recurrence-sim-canvas" />
      <div className="recurrence-sim-legend">
        <span><i style={{ background: 'var(--accent)' }} /> mean of H<sub>t</sub> across trials</span>
        <span><i style={{ background: 'var(--accent-strong)' }} /> one sample path</span>
      </div>
      <div className="recurrence-sim-controls">
        <label>
          &gamma; (decay) = {gamma.toFixed(2)}
          <input
            type="range"
            min={0}
            max={0.99}
            step={0.01}
            value={gamma}
            onChange={(e) => setGamma(Number(e.target.value))}
          />
        </label>
        <label>
          &sigma;<sub>w</sub> (weight scale) = {sigmaW.toFixed(2)}
          <input
            type="range"
            min={0.1}
            max={2}
            step={0.05}
            value={sigmaW}
            onChange={(e) => setSigmaW(Number(e.target.value))}
          />
        </label>
        <label>
          trials = {trials}
          <input
            type="range"
            min={10}
            max={1000}
            step={10}
            value={trials}
            onChange={(e) => setTrials(Number(e.target.value))}
          />
        </label>
        <button type="button" onClick={() => setSeed((s) => s + 1)}>
          resample
        </button>
      </div>
    </div>
  );
}
