/**
 * Before/After Waveform Overlay
 * Draws the ORIGINAL track's peaks as a dim "ghost" behind the WaveSurfer
 * waveform (which shows the processed master), so the before/after difference
 * is always visible. Works together with the A/B (bypass) toggle.
 */

let ghostCanvas = null;
let ghostBuffer = null;
let resizeObserver = null;

/**
 * Mount the ghost canvas behind the WaveSurfer container.
 * @param {string} stackId - Id of the wrapper element (.waveform-stack)
 */
export function mountGhost(stackId = 'waveformStack') {
  const stack = document.getElementById(stackId);
  if (!stack) return;

  ghostCanvas = document.getElementById('waveformGhost');
  if (!ghostCanvas) {
    ghostCanvas = document.createElement('canvas');
    ghostCanvas.id = 'waveformGhost';
    stack.insertBefore(ghostCanvas, stack.firstChild);
  }

  if (!resizeObserver && window.ResizeObserver) {
    resizeObserver = new ResizeObserver(() => {
      if (ghostBuffer) drawGhost();
    });
    resizeObserver.observe(stack);
  }
}

/**
 * Set the buffer to display as the "before" ghost and draw it.
 * @param {AudioBuffer} buffer - Original (unprocessed) audio buffer
 */
export function setGhostBuffer(buffer) {
  ghostBuffer = buffer;
  drawGhost();
}

export function clearGhost() {
  ghostBuffer = null;
  if (ghostCanvas) {
    const ctx = ghostCanvas.getContext('2d');
    ctx.clearRect(0, 0, ghostCanvas.width, ghostCanvas.height);
  }
}

function drawGhost() {
  if (!ghostCanvas || !ghostBuffer) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = ghostCanvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  ghostCanvas.width = width;
  ghostCanvas.height = height;

  const ctx = ghostCanvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  // Min/max peaks per column from a mono mix of all channels
  const numColumns = Math.min(width, 2000);
  const colWidth = width / numColumns;
  const length = ghostBuffer.length;
  const samplesPerCol = Math.max(1, Math.floor(length / numColumns));
  const channels = [];
  for (let ch = 0; ch < ghostBuffer.numberOfChannels; ch++) {
    channels.push(ghostBuffer.getChannelData(ch));
  }
  const numCh = channels.length;
  const mid = height / 2;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
  for (let col = 0; col < numColumns; col++) {
    const start = col * samplesPerCol;
    const end = Math.min(start + samplesPerCol, length);
    let min = 0, max = 0;
    // Stride through the window for speed on long files
    const stride = Math.max(1, Math.floor((end - start) / 64));
    for (let i = start; i < end; i += stride) {
      let s = 0;
      for (let ch = 0; ch < numCh; ch++) s += channels[ch][i];
      s /= numCh;
      if (s > max) max = s;
      if (s < min) min = s;
    }
    const y1 = mid - max * mid;
    const y2 = mid - min * mid;
    ctx.fillRect(col * colWidth, y1, Math.max(1, colWidth), Math.max(1, y2 - y1));
  }
}
