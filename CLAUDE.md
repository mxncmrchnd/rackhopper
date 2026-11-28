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
- Theme: `<html data-theme="dark|light">`, set by the top-bar toggle (saved in
  localStorage, applied early by an inline script in `index.html` to avoid a flash).
  Without a choice it follows `prefers-color-scheme` (dark if none). The light palette
  is written twice in `style.css` (`[data-theme='light']` and the media query fallback):
  keep both in sync.
- Top-bar toggles are segmented controls showing both options (`src/ui/toggle.ts`):
  slider/knob icons, moon/sun icons, FR/EN text. Active side uses `--accent`.
- Text: no hard-coded UI strings. Everything goes through `src/i18n.ts` (`t('key')`,
  English + French dictionaries; the French one is type-checked to have every key).
  Static HTML uses `data-i18n` / `data-i18n-label`. Module titles, control labels and
  dropdown options are looked up by type / control id / option value
  (`module.vco`, `control.cutoff`, `option.sawtooth`). Jack labels stay untranslated.
- Layout: a top strip (`--topbar-bg`, dark in both themes because the logo is white)
  with the logo (`public/logo.png`, also the favicon) and the title; below it the page
  splits into a left panel (1/3: transport + piano roll) and a right panel (2/3: rack).
  The page fills the window and each panel scrolls on its own; stacked under 900px.
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
- ADSR is not a custom node: it schedules AudioParam automation (linear ramps). Call
  `setValueAtTime` at the start of each envelope (Firefox ramp edge cases).
  It automates the `offset` of its own `ConstantSourceNode`, which is its `out` port,
  so the envelope is a control signal patchable into any input (VCA gain, filter cutoff, ...).
- CV convention: control signals are roughly -1..1 (LFO) or 0..1 (ADSR). Each module
  scales its CV inputs into its own units with a GainNode (VCO pitch: 1.0 = 1 octave,
  into `detune`; filter cutoff: "Mod" octaves per 1.0, into `detune`).
- Modules describe their panel controls as data (`Control` discriminated union in
  `src/modules/controls.ts`); `src/ui/controls.ts` draws them as knobs or sliders
  (toggle in the top bar, remembered in localStorage), `src/ui/rack.ts` draws panels,
  cables, and handles module dragging.
- Rack: a fixed grid of equal slots (`GRID` in `src/patch.ts`); the patch model stores
  each module's `{ col, row }`. Module types are listed in `src/modules/registry.ts`
  (used by "Add module", and by save/load later). Only one Sequencer at a time.
- Polyphony (VCV-style): every port carries one channel per voice (`Port<T>.channels`).
  Poly modules build one copy of their nodes per voice in `setVoices(n)`; mono modules
  (LFO, Output) have one channel. Cable wiring (`channelPairs`): mono out -> all voices,
  poly out -> mono in sums, poly -> poly channel by channel. `Patch.setVoices` unplugs all
  cables, rebuilds, and replugs. Voice count is global (Voices menu in the transport).
- VCO unison: N detuned oscillators per voice, mixed at 1/sqrt(N).
- Save/load (`src/project.ts`): one versioned JSON format (`SavedProject`: voices,
  modules with `{ id, type, col, row, controls }`, connections, notes) for autosave
  (localStorage, every second if changed), Save/Open (.json file) and Share link
  (deflate-raw via CompressionStream + base64url in `#p=`). Control values are keyed by
  each control's stable `id`, never its `label` (labels will be translated). Loading
  validates `unknown` JSON with type guards and remaps module ids. Startup order:
  share link, then autosave, then the default patch. Bump `PROJECT_VERSION` (and
  migrate) if the format changes.
- Sequencer uses a look-ahead scheduler on `audioContext.currentTime`
  (not `setInterval` timing). It's a monophonic module with a `pitch` CV output
  (0 = A3, 1.0 = 1 octave; the VCO's 220 Hz default is the tuning reference).
  Gates are not cables: they're JS calls (`onGate`) that main.ts sends to every ADSR,
  and they must arrive in time order (the ADSR relies on it).
- Piano roll data: `{ pitch, startBeat, durationBeats, velocity }[]`, independent of drawing.
- Autoplay policy: the `AudioContext` is created at page load (it starts suspended) so the
  UI can be built right away, and resumed on the first pointerdown/keydown on the page
  (Play and the gate button also call `resume()`). There is no Power button.
- OscillatorNodes can only be started once: build voices per note, or keep them running
  and gate through a VCA.

## Build order

1. One oscillator that sounds on a button click.
2. VCA + ADSR.
3. `SynthModule` interface and refactor.
4. LFO, filter, basic cable patching UI.
5. Sequencer clock, then the piano roll.
5b. Rack grid (move/add/remove modules, knobs), VCO unison, polyphony.
6. Save/load.
7. Top-strip toggles (right side): light/dark theme (overrides `prefers-color-scheme`),
   and language (French / English) for all UI text.

## Gotchas

- VS Code setting is `js/ts.tsdk.path` (the old `typescript.tsdk` is deprecated).
- Firefox has no `chrome://webaudio-internals`; log the patch model for debugging instead.
