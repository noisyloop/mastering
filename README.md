# mastering

A browser-based audio mastering suite. Drop in a track, shape it with a full mastering chain, and export a streaming-ready WAV — all DSP runs client-side in the Web Audio API. No server, no upload.

## Features

- **Full mastering chain** — input gain, parametric EQ, glue compression, de-harsh dynamics, soft clipper, true-peak limiting
- **Loudness tools** — ITU-R BS.1770-4 LUFS measurement and normalization
- **Stereo tools** — stereo width, mono bass for club/speaker compatibility
- **Analysis** — real-time spectrogram, full-chain peak metering, DC offset detection
- **A/B comparison** — instant FX bypass with optional loudness-matched comparison
- **Lossless export** — high-quality WAV rendering that matches the preview chain

## Development

```bash
npm install
npm run dev      # dev server
npm run build    # production build (static site in dist/)
npm run preview  # preview the production build
npm test         # run tests
```

Deploys as a fully static site (Vercel, Cloudflare Pages, GitHub Pages, etc.).

## Tech stack

- Vite 7
- Vanilla JavaScript
- Web Audio API (preview and export processing)
- WaveSurfer.js (waveform visualization)

See [DSP-SIGNAL-CHAIN.md](DSP-SIGNAL-CHAIN.md) for details on the DSP signal chain.

## License & attribution

ISC — see [LICENSE](LICENSE).

This project is based on [Web-Audio-Mastering](https://github.com/entrepeneur4lyf/Web-Audio-Mastering) by entrepeneur4lyf, which is in turn based on [Suno-Song-Remaster](https://github.com/SUP3RMASS1VE/Suno-Song-Remaster) by SUP3RMASS1VE, both licensed under the ISC License.
