import { describe, it, expect } from 'vitest';
import { analyzeTrack } from './track-analysis.js';

class FakeBuffer {
  constructor(numberOfChannels, length, sampleRate) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this._ch = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(i) { return this._ch[i]; }
}

function makeTone({ freq = 1000, amp = 0.25, seconds = 6, sr = 48000, stereoInvert = false, extra = null }) {
  const buf = new FakeBuffer(2, Math.floor(sr * seconds), sr);
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  for (let i = 0; i < l.length; i++) {
    let s = Math.sin(2 * Math.PI * freq * i / sr) * amp;
    if (extra) s += extra(i / sr);
    l[i] = s;
    r[i] = stereoInvert ? -s : s;
  }
  return buf;
}

describe('analyzeTrack', () => {
  it('measures loudness timelines and integrated LUFS on a steady tone', () => {
    const buf = makeTone({ freq: 1000, amp: 0.25, seconds: 6 });
    const a = analyzeTrack(buf, { targetLufs: -14, ceilingDb: -1 });

    expect(a.loudness.momentary.length).toBeGreaterThan(40);
    expect(a.loudness.shortTerm.length).toBeGreaterThan(3);
    expect(isFinite(a.loudness.integrated)).toBe(true);
    // Steady tone: momentary ≈ integrated
    const mid = a.loudness.momentary[Math.floor(a.loudness.momentary.length / 2)];
    expect(Math.abs(mid.lufs - a.loudness.integrated)).toBeLessThan(0.5);
    // Steady sine has low PLR (crest factor ~3dB + K-weighting offset)
    expect(a.plr).toBeLessThan(8);
    expect(a.correlation).toBeGreaterThan(0.99);
  });

  it('flags hard clipping and hot true peaks', () => {
    const buf = makeTone({ freq: 220, amp: 1.4, seconds: 4 });
    // hard clip
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i] = Math.max(-1, Math.min(1, d[i]));
    }
    const a = analyzeTrack(buf, { ceilingDb: -1 });
    expect(a.clipping.clippedSamples).toBeGreaterThan(1000);
    expect(a.truePeakDb).toBeGreaterThan(-0.1);
    expect(a.warnings.some(w => w.text.includes('clipping'))).toBe(true);
    expect(a.warnings.some(w => w.text.includes('dBTP'))).toBe(true);
  });

  it('detects out-of-phase stereo', () => {
    const buf = makeTone({ freq: 440, amp: 0.3, seconds: 4, stereoInvert: true });
    const a = analyzeTrack(buf, {});
    expect(a.correlation).toBeLessThan(-0.9);
    expect(a.warnings.some(w => w.text.toLowerCase().includes('correlation'))).toBe(true);
  });

  it('suggests cutting mud when low-mids dominate', () => {
    const buf = makeTone({
      freq: 300, amp: 0.5, seconds: 6,
      extra: t => Math.sin(2 * Math.PI * 100 * t) * 0.05 +
        Math.sin(2 * Math.PI * 1000 * t) * 0.05 +
        Math.sin(2 * Math.PI * 5000 * t) * 0.03
    });
    const a = analyzeTrack(buf, {});
    expect(a.suggestions.some(s => /muddy|250/i.test(s.text))).toBe(true);
  });

  it('reports a clean result for a balanced signal', () => {
    // Pink-ish multitone at moderate level, peaks below -1dBTP
    const freqs = [50, 120, 300, 800, 2000, 5000, 12000];
    const buf = new FakeBuffer(2, 48000 * 5, 48000);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) {
        let s = 0;
        for (let k = 0; k < freqs.length; k++) {
          s += Math.sin(2 * Math.PI * freqs[k] * i / 48000 + k * 1.3) * 0.07;
        }
        d[i] = s;
      }
    }
    const a = analyzeTrack(buf, {});
    expect(a.warnings.filter(w => w.severity === 'error').length).toBe(0);
    expect(a.clipping.clippedSamples).toBe(0);
  });
});
