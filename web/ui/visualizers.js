/**
 * Real-time Visualizers Module
 * - Spectrum analyzer: log-frequency magnitude display with peak-hold trace
 * - Stereo field scope: goniometer (Lissajous) + phase correlation meter
 *
 * Both draw from the app's existing AnalyserNodes, so they show whatever the
 * meter path is hearing (full chain when FX are on, direct signal on bypass).
 */

const SPECTRUM_FLOOR_DB = -90;
const SPECTRUM_CEIL_DB = 0;
const MIN_FREQ = 20;
const MAX_FREQ = 20000;

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height };
}

// ============================================================================
// Spectrum Analyzer
// ============================================================================

export class SpectrumAnalyzer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d', { alpha: false }) : null;
    this.analyser = null;
    this.freqData = null;
    this.peakHold = null;
    this.peakDecay = 0.35; // dB per frame
    this.smoothed = null;
    this.referenceCurve = null; // optional overlay: [{freq, db}] (set by reference matching)
  }

  connect(analyser) {
    this.analyser = analyser;
    this.freqData = new Float32Array(analyser.frequencyBinCount);
    this.peakHold = new Float32Array(analyser.frequencyBinCount).fill(SPECTRUM_FLOOR_DB);
    this.smoothed = new Float32Array(analyser.frequencyBinCount).fill(SPECTRUM_FLOOR_DB);
  }

  setReferenceCurve(curve) {
    this.referenceCurve = curve;
  }

  freqToX(freq, width) {
    const logMin = Math.log10(MIN_FREQ);
    const logMax = Math.log10(MAX_FREQ);
    return ((Math.log10(freq) - logMin) / (logMax - logMin)) * width;
  }

  dbToY(db, height) {
    const clamped = Math.max(SPECTRUM_FLOOR_DB, Math.min(SPECTRUM_CEIL_DB, db));
    return ((SPECTRUM_CEIL_DB - clamped) / (SPECTRUM_CEIL_DB - SPECTRUM_FLOOR_DB)) * height;
  }

  draw() {
    if (!this.ctx || !this.analyser) return;
    const { width, height } = setupCanvas(this.canvas);
    const ctx = this.ctx;
    const sampleRate = this.analyser.context.sampleRate;
    const binCount = this.analyser.frequencyBinCount;

    this.analyser.getFloatFrequencyData(this.freqData);

    // Background
    ctx.fillStyle = '#0b0b12';
    ctx.fillRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1;
    ctx.font = `${Math.max(9, Math.round(height * 0.055))}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    const gridFreqs = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
    for (const f of gridFreqs) {
      const x = this.freqToX(f, width);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 3, height - 5);
    }
    for (let db = -12; db > SPECTRUM_FLOOR_DB; db -= 12) {
      const y = this.dbToY(db, height);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Build smoothed spectrum path
    const nyquist = sampleRate / 2;
    const smoothing = 0.55;
    const points = [];
    for (let i = 1; i < binCount; i++) {
      const freq = (i / binCount) * nyquist;
      if (freq < MIN_FREQ || freq > MAX_FREQ) continue;
      const db = this.freqData[i];
      this.smoothed[i] = this.smoothed[i] * smoothing + Math.max(SPECTRUM_FLOOR_DB, db) * (1 - smoothing);
      // Peak hold with slow decay
      if (this.smoothed[i] > this.peakHold[i]) {
        this.peakHold[i] = this.smoothed[i];
      } else {
        this.peakHold[i] -= this.peakDecay;
      }
      points.push({
        x: this.freqToX(freq, width),
        y: this.dbToY(this.smoothed[i], height),
        peakY: this.dbToY(this.peakHold[i], height)
      });
    }
    if (points.length < 2) return;

    // Filled spectrum
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(139, 127, 245, 0.85)');
    gradient.addColorStop(0.6, 'rgba(139, 127, 245, 0.35)');
    gradient.addColorStop(1, 'rgba(139, 127, 245, 0.05)');
    ctx.beginPath();
    ctx.moveTo(points[0].x, height);
    for (const p of points) ctx.lineTo(p.x, p.y);
    ctx.lineTo(points[points.length - 1].x, height);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Spectrum outline
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const p of points) ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = 'rgba(186, 178, 255, 0.9)';
    ctx.lineWidth = Math.max(1, width / 800);
    ctx.stroke();

    // Peak-hold trace
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].peakY);
    for (const p of points) ctx.lineTo(p.x, p.peakY);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Optional reference tonal curve overlay
    if (this.referenceCurve && this.referenceCurve.length > 1) {
      ctx.beginPath();
      let first = true;
      for (const pt of this.referenceCurve) {
        if (pt.freq < MIN_FREQ || pt.freq > MAX_FREQ) continue;
        const x = this.freqToX(pt.freq, width);
        const y = this.dbToY(pt.db, height);
        if (first) { ctx.moveTo(x, y); first = false; }
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.75)';
      ctx.lineWidth = Math.max(1, width / 900);
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawIdle() {
    if (!this.ctx) return;
    const { width, height } = setupCanvas(this.canvas);
    this.ctx.fillStyle = '#0b0b12';
    this.ctx.fillRect(0, 0, width, height);
    this.ctx.fillStyle = 'rgba(255,255,255,0.2)';
    this.ctx.font = `${Math.max(10, Math.round(height * 0.07))}px system-ui, sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.fillText('SPECTRUM', width / 2, height / 2);
  }
}

// ============================================================================
// Stereo Field Scope (goniometer + correlation)
// ============================================================================

export class StereoScope {
  constructor(canvasId, correlationBarId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.correlationBar = correlationBarId ? document.getElementById(correlationBarId) : null;
    this.correlationValue = document.getElementById('correlationValue');
    this.analyserL = null;
    this.analyserR = null;
    this.dataL = null;
    this.dataR = null;
    this.correlation = 1;
  }

  connect(analyserL, analyserR) {
    this.analyserL = analyserL;
    this.analyserR = analyserR;
    this.dataL = new Float32Array(analyserL.fftSize);
    this.dataR = new Float32Array(analyserR.fftSize);
  }

  draw() {
    if (!this.ctx || !this.analyserL || !this.analyserR) return;
    const { width, height } = setupCanvas(this.canvas);
    const ctx = this.ctx;

    this.analyserL.getFloatTimeDomainData(this.dataL);
    this.analyserR.getFloatTimeDomainData(this.dataR);

    // Fade previous frame for a phosphor-style trail
    ctx.fillStyle = 'rgba(11, 11, 18, 0.35)';
    ctx.fillRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const scale = Math.min(width, height) * 0.46;

    // Axes (M and S diagonals)
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - scale, cy + scale); ctx.lineTo(cx + scale, cy - scale);
    ctx.moveTo(cx - scale, cy - scale); ctx.lineTo(cx + scale, cy + scale);
    ctx.moveTo(cx, cy - scale); ctx.lineTo(cx, cy + scale);
    ctx.stroke();

    // Plot samples: x = side, y = mid (rotated 45° Lissajous)
    ctx.fillStyle = 'rgba(139, 127, 245, 0.55)';
    const n = this.dataL.length;
    const step = Math.max(1, Math.floor(n / 1024));
    let sumLR = 0, sumL2 = 0, sumR2 = 0;
    for (let i = 0; i < n; i += step) {
      const l = this.dataL[i];
      const r = this.dataR[i];
      sumLR += l * r;
      sumL2 += l * l;
      sumR2 += r * r;
      const side = (l - r) * 0.7071;
      const mid = (l + r) * 0.7071;
      const x = cx + side * scale;
      const y = cy - mid * scale;
      ctx.fillRect(x, y, 1.5, 1.5);
    }

    // Phase correlation (-1..+1), smoothed
    const denom = Math.sqrt(sumL2 * sumR2);
    const corr = denom > 1e-9 ? sumLR / denom : 1;
    this.correlation = this.correlation * 0.9 + corr * 0.1;

    if (this.correlationBar) {
      const pct = ((this.correlation + 1) / 2) * 100;
      this.correlationBar.style.left = `${Math.max(0, Math.min(100, pct))}%`;
      this.correlationBar.classList.toggle('warn', this.correlation < 0);
    }
    if (this.correlationValue) {
      this.correlationValue.textContent = this.correlation.toFixed(2);
    }
  }

  drawIdle() {
    if (!this.ctx) return;
    const { width, height } = setupCanvas(this.canvas);
    this.ctx.fillStyle = '#0b0b12';
    this.ctx.fillRect(0, 0, width, height);
    this.ctx.fillStyle = 'rgba(255,255,255,0.2)';
    this.ctx.font = `${Math.max(10, Math.round(height * 0.07))}px system-ui, sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.fillText('STEREO', width / 2, height / 2);
  }
}

// ============================================================================
// Combined controller
// ============================================================================

export class Visualizers {
  constructor() {
    this.spectrum = new SpectrumAnalyzer('spectrumCanvas');
    this.scope = new StereoScope('scopeCanvas', 'correlationIndicator');
    this.animationId = null;
    this.isPlayingFn = () => false;
  }

  connect(analyser, analyserL, analyserR) {
    if (analyser) this.spectrum.connect(analyser);
    if (analyserL && analyserR) this.scope.connect(analyserL, analyserR);
  }

  start(isPlayingFn) {
    if (isPlayingFn) this.isPlayingFn = isPlayingFn;
    if (this.animationId) return;
    const loop = () => {
      if (this.isPlayingFn()) {
        this.spectrum.draw();
        this.scope.draw();
        this.animationId = requestAnimationFrame(loop);
      } else {
        this.animationId = null;
      }
    };
    this.animationId = requestAnimationFrame(loop);
  }

  stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  drawIdle() {
    this.spectrum.drawIdle();
    this.scope.drawIdle();
  }
}

export const visualizers = new Visualizers();
