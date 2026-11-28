# Rackhopper

A modular synthesizer playground in the browser, built to learn TypeScript.
Users patch modules together (VCO, VCA, ADSR, LFO, filter, ...) and write melodies
in a piano roll, like a DAW. Hosted on GitHub Pages.

The name is a pun: rockhopper penguin + rack (modular/Eurorack). Logo: a rockhopper
penguin hopping along a patch cable between two jacks.

## Goals

- The owner is learning TypeScript: prefer clear, idiomatic code, explain TS
  concepts (generics, discriminated unions, etc.) when introducing them, and keep
  `"strict": true`.
- Keep it simple and avoid heavy dependencies.

## Stack

- Vite + TypeScript (`vanilla-ts` template), no UI framework to start with.
- Web Audio API directly (no Tone.js): OscillatorNode, GainNode, BiquadFilterNode,
  AudioParam automation. AudioWorklet is a possible later stretch.
- UI: Canvas 2D for the piano roll; DOM for module panels, SVG layer for patch cables.
- Prettier for formatting. ESLint and Vitest may be added later.

## Style

- Palette from the rockhopper penguin: slate blue-black darks (back plumage), white/light
  greys (belly), lemon crest yellow as the main highlight (active states, focus,
  selection), and eye red as a sparing secondary accent (recording, warnings).
  Avoid a pure black + orange combination. Colors live as CSS custom properties in
  `src/style.css` (`--bg`, `--surface`, `--border`, `--text`, `--text-muted`,
  `--accent`, `--on-accent`, `--accent-alt`); use those, don't hard-code colors.
- Dark theme by default, light theme via `prefers-color-scheme: light`.
- Font: Inter (open-source sans-serif, SIL OFL), loaded from Google Fonts in `index.html`.

## Environment

- Windows 11, VS Code, Firefox for testing/debugging, PowerShell terminal.
- Git is used manually from the terminal by the owner: do not commit or push unless asked.
- Line endings are LF (`.gitattributes`: `* text=auto eol=lf`).

## Deployment

- GitHub Pages via GitHub Actions (`.github/workflows/deploy.yml`), on push to `main`.
- `vite.config.ts` sets `base: '/rackhopper/'`. The dev server therefore serves at
  `http://localhost:5173/rackhopper/`.

## Architecture plan

- A common `SynthModule` interface (id, inputs, outputs, dispose), using
  AudioNode/AudioParam as connection points.
- The patch model is plain serializable data (modules + connections), separate from the
  live audio graph, so save/load (JSON, URL hash, localStorage) is easy.
- ADSR is not a node: it schedules AudioParam automation on a VCA's gain. Call
  `setValueAtTime` at the start of each envelope (Firefox ramp edge cases).
- Sequencer uses a look-ahead scheduler on `audioContext.currentTime`
  (not `setInterval` timing).
- Piano roll data: `{ pitch, startBeat, durationBeats, velocity }[]`, independent of drawing.
- Create/resume the `AudioContext` inside a user gesture (autoplay policy).
- OscillatorNodes can only be started once: build voices per note, or keep them running
  and gate through a VCA.

## Build order

1. One oscillator that sounds on a button click.
2. VCA + ADSR.
3. `SynthModule` interface and refactor.
4. LFO, filter, basic cable patching UI.
5. Sequencer clock, then the piano roll.
6. Save/load.

## Gotchas

- VS Code setting is `js/ts.tsdk.path` (the old `typescript.tsdk` is deprecated).
- Firefox has no `chrome://webaudio-internals`; log the patch model for debugging instead.
