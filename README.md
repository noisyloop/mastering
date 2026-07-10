# mastering

A browser-based audio mastering studio. Drop in a track, shape it with a full mastering chain, and export a streaming-ready WAV — all DSP runs client-side in the Web Audio API. No server, no upload.

## Features

### Workflow
- **Drag-and-drop landing page** — drop a track anywhere, get a full mastering console
- **Genre presets** — one-click starting points for electronic, hip-hop, acoustic, podcast, loud, and streaming masters
- **A/B comparison** — instant Original/Master toggle with optional loudness-matched preview, plus a before/after waveform overlay
- **Lossless export** — WAV rendering (44.1/48kHz, 16/24-bit, optional noise-shaped dither) that matches the preview chain exactly

### Mastering chain
- Input gain, 5-band parametric EQ, **mid/side EQ** (3 bands each on mid and side)
- Glue compression, **4-band multiband compression** (LR4 crossovers, per-band threshold/ratio/attack/release), de-harsh dynamics
- **Transient shaping** (attack/sustain) plus a multiband punch mode
- Stereo width, mono bass, soft clipper, 4x-oversampled true-peak limiting
- **Automatic LUFS targeting** (ITU-R BS.1770-4) with platform presets: Spotify −14, Apple −16, YouTube −14, SoundCloud −14, Club −8
- **Reference matching** — load a reference track and EQ-match your master to its tonal curve

### Analysis & feedback
- Real-time **spectrum analyzer** (log-frequency, peak hold) and **stereo field scope** (goniometer + phase correlation)
- **LUFS history graph** — momentary, short-term, integrated, and target
- **Dynamic range meter** (PLR), true peak, and hard-clip detection with warnings
- **Tonal balance heuristics** — mud, boom, harshness, sibilance, resonances, and frequency-masking detection
- **Auto-suggestions** tied to the app's own controls (e.g. "low-mids are muddy — try Cut Mud or pull the 250Hz band down")
- Live spectrogram and full-chain stereo peak metering

## Development

```bash
npm install
npm run dev      # dev server
npm run build    # production build (static site in dist/)
npm run preview  # preview the production build
npm test         # unit tests (vitest)
npm run e2e      # browser smoke test (requires `npm run preview` running)
```

Deploys as a fully static site (Vercel, Cloudflare Pages, GitHub Pages, etc.).

## Tech stack

- Vite 7
- Vanilla JavaScript
- Web Audio API (preview and export processing; heavy DSP in a Web Worker)
- Pure-JS ITU-R BS.1770-4 loudness measurement
- WaveSurfer.js (waveform visualization)

See [DSP-SIGNAL-CHAIN.md](DSP-SIGNAL-CHAIN.md) for details on the DSP signal chain.

## License & attribution

ISC — see [LICENSE](LICENSE).

This project is based on [Web-Audio-Mastering](https://github.com/entrepeneur4lyf/Web-Audio-Mastering) by entrepeneur4lyf, which is in turn based on [Suno-Song-Remaster](https://github.com/SUP3RMASS1VE/Suno-Song-Remaster) by SUP3RMASS1VE, both licensed under the ISC License.
