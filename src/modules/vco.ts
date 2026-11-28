import { format, WAVEFORMS, type Control } from './controls.ts'
import { makeId, times, type Input, type Output, type Port, type SynthModule } from './synth-module.ts'

// Voltage-controlled oscillator, with unison.
//
// Each voice (for polyphony) is built like this:
//
//   pitch CV -> GainNode (x1200 cents) --+--> osc 1 .detune --+
//                                        +--> osc 2 .detune --+--> GainNode (mix) -> out
//                                        +--> osc N .detune --+
//
// "Unison" = N oscillators per voice playing the same note, spread slightly
// out of tune ("Detune", total spread in cents). The beating between them
// gives the thick "supersaw" sound. With Unison at 1, it's a plain oscillator.
//
// Oscillators start when created and run until removed: an OscillatorNode can
// only be started once, so notes are shaped by a VCA instead.

export interface VcoOptions {
  type?: OscillatorType // `?` makes the property optional
  frequency?: number
}

const CENTS_PER_OCTAVE = 1200
const MAX_UNISON = 7

/** Everything one voice needs. */
interface Voice {
  pitchCv: GainNode
  oscillators: OscillatorNode[]
  mix: GainNode
}

// `implements` asks TypeScript to check that the class matches the interface.
export class Vco implements SynthModule<'pitch', 'out'> {
  readonly id = makeId('vco')
  readonly type = 'vco'
  readonly title = 'VCO'
  readonly inputs: { pitch: Port<Input> } = { pitch: { channels: [] } }
  readonly outputs: { out: Port<Output> } = { out: { channels: [] } }
  // The type annotation matters here: without it, TypeScript would infer
  // `kind: string` for the object literals below instead of `kind: 'slider'`,
  // and they wouldn't match the `Control` union.
  readonly controls: readonly Control[]

  private readonly ctx: BaseAudioContext
  private voices: Voice[] = []
  private waveform: OscillatorType
  private frequency: number
  private unison = 1
  private detune = 20 // cents, total spread

  constructor(ctx: BaseAudioContext, options: VcoOptions = {}) {
    this.ctx = ctx
    this.waveform = options.type ?? 'sawtooth'
    this.frequency = options.frequency ?? 220
    this.setVoices(1)

    this.controls = [
      {
        kind: 'select',
        id: 'wave',
        label: 'Wave',
        options: WAVEFORMS,
        get: () => this.waveform,
        set: (v) => {
          // `as` is a type assertion: "trust me, this string is an OscillatorType".
          // Safe here because the UI only offers values from WAVEFORMS.
          this.waveform = v as OscillatorType
          this.forEachOscillator((osc) => (osc.type = this.waveform))
        },
      },
      {
        kind: 'slider',
        id: 'frequency',
        label: 'Freq',
        min: 20,
        max: 2000,
        scale: 'log',
        format: format.hz,
        get: () => this.frequency,
        set: (v) => {
          this.frequency = v
          this.forEachOscillator((osc) => (osc.frequency.value = v))
        },
      },
      {
        kind: 'slider',
        id: 'unison',
        label: 'Unison',
        min: 1,
        max: MAX_UNISON,
        step: 1,
        scale: 'linear',
        format: format.integer,
        get: () => this.unison,
        set: (v) => {
          if (v === this.unison) return
          this.unison = v
          for (const voice of this.voices) this.rebuildOscillators(voice)
        },
      },
      {
        kind: 'slider',
        id: 'detune',
        label: 'Detune',
        min: 0,
        max: 100,
        scale: 'linear',
        format: format.cents,
        get: () => this.detune,
        set: (v) => {
          this.detune = v
          for (const voice of this.voices) this.applyDetune(voice)
        },
      },
    ]
  }

  setVoices(count: number): void {
    this.disposeVoices()
    this.voices = times(count, () => {
      // Pitch CV: 1.0 in = one octave up. The GainNode scales the incoming
      // signal into cents, and connecting into `detune` *adds* to it.
      const voice: Voice = {
        pitchCv: new GainNode(this.ctx, { gain: CENTS_PER_OCTAVE }),
        oscillators: [],
        mix: new GainNode(this.ctx),
      }
      this.rebuildOscillators(voice)
      return voice
    })
    this.inputs.pitch.channels = this.voices.map((v) => v.pitchCv)
    this.outputs.out.channels = this.voices.map((v) => v.mix)
  }

  dispose(): void {
    this.disposeVoices()
  }

  /** Replace a voice's oscillators with `this.unison` new ones. */
  private rebuildOscillators(voice: Voice): void {
    this.stopOscillators(voice)
    const now = this.ctx.currentTime
    voice.oscillators = times(this.unison, () => {
      const osc = new OscillatorNode(this.ctx, {
        type: this.waveform,
        frequency: this.frequency,
      })
      voice.pitchCv.connect(osc.detune)
      osc.connect(voice.mix)
      // Oscillators can't be given a starting phase, but starting each one a
      // few random milliseconds apart has the same effect. Otherwise they all
      // start in phase and the first moment sounds like a single, louder one.
      osc.start(now + Math.random() * 0.01)
      return osc
    })
    // Summing N oscillators makes the voice louder. Dividing by sqrt(N) keeps
    // the perceived volume about the same (they aren't perfectly in phase, so
    // dividing by N would overcorrect).
    voice.mix.gain.value = 1 / Math.sqrt(this.unison)
    this.applyDetune(voice)
  }

  /** Spread the oscillators evenly across the detune range, centred on 0. */
  private applyDetune(voice: Voice): void {
    const n = voice.oscillators.length
    voice.oscillators.forEach((osc, i) => {
      // n = 1: offset 0. n = 3, detune 20: offsets -10, 0, +10.
      osc.detune.value = n === 1 ? 0 : this.detune * (i / (n - 1) - 0.5)
    })
  }

  private forEachOscillator(fn: (osc: OscillatorNode) => void): void {
    for (const voice of this.voices) voice.oscillators.forEach(fn)
  }

  private stopOscillators(voice: Voice): void {
    for (const osc of voice.oscillators) {
      osc.stop()
      osc.disconnect() // unplugs the oscillator's output...
      voice.pitchCv.disconnect(osc.detune) // ...but not what's plugged *into* it
    }
  }

  private disposeVoices(): void {
    for (const voice of this.voices) {
      this.stopOscillators(voice)
      voice.pitchCv.disconnect()
      voice.mix.disconnect()
    }
    this.voices = []
  }
}
