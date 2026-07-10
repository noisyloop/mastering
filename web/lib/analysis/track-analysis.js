/**
 * Track Analysis Module
 * Full offline analysis of a rendered master:
 * - LUFS timelines (momentary 400ms / short-term 3s) + integrated (gated)
 * - True peak (4x oversampled) and hard-clip detection
 * - Dynamic range (PLR / PSR)
 * - Stereo correlation
 * - Tonal balance heuristics: mud, boom, harshness, sibilance, masking,
 *   missing air/low end
 * - Actionable suggestions tied to the app's own controls
 *
 * Works on both real AudioBuffers and the worker's polyfill.
 */

import { K_WEIGHTING, LUFS_CONSTANTS } from '../dsp/constants.js';
import { applyBiquadFilter, calcHighShelfCoeffs, calcHighPassCoeffs } from '../dsp/utils.js';
import { findTruePeak } from '../dsp/true-peak.js';
import { computeTonalCurve } from '../dsp/reference-match.js';

/**
 * Build a per-sample K-weighted energy prefix sum so any window's
 * mean-square is an O(1) lookup.
 */
function buildKWeightedPrefix(buffer) {
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const numCh = buffer.numberOfChannels;

  const highShelf = calcHighShelfCoeffs(
    sampleRate, K_WEIGHTING.HIGH_SHELF_FREQ, K_WEIGHTING.HIGH_SHELF_GAIN, K_WEIGHTING.HIGH_SHELF_Q);
  const highPass = calcHighPassCoeffs(
    sampleRate, K_WEIGHTING.HIGH_PASS_FREQ, K_WEIGHTING.HIGH_PASS_Q);

  const prefix = new Float64Array(length + 1);
  for (let ch = 0; ch < numCh; ch++) {
    let filtered = applyBiquadFilter(buffer.getChannelData(ch), highShelf);
    filtered = applyBiquadFilter(filtered, highPass);
    for (let i = 0; i < length; i++) {
      prefix[i + 1] += filtered[i] * filtered[i];
    }
  }
  // Accumulate (sum over channels, per BS.1770 channel weighting = 1 for L/R)
  for (let i = 0; i < length; i++) {
    prefix[i + 1] += prefix[i];
  }
  return { prefix, numCh };
}

function windowLoudness(prefix, numCh, start, end) {
  const n = end - start;
  if (n <= 0) return -Infinity;
  const meanSquare = (prefix[end] - prefix[start]) / (n * numCh);
  if (meanSquare <= 0) return -Infinity;
  return LUFS_CONSTANTS.LOUDNESS_OFFSET + 10 * Math.log10(meanSquare);
}

/**
 * Compute LUFS timelines + gated integrated loudness.
 */
function computeLoudness(buffer) {
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const { prefix, numCh } = buildKWeightedPrefix(buffer);

  const momWindow = Math.floor(sampleRate * 0.4);
  const momHop = Math.floor(sampleRate * 0.1);
  const stWindow = Math.floor(sampleRate * 3);
  const stHop = Math.floor(sampleRate * 0.5);

  const momentary = [];
  const momentaryMeanSquares = [];
  for (let start = 0; start + momWindow <= length; start += momHop) {
    const lufs = windowLoudness(prefix, numCh, start, start + momWindow);
    momentary.push({ t: (start + momWindow / 2) / sampleRate, lufs });
    const ms = (prefix[start + momWindow] - prefix[start]) / (momWindow * numCh);
    momentaryMeanSquares.push(ms);
  }

  const shortTerm = [];
  for (let start = 0; start + stWindow <= length; start += stHop) {
    shortTerm.push({
      t: (start + stWindow / 2) / sampleRate,
      lufs: windowLoudness(prefix, numCh, start, start + stWindow)
    });
  }
  // Short tracks (< 3s): fall back to one whole-track short-term block
  if (shortTerm.length === 0 && length > 0) {
    shortTerm.push({ t: length / sampleRate / 2, lufs: windowLoudness(prefix, numCh, 0, length) });
  }

  // Integrated with BS.1770 two-stage gating over 400ms blocks
  let integrated = -Infinity;
  let gated = momentaryMeanSquares.filter(ms => ms > LUFS_CONSTANTS.ABSOLUTE_GATE_LINEAR);
  if (gated.length > 0) {
    const ungatedMean = gated.reduce((a, b) => a + b, 0) / gated.length;
    gated = gated.filter(ms => ms > ungatedMean * LUFS_CONSTANTS.RELATIVE_GATE_OFFSET);
    if (gated.length > 0) {
      const mean = gated.reduce((a, b) => a + b, 0) / gated.length;
      integrated = LUFS_CONSTANTS.LOUDNESS_OFFSET + 10 * Math.log10(mean);
    }
  }

  const maxMomentary = momentary.reduce((m, p) => Math.max(m, p.lufs), -Infinity);
  const maxShortTerm = shortTerm.reduce((m, p) => Math.max(m, p.lufs), -Infinity);

  return { momentary, shortTerm, integrated, maxMomentary, maxShortTerm };
}

/**
 * Count hard-clipped samples (consecutive runs at full scale).
 */
function detectClipping(buffer) {
  const threshold = 0.999;
  let clippedSamples = 0;
  let maxRun = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    let run = 0;
    for (let i = 0; i < data.length; i++) {
      if (Math.abs(data[i]) >= threshold) {
        run++;
        clippedSamples++;
        if (run > maxRun) maxRun = run;
      } else {
        run = 0;
      }
    }
  }
  return { clippedSamples, maxRun };
}

function overallCorrelation(buffer) {
  if (buffer.numberOfChannels < 2) return 1;
  const l = buffer.getChannelData(0);
  const r = buffer.getChannelData(1);
  let sumLR = 0, sumL2 = 0, sumR2 = 0;
  const stride = Math.max(1, Math.floor(l.length / 500000));
  for (let i = 0; i < l.length; i += stride) {
    sumLR += l[i] * r[i];
    sumL2 += l[i] * l[i];
    sumR2 += r[i] * r[i];
  }
  const denom = Math.sqrt(sumL2 * sumR2);
  return denom > 1e-12 ? sumLR / denom : 1;
}

function bandDb(bands, freq) {
  const b = bands.find(x => x.freq === freq);
  return b ? b.db : -Infinity;
}

/**
 * Tonal-balance heuristics: returns { flags, maskingPairs }
 * Band values are made relative to the track's own mean band energy first.
 */
function analyzeTonalBalance(bands) {
  const mean = bands.reduce((a, b) => a + b.db, 0) / bands.length;
  const rel = bands.map(b => ({ freq: b.freq, db: b.db - mean }));
  const get = f => bandDb(rel, f);

  const flags = [];

  // Mud: 250/400 sticking out above surrounding low end and mids
  const mud = (get(250) + get(400)) / 2 - (get(100) + get(1000)) / 2;
  if (mud > 3.5) flags.push({ key: 'mud', severity: mud > 6 ? 'warn' : 'info', value: mud });

  // Boom: 63-100 dominating both sub and low mids
  const boom = (get(63) + get(100)) / 2 - (get(40) + get(160)) / 2;
  if (boom > 5) flags.push({ key: 'boom', severity: 'info', value: boom });

  // Harshness: 2.5-4k elevated vs neighbors
  const harsh = (get(2500) + get(4000)) / 2 - (get(1000) + get(6300)) / 2;
  if (harsh > 4) flags.push({ key: 'harsh', severity: harsh > 7 ? 'warn' : 'info', value: harsh });

  // Sibilance: 6.3-10k peaks over neighbors
  const sib = (get(6300) + get(10000)) / 2 - (get(4000) + get(16000)) / 2;
  if (sib > 5) flags.push({ key: 'sibilance', severity: 'info', value: sib });

  // Missing air: top octave far below the mids
  const air = get(16000) - (get(1000) + get(2500)) / 2;
  if (air < -18) flags.push({ key: 'noAir', severity: 'info', value: air });

  // Thin low end: lows well below mids
  const lowWeight = (get(63) + get(100)) / 2 - (get(630) + get(1000)) / 2;
  if (lowWeight < -8) flags.push({ key: 'thin', severity: 'info', value: lowWeight });

  // Frequency masking: a band towering over its upper neighbor by >8dB
  // in the 63Hz-1.6kHz region (upward masking hides the band above it)
  const maskingPairs = [];
  for (let i = 0; i < rel.length - 1; i++) {
    const f = rel[i].freq;
    if (f < 63 || f > 1000) continue;
    const delta = rel[i].db - rel[i + 1].db;
    if (delta > 8) {
      maskingPairs.push({ maskerFreq: f, maskedFreq: rel[i + 1].freq, delta });
    }
  }
  // Resonant band: >7dB above the average of both neighbors
  for (let i = 1; i < rel.length - 1; i++) {
    const bump = rel[i].db - (rel[i - 1].db + rel[i + 1].db) / 2;
    if (bump > 7) {
      flags.push({ key: 'resonance', severity: 'info', value: bump, freq: rel[i].freq });
    }
  }

  return { flags, maskingPairs, relBands: rel };
}

function formatFreq(freq) {
  return freq >= 1000 ? `${(freq / 1000).toFixed(freq % 1000 ? 1 : 0)}kHz` : `${freq}Hz`;
}

/**
 * Build human-readable warnings + suggestions from the raw metrics.
 */
function buildFeedback(analysis, options) {
  const warnings = [];
  const suggestions = [];
  const { truePeakDb, clipping, loudness, correlation, tonal, plr } = analysis;
  const ceiling = options.ceilingDb ?? -1;
  const targetLufs = options.targetLufs;

  // --- Clipping / true peak ---
  if (clipping.clippedSamples > 0 && clipping.maxRun >= 3) {
    warnings.push({
      severity: 'error',
      text: `Hard clipping detected (${clipping.clippedSamples.toLocaleString()} full-scale samples). Lower the input gain or enable True Peak Limit.`
    });
  }
  if (truePeakDb > -0.1) {
    warnings.push({
      severity: 'error',
      text: `True peak hits ${truePeakDb.toFixed(2)} dBTP — lossy encoding (MP3/AAC/Ogg) will clip. Keep the ceiling at -1 dBTP for streaming.`
    });
  } else if (truePeakDb > ceiling + 0.3) {
    warnings.push({
      severity: 'warn',
      text: `True peak (${truePeakDb.toFixed(2)} dBTP) overshoots the ${ceiling} dB ceiling.`
    });
  }

  // --- Loudness vs target ---
  if (targetLufs != null && isFinite(loudness.integrated)) {
    const diff = loudness.integrated - targetLufs;
    if (Math.abs(diff) > 1) {
      suggestions.push({
        severity: 'info',
        text: `Master is ${Math.abs(diff).toFixed(1)} dB ${diff > 0 ? 'above' : 'below'} the ${targetLufs} LUFS target (measured ${loudness.integrated.toFixed(1)} LUFS).`
      });
    }
  }

  // --- Dynamics ---
  if (isFinite(plr)) {
    if (plr < 6) {
      warnings.push({
        severity: 'warn',
        text: `Very low dynamic range (PLR ${plr.toFixed(1)} dB) — the master is heavily squashed. Try a lower target loudness or gentler compression.`
      });
    } else if (plr < 8) {
      suggestions.push({
        severity: 'info',
        text: `Dynamics are tight (PLR ${plr.toFixed(1)} dB) — typical for loud club masters, but streaming normalization will turn it down.`
      });
    } else if (plr > 16) {
      suggestions.push({
        severity: 'info',
        text: `Very dynamic master (PLR ${plr.toFixed(1)} dB). If it feels inconsistent, try Glue Compression or the multiband compressor.`
      });
    }
  }

  // --- Stereo ---
  if (correlation < 0) {
    warnings.push({
      severity: 'error',
      text: `Negative phase correlation (${correlation.toFixed(2)}) — the mix may cancel in mono. Reduce Width or enable Mono Bass.`
    });
  } else if (correlation < 0.2) {
    warnings.push({
      severity: 'warn',
      text: `Low phase correlation (${correlation.toFixed(2)}). Check mono compatibility — club systems and phone speakers sum to mono.`
    });
  }

  // --- Tonal balance ---
  for (const flag of tonal.flags) {
    switch (flag.key) {
      case 'mud':
        suggestions.push({
          severity: flag.severity,
          text: `Low-mids are muddy (+${flag.value.toFixed(1)} dB around 250-400Hz). Try Cut Mud, or pull the 250Hz EQ band down 2-3 dB.`
        });
        break;
      case 'boom':
        suggestions.push({
          severity: flag.severity,
          text: `Boomy low end around 63-100Hz. A small cut at the 80Hz band or multiband compression on the Low band will tighten it.`
        });
        break;
      case 'harsh':
        suggestions.push({
          severity: flag.severity,
          text: `Harsh presence region (+${flag.value.toFixed(1)} dB around 2.5-4kHz). Enable De-harsh or dip the 4kHz EQ band.`
        });
        break;
      case 'sibilance':
        suggestions.push({
          severity: flag.severity,
          text: `Sibilant energy around 6-10kHz. De-harsh tames this range; avoid extra Add Air.`
        });
        break;
      case 'noAir':
        suggestions.push({
          severity: flag.severity,
          text: `The top octave is dark — try Add Air or a gentle 12kHz EQ boost for sparkle.`
        });
        break;
      case 'thin':
        suggestions.push({
          severity: flag.severity,
          text: `The low end is light relative to the mids. Boost the 80Hz band or check the kick/bass balance in the mix.`
        });
        break;
      case 'resonance':
        suggestions.push({
          severity: flag.severity,
          text: `Resonant build-up around ${formatFreq(flag.freq)} (+${flag.value.toFixed(1)} dB over neighbors).`
        });
        break;
    }
  }

  for (const pair of tonal.maskingPairs) {
    suggestions.push({
      severity: 'info',
      text: `Possible frequency masking: energy at ${formatFreq(pair.maskerFreq)} is ${pair.delta.toFixed(1)} dB above ${formatFreq(pair.maskedFreq)} and may be hiding it. A small cut at ${formatFreq(pair.maskerFreq)} can add clarity.`
    });
  }

  if (warnings.length === 0 && suggestions.length === 0) {
    suggestions.push({ severity: 'ok', text: 'No issues detected — the master looks balanced and streaming-ready.' });
  }

  return { warnings, suggestions };
}

/**
 * Run the full analysis on a rendered master buffer.
 *
 * @param {AudioBuffer} buffer - Rendered master (or any) audio buffer
 * @param {Object} options - { targetLufs, ceilingDb }
 * @returns {Object} Analysis result (plain serializable object)
 */
export function analyzeTrack(buffer, options = {}) {
  const loudness = computeLoudness(buffer);
  const truePeakDb = findTruePeak(buffer);
  const clipping = detectClipping(buffer);
  const correlation = overallCorrelation(buffer);
  const bands = computeTonalCurve(buffer);
  const tonal = analyzeTonalBalance(bands);

  const plr = isFinite(loudness.integrated) ? truePeakDb - loudness.integrated : Infinity;
  const psr = isFinite(loudness.maxShortTerm) ? truePeakDb - loudness.maxShortTerm : Infinity;

  const analysis = {
    loudness,
    truePeakDb,
    clipping,
    correlation,
    bands,
    tonal,
    plr,
    psr,
    duration: buffer.length / buffer.sampleRate
  };

  const feedback = buildFeedback(analysis, options);
  return { ...analysis, ...feedback };
}
