import './style.css'
import { Adsr, type AdsrSettings } from './adsr.ts'

// Step 2 of the build order: VCA + ADSR.
//
// Signal chain:
//   OscillatorNode -> GainNode (VCA) -> GainNode (master volume) -> speakers
//                        ^
//                        gain driven by the ADSR envelope
//
// The oscillator runs all the time once audio has started. We never stop it:
// "playing a note" means opening the VCA, and "releasing" means closing it.

// Shared envelope settings. The sliders write into this object and the Adsr
// reads from it on every gate, so changes apply to the next note.
const settings: AdsrSettings = {
  attack: 0.01,
  decay: 0.2,
  sustain: 0.6,
  release: 0.5,
}

// Everything that only exists once audio has started, grouped in one type.
interface AudioEngine {
  ctx: AudioContext
  envelope: Adsr
}

let engine: AudioEngine | null = null

// Must be called from a user gesture (autoplay policy).
async function getEngine(): Promise<AudioEngine> {
  if (!engine) {
    const ctx = new AudioContext()
    const osc = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 220 }) // A3
    const vca = new GainNode(ctx, { gain: 0 }) // closed until the envelope opens it
    const master = new GainNode(ctx, { gain: 0.2 }) // raw oscillators are loud

    osc.connect(vca).connect(master).connect(ctx.destination)
    osc.start()

    engine = { ctx, envelope: new Adsr(vca.gain, settings) }
  }
  // A context can end up "suspended" (e.g. the tab was in the background).
  await engine.ctx.resume()
  return engine
}

// --- Gate button: hold it down to play the note ---------------------------

const gateButton = document.querySelector<HTMLButtonElement>('#gate')
if (!gateButton) throw new Error('Missing #gate button in index.html')

let gateIsOn = false

async function gateOn(): Promise<void> {
  if (gateIsOn) return
  gateIsOn = true
  gateButton?.setAttribute('aria-pressed', 'true')
  const { ctx, envelope } = await getEngine()
  // While we were awaiting, the button may already have been released (a quick
  // tap on the very first press). Starting the note now would leave it stuck on.
  if (!gateIsOn) return
  envelope.gateOn(ctx.currentTime)
}

function gateOff(): void {
  if (!gateIsOn) return
  gateIsOn = false
  gateButton?.setAttribute('aria-pressed', 'false')
  // No engine yet means the gate was released before audio even started.
  if (engine) engine.envelope.gateOff(engine.ctx.currentTime)
}

// Pointer events cover mouse, touch and pen with one API.
gateButton.addEventListener('pointerdown', (event) => {
  // Keep receiving pointer events even if the pointer slides off the button,
  // so we always get the pointerup and the note doesn't hang.
  gateButton.setPointerCapture(event.pointerId)
  void gateOn() // `void` marks that we're deliberately not awaiting the promise
})
gateButton.addEventListener('pointerup', gateOff)
gateButton.addEventListener('pointercancel', gateOff)

// Keyboard: hold Space or Enter while the button is focused.
gateButton.addEventListener('keydown', (event) => {
  if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
    event.preventDefault() // stop the browser's own "click" behavior
    void gateOn()
  }
})
gateButton.addEventListener('keyup', (event) => {
  if (event.key === ' ' || event.key === 'Enter') gateOff()
})
gateButton.addEventListener('blur', gateOff) // focus lost mid-note: release

// --- Envelope sliders -------------------------------------------------------

// `keyof AdsrSettings` is the union type 'attack' | 'decay' | 'sustain' | 'release'.
// Typing the parameter this way means bindSlider('atack') is a compile error.
function bindSlider(key: keyof AdsrSettings, format: (v: number) => string): void {
  const input = document.querySelector<HTMLInputElement>(`#${key}`)
  const output = document.querySelector<HTMLOutputElement>(`#${key}-value`)
  if (!input || !output) throw new Error(`Missing slider for "${key}"`)

  input.value = String(settings[key])
  const update = (): void => {
    settings[key] = input.valueAsNumber
    output.textContent = format(settings[key])
  }
  input.addEventListener('input', update)
  update()
}

const seconds = (v: number): string => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`)
const percent = (v: number): string => `${Math.round(v * 100)} %`

bindSlider('attack', seconds)
bindSlider('decay', seconds)
bindSlider('sustain', percent)
bindSlider('release', seconds)
