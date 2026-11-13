/* Lightweight, dependency-free DSP used entirely in the browser. */
export class SignalPipeline {
  constructor(fs = 30) { this.fs = fs; this.samples = []; }
  add(t, rgb) { this.samples.push({ t, rgb }); while (this.samples.length && t - this.samples[0].t > 32) this.samples.shift(); }
  get duration() { return this.samples.length > 1 ? this.samples.at(-1).t - this.samples[0].t : 0; }
  process() {
    if (this.duration < 10) return null;
    const { t, rgb } = this.uniform();
    const pos = this.pos(rgb);
    const pulse = zeroPhaseBandpass(pos, this.fs, .7, 3.5);
    const resp = zeroPhaseBandpass(detrend(rgb.map(x => x[1])), this.fs, .1, .4);
    return { t, pulse, resp };
  }
  uniform() {
    const start = this.samples[0].t, end = this.samples.at(-1).t, step = 1 / this.fs;
    const t = []; const rgb = []; let j = 0;
    for (let x = start; x <= end; x += step) {
      while (j < this.samples.length - 2 && this.samples[j + 1].t < x) j++;
      const a = this.samples[j], b = this.samples[j + 1], q = (x - a.t) / Math.max(b.t - a.t, 1e-6);
      t.push(x); rgb.push(a.rgb.map((v, c) => v + q * (b.rgb[c] - v)));
    }
    return { t, rgb };
  }
  pos(rgb) {
    const n = rgb.length, w = Math.round(1.6 * this.fs), out = Array(n).fill(0), weights = Array(n).fill(0);
    for (let s = 0; s + w <= n; s++) {
      const mean = [0, 1, 2].map(c => rgb.slice(s, s + w).reduce((a, v) => a + v[c], 0) / w + 1e-6);
      const s1 = [], s2 = [];
      for (let i = s; i < s + w; i++) { const x = rgb[i].map((v, c) => v / mean[c] - 1); s1.push(x[1] - x[2]); s2.push(x[1] + x[2] - 2 * x[0]); }
      const alpha = stdev(s1) / Math.max(stdev(s2), 1e-6);
      for (let i = 0; i < w; i++) { const taper = .5 - .5 * Math.cos(2 * Math.PI * i / (w - 1)); out[s + i] += (s1[i] + alpha * s2[i]) * taper; weights[s + i] += taper; }
    }
    return detrend(out.map((v, i) => v / Math.max(weights[i], 1e-5)));
  }
}

export class OcularTracker {
  constructor() { this.rows = []; this.blinks = []; this.closed = false; }
  add(t, ear) {
    const nowClosed = ear < .19;
    if (this.closed && !nowClosed) this.blinks.push(t);
    this.closed = nowClosed; this.rows.push({ t, closed: nowClosed });
    this.rows = this.rows.filter(x => t - x.t <= 60); this.blinks = this.blinks.filter(x => t - x <= 60);
    if (this.rows.length < 15) return { blink: null, perclos: null };
    const span = Math.min(60, t - this.rows[0].t);
    return { blink: span > 5 ? this.blinks.length * 60 / span : null, perclos: 100 * this.rows.filter(x => x.closed).length / this.rows.length };
  }
}

export function metrics(signals, ocular) {
  const result = { hr: null, hrv: null, rr: null, ...ocular };
  if (!signals || signals.pulse.length < 300) return result;
  const pulse = signals.pulse.slice(-300); const heart = dominantFrequency(pulse, 30, .7, 3.5, .02);
  result.hr = heart ? heart * 60 : null;
  const peaks = findPeaks(pulse, 9, stdev(pulse) * .3);
  if (peaks.length >= 3) { const ibi = peaks.slice(1).map((p, i) => (p - peaks[i]) / 30 * 1000); if (ibi.length >= 2) result.hrv = Math.sqrt(ibi.slice(1).reduce((s, v, i) => s + (v - ibi[i]) ** 2, 0) / (ibi.length - 1)); }
  if (signals.resp.length >= 600) result.rr = (dominantFrequency(signals.resp.slice(-600), 30, .1, .4, .01) || 0) * 60 || null;
  return result;
}

function detrend(x) { const n = x.length, mx = (n - 1) / 2, my = x.reduce((a, b) => a + b, 0) / n; let num = 0, den = 0; for (let i = 0; i < n; i++) { num += (i - mx) * (x[i] - my); den += (i - mx) ** 2; } const slope = num / den; return x.map((v, i) => v - (my + slope * (i - mx))); }
function stdev(x) { const m = x.reduce((a, b) => a + b, 0) / x.length; return Math.sqrt(x.reduce((a, v) => a + (v - m) ** 2, 0) / x.length); }
function zeroPhaseBandpass(x, fs, low, high) { const center = Math.sqrt(low * high), q = center / (high - low); let y = x; for (let i = 0; i < 2; i++) y = biquad(y, fs, center, q); return biquad(biquad([...y].reverse(), fs, center, q).reverse(), fs, center, q); }
function biquad(x, fs, fc, q) { const w = 2 * Math.PI * fc / fs, a = Math.sin(w) / (2 * q), c = Math.cos(w), b0 = a, b1 = 0, b2 = -a, a0 = 1 + a, a1 = -2 * c, a2 = 1 - a; let x1 = 0, x2 = 0, y1 = 0, y2 = 0; return x.map(v => { const y = (b0 / a0) * v + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; return y; }); }
function dominantFrequency(x, fs, lo, hi, step) { let best = null, max = -Infinity; for (let f = lo; f <= hi; f += step) { let re = 0, im = 0; for (let i = 0; i < x.length; i++) { const p = 2 * Math.PI * f * i / fs; re += x[i] * Math.cos(p); im += x[i] * Math.sin(p); } const power = re * re + im * im; if (power > max) { max = power; best = f; } } return best; }
function findPeaks(x, minDistance, prominence) { const found = []; let last = -minDistance; for (let i = 1; i < x.length - 1; i++) if (x[i] > x[i - 1] && x[i] >= x[i + 1] && x[i] > prominence && i - last >= minDistance) { found.push(i); last = i; } return found; }
