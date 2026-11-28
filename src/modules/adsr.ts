import { format, type Control } from './controls.ts'
import { Envelope, type AdsrSettings } from './envelope.ts'
import { makeId, times, type Output, type Port, type SynthModule } from './synth-module.ts'

// ADSR envelope generator.
//
// The envelope is a control signal on the `out` port, so it can be patched
// into anything: a VCA's gain (volume envelope), a filter's cutoff (filter
// sweep), a VCO's pitch...
//
// Under the hood, each voice is a ConstantSourceNode: a node that outputs a
// constant value, set by its `offset` AudioParam. We don't write a custom node;
// an Envelope schedules automation on that `offset` param.
//
// Gates arrive per voice (gateOn(voice, ...)) from the sequencer.

export type { AdsrSettings } // re-exported so callers can import it from here

// `Readonly<T>` is a built-in *utility type*: the same shape with every property
// made readonly, so nobody can accidentally change the defaults themselves.
export const DEFAULT_ADSR: Readonly<AdsrSettings> = {
  attack: 0.01,
  decay: 0.2,
  sustain: 0.6,
  release: 0.5,
}

export class Adsr implements SynthModule<never, 'out'> {
  readonly id = makeId('adsr')
  readonly type = 'adsr'
  readonly title = 'ADSR'
  readonly inputs = {}
  readonly outputs: { out: Port<Output> } = { out: { channels: [] } }
  readonly controls: readonly Control[]
  readonly settings: AdsrSettings

  private readonly ctx: BaseAudioContext
  private sources: ConstantSourceNode[] = []
  private envelopes: Envelope[] = []

  // `Partial<AdsrSettings>` is another utility type: the same shape with every
  // property made optional, so callers only pass the settings they care about.
  constructor(ctx: BaseAudioContext, settings: Partial<AdsrSettings> = {}) {
    this.ctx = ctx
    // Object spread: start from the defaults, then overwrite with what was passed.
    this.settings = { ...DEFAULT_ADSR, ...settings }
    this.setVoices(1)

    this.controls = [
      this.timeKnob('Attack', 'attack', 2),
      this.timeKnob('Decay', 'decay', 2),
      {
        kind: 'slider',
        id: 'sustain',
        label: 'Sustain',
        min: 0,
        max: 1,
        scale: 'linear',
        format: format.percent,
        get: () => this.settings.sustain,
        set: (v) => (this.settings.sustain = v),
      },
      this.timeKnob('Release', 'release', 3),
    ]
  }

  setVoices(count: number): void {
    this.stopSources()
    this.sources = times(count, () => {
      const source = new ConstantSourceNode(this.ctx, { offset: 0 })
      source.start()
      return source
    })
    this.envelopes = this.sources.map((s) => new Envelope(s.offset, this.settings))
    this.outputs.out.channels = this.sources
  }

  /** Start voice `voice`'s envelope. Ignored if this module has fewer voices. */
  gateOn(voice: number, time: number, velocity = 1): void {
    // `?.` (optional chaining): only call gateOn if envelopes[voice] exists.
    this.envelopes[voice]?.gateOn(time, velocity)
  }

  gateOff(voice: number, time: number): void {
    this.envelopes[voice]?.gateOff(time)
  }

  dispose(): void {
    this.stopSources()
  }

  private stopSources(): void {
    for (const source of this.sources) {
      source.stop()
      source.disconnect()
    }
  }

  // `'attack' | 'decay' | 'release'` restricts `key` to the three time settings,
  // so `this.timeKnob('Sustain', 'sustain', 1)` would be a compile error.
  private timeKnob(label: string, key: 'attack' | 'decay' | 'release', max: number): Control {
    return {
      kind: 'slider',
      id: key,
      label,
      min: 0.001,
      max,
      scale: 'log',
      format: format.seconds,
      get: () => this.settings[key],
      set: (v) => (this.settings[key] = v),
    }
  }
}
