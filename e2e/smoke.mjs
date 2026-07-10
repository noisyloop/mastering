/**
 * End-to-end smoke test.
 *
 * Usage:
 *   npm run build && npm run preview &   # serve dist on :4173
 *   node e2e/smoke.mjs
 *
 * Env:
 *   BASE_URL        - app URL (default http://localhost:4173)
 *   CHROMIUM_PATH   - chromium executable (default: playwright-core discovery)
 *
 * Generates a synthetic test WAV, loads it through the full app, and
 * exercises: landing page, cache render, playback + visualizers, A/B
 * toggle, genre preset, advanced chain modules, reference matching,
 * platform presets, and the analysis panel.
 */
import { chromium } from 'playwright-core';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const BASE = process.env.BASE_URL || 'http://localhost:4173';

// --- Generate test WAVs -----------------------------------------------------

function makeWav(path, { brightness = 0.15, kickLevel = 0.8 }) {
  const sr = 44100, dur = 6, n = sr * dur;
  const ch = [new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const beat = t % 0.5;
    const kick = Math.sin(2 * Math.PI * 55 * beat) * Math.exp(-beat * 18) * kickLevel;
    const bass = Math.sin(2 * Math.PI * 110 * t) * 0.25;
    const hbeat = t % 0.25;
    const hat = (Math.random() * 2 - 1) * Math.exp(-hbeat * 60) * brightness;
    const padL = Math.sin(2 * Math.PI * 440 * t) * 0.08;
    const padR = Math.sin(2 * Math.PI * 442 * t) * 0.08;
    ch[0][i] = kick + bass + padL + hat;
    ch[1][i] = kick + bass + padR + hat * 0.8;
  }
  const bytes = 2, align = 2 * bytes, dataSize = n * align;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * align, 28);
  buf.writeUInt16LE(align, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
  let off = 44;
  for (let i = 0; i < n; i++) {
    for (const c of ch) {
      buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(c[i] * 24000))), off);
      off += 2;
    }
  }
  writeFileSync(path, buf);
}

const dir = mkdtempSync(join(tmpdir(), 'mastering-e2e-'));
const trackPath = join(dir, 'track.wav');
const refPath = join(dir, 'ref.wav');
makeWav(trackPath, { brightness: 0.15, kickLevel: 0.8 });
makeWav(refPath, { brightness: 0.45, kickLevel: 0.4 });

// --- Run --------------------------------------------------------------------

const errors = [];
let failed = false;
const check = (name, cond) => {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${name}`);
  if (!cond) failed = true;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-dev-shm-usage']
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('console', msg => {
  if (msg.type() === 'error') errors.push(msg.text());
  if (msg.text().includes('falling back to main thread')) errors.push('[worker fallback] ' + msg.text());
});
page.on('pageerror', err => errors.push(err.message));

const setToggle = (id, val) => page.evaluate(([i, v]) => {
  const el = document.getElementById(i);
  el.checked = v;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, val]);
const setSlider = (id, val) => page.evaluate(([i, v]) => {
  const el = document.getElementById(i);
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, val]);
const canvasDrawn = (id) => page.evaluate((cid) => {
  const c = document.getElementById(cid);
  if (!c) return 0;
  const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const distinct = new Set();
  for (let i = 0; i < data.length; i += 400) distinct.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  return distinct.size;
}, id);
const waitRendered = () => page.waitForFunction(() => {
  const t = document.getElementById('outputLufs').textContent;
  return /LUFS/.test(t) && !t.includes('...') && !t.includes('--');
}, null, { timeout: 90000 });
const waitModalGone = () => page.waitForFunction(
  () => document.getElementById('loadingModal').classList.contains('hidden'), null, { timeout: 90000 });

console.log('landing');
await page.goto(BASE, { waitUntil: 'networkidle' });
check('hero visible', await page.isVisible('#landingHero'));

console.log('load + render');
await page.setInputFiles('#fileInput', trackPath);
await page.waitForSelector('body.audio-loaded', { timeout: 30000 });
await page.waitForFunction(() => !document.getElementById('playBtn').disabled, null, { timeout: 60000 });
await waitRendered();
check('LUFS display shows a value', /-?\d/.test(await page.textContent('#outputLufs')));

console.log('playback + visualizers');
await page.click('#playBtn');
await page.waitForTimeout(2000);
check('spectrum drawing', await canvasDrawn('spectrumCanvas') > 5);
check('scope drawing', await canvasDrawn('scopeCanvas') > 2);
check('ghost overlay drawn', await canvasDrawn('waveformGhost') >= 2);
await page.click('#playBtn');

console.log('A/B toggle');
await page.click('#bypassBtn');
check('label flips to Original', (await page.textContent('#bypassBtn .bypass-label')) === 'Original');
await page.click('#bypassBtn');

console.log('genre preset');
await page.click('.genre-btn[data-genre="electronic"]');
await waitModalGone();
check('target LUFS set to -9', (await page.inputValue('#targetLufs')) === '-9');

console.log('advanced chain');
await setToggle('mbEnabled', true);
await setSlider('mbThreshold', '-30');
await setSlider('msSideHigh', '4');
await setSlider('transientAttack', '50');
await waitRendered();
check('render survives advanced modules', true);

console.log('reference matching');
await page.setInputFiles('#refInput', refPath);
await page.waitForSelector('.ref-file-name.loaded', { timeout: 60000 });
await setToggle('refMatchEnabled', true);
await waitRendered();
check('reference matched render completes', true);

console.log('platform preset');
await page.click('.platform-btn[data-platform="spotify"]');
await waitModalGone();
await waitRendered();
check('spotify target', (await page.inputValue('#targetLufs')) === '-14');

console.log('analysis panel');
await page.waitForFunction(() => document.getElementById('statLufs').textContent !== '--', null, { timeout: 60000 });
check('integrated stat populated', /-?\d/.test(await page.textContent('#statLufs')));
check('LUFS graph drawn', await canvasDrawn('lufsGraph') > 5);
check('feedback items present', await page.locator('.feedback-item').count() > 0);

await browser.close();

console.log(`\nconsole/page errors: ${errors.length}`);
errors.slice(0, 10).forEach(e => console.log('  ', e.slice(0, 250)));
if (errors.length || failed) {
  console.log('\nSMOKE TEST FAILED');
  process.exit(1);
}
console.log('\nSMOKE TEST PASSED');
