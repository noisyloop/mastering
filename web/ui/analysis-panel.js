/**
 * Analysis Panel
 * Renders the offline track analysis: LUFS history graph (momentary /
 * short-term / integrated), stat tiles (LUFS, dBTP, PLR, correlation),
 * and the warnings/suggestions feedback list.
 */

let lastAnalysis = null;
let lastOptions = null;

const els = {};
function el(id) {
  if (!(id in els)) els[id] = document.getElementById(id);
  return els[id];
}

export function setAnalysisStatus(text) {
  const status = el('analysisStatus');
  if (status) status.textContent = text || '';
}

export function clearAnalysisPanel() {
  lastAnalysis = null;
  setAnalysisStatus('');
  ['statLufs', 'statPeak', 'statDr', 'statCorr'].forEach(id => {
    const e = el(id);
    if (e) e.textContent = '--';
  });
  const feedback = el('analysisFeedback');
  if (feedback) feedback.innerHTML = '';
  const canvas = el('lufsGraph');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

/**
 * Render the analysis into the panel.
 * @param {Object} analysis - Result of analyzeTrack()
 * @param {Object} options - { targetLufs, ceilingDb }
 */
export function renderAnalysisPanel(analysis, options = {}) {
  lastAnalysis = analysis;
  lastOptions = options;
  setAnalysisStatus('');

  // --- Stat tiles ---
  const fmt = (v, digits = 1) => (isFinite(v) ? v.toFixed(digits) : '--');
  const statLufs = el('statLufs');
  const statPeak = el('statPeak');
  const statDr = el('statDr');
  const statCorr = el('statCorr');
  if (statLufs) statLufs.textContent = fmt(analysis.loudness.integrated);
  if (statPeak) {
    statPeak.textContent = fmt(analysis.truePeakDb, 2);
    statPeak.classList.toggle('stat-bad', analysis.truePeakDb > -0.1);
  }
  if (statDr) {
    statDr.textContent = fmt(analysis.plr);
    statDr.classList.toggle('stat-bad', isFinite(analysis.plr) && analysis.plr < 6);
  }
  if (statCorr) {
    statCorr.textContent = fmt(analysis.correlation, 2);
    statCorr.classList.toggle('stat-bad', analysis.correlation < 0);
  }

  drawLufsGraph(analysis, options);
  renderFeedback(analysis);
}

/** Redraw with the last data (e.g. after a resize). */
export function redrawAnalysisPanel() {
  if (lastAnalysis) drawLufsGraph(lastAnalysis, lastOptions || {});
}

function drawLufsGraph(analysis, options) {
  const canvas = el('lufsGraph');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0b0b12';
  ctx.fillRect(0, 0, width, height);

  const { momentary, shortTerm, integrated } = analysis.loudness;
  const duration = analysis.duration || (momentary.length ? momentary[momentary.length - 1].t : 1);
  if (!momentary.length || duration <= 0) return;

  // Y range: adaptive, nice bounds
  const finiteVals = momentary.map(p => p.lufs).filter(isFinite);
  const dataMin = finiteVals.length ? Math.min(...finiteVals) : -40;
  const yMax = -2;
  const yMin = Math.max(-60, Math.min(-30, Math.floor((dataMin - 4) / 6) * 6));

  const pad = { l: Math.round(30 * dpr), r: Math.round(8 * dpr), t: Math.round(8 * dpr), b: Math.round(16 * dpr) };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const xOf = t => pad.l + (t / duration) * plotW;
  const yOf = lufs => {
    const clamped = Math.max(yMin, Math.min(yMax, lufs));
    return pad.t + ((yMax - clamped) / (yMax - yMin)) * plotH;
  };

  // Grid + labels
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.font = `${Math.round(9 * dpr)}px system-ui, sans-serif`;
  ctx.textAlign = 'right';
  for (let db = yMax - 4; db > yMin; db -= 6) {
    const y = yOf(db);
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(width - pad.r, y);
    ctx.stroke();
    ctx.fillText(`${db}`, pad.l - 4 * dpr, y + 3 * dpr);
  }
  // Time labels
  ctx.textAlign = 'center';
  const timeStep = duration > 240 ? 60 : duration > 60 ? 30 : 10;
  for (let t = timeStep; t < duration; t += timeStep) {
    const x = xOf(t);
    ctx.fillText(`${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`, x, height - 4 * dpr);
  }

  // Momentary: filled area
  ctx.beginPath();
  ctx.moveTo(xOf(momentary[0].t), yOf(yMin));
  for (const p of momentary) ctx.lineTo(xOf(p.t), yOf(isFinite(p.lufs) ? p.lufs : yMin));
  ctx.lineTo(xOf(momentary[momentary.length - 1].t), yOf(yMin));
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.t, 0, height - pad.b);
  grad.addColorStop(0, 'rgba(139, 127, 245, 0.55)');
  grad.addColorStop(1, 'rgba(139, 127, 245, 0.06)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Short-term: line
  if (shortTerm.length > 1) {
    ctx.beginPath();
    let first = true;
    for (const p of shortTerm) {
      if (!isFinite(p.lufs)) continue;
      const x = xOf(p.t), y = yOf(p.lufs);
      if (first) { ctx.moveTo(x, y); first = false; }
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.9)';
    ctx.lineWidth = Math.max(1, 1.4 * dpr);
    ctx.stroke();
  }

  // Integrated: dashed white line
  if (isFinite(integrated)) {
    ctx.beginPath();
    ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.moveTo(pad.l, yOf(integrated));
    ctx.lineTo(width - pad.r, yOf(integrated));
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Target: dashed green line
  if (options.targetLufs != null && isFinite(options.targetLufs)) {
    ctx.beginPath();
    ctx.setLineDash([2 * dpr, 4 * dpr]);
    ctx.moveTo(pad.l, yOf(options.targetLufs));
    ctx.lineTo(width - pad.r, yOf(options.targetLufs));
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.8)';
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

const SEVERITY_ICONS = {
  error: '✕',
  warn: '!',
  info: '→',
  ok: '✓'
};

function renderFeedback(analysis) {
  const feedback = el('analysisFeedback');
  if (!feedback) return;
  feedback.innerHTML = '';

  const items = [...(analysis.warnings || []), ...(analysis.suggestions || [])];
  for (const item of items) {
    const row = document.createElement('div');
    row.className = `feedback-item feedback-${item.severity}`;
    const icon = document.createElement('span');
    icon.className = 'feedback-icon';
    icon.textContent = SEVERITY_ICONS[item.severity] || '→';
    const text = document.createElement('span');
    text.className = 'feedback-text';
    text.textContent = item.text;
    row.appendChild(icon);
    row.appendChild(text);
    feedback.appendChild(row);
  }
}
