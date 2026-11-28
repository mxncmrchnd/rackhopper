import { format, type Control } from './controls.ts'
import { makeId, times, type Input, type Output, type Port, type SynthModule } from './synth-module.ts'

// Voltage-controlled filter: one BiquadFilterNode per voice.
//
// The cutoff CV input goes through a GainNode into the filter's `detune`
// param (in cents). Working in cents means modulation is musical: +1 octave
// doubles the cutoff whether it's at 200 Hz or 5 kHz. The "Mod" control sets
// how many octaves a CV of 1.0 moves the cutoff.

const CENTS_PER_OCTAVE = 1200
const FILTER_TYPES: readonly BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass']

interface Voice {
  filter: BiquadFilterNode
  cutoffCv: GainNode
}

export class Filter implements SynthModule<'in' | 'cutoff', 'out'> {
  readonly id = makeId('vcf')
  readonly type = 'filter'
  readonly title = 'Filter'
  readonly inputs: { in: Port<Input>; cutoff: Port<Input> } = {
    in: { channels: [] },
    cutoff: { channels: [] },
  }
  readonly outputs: { out: Port<Output> } = { out: { channels: [] } }
  readonly controls: readonly Control[]

  private readonly ctx: BaseAudioContext
  private voices: Voice[] = []
  // The settings live here, not in the nodes, so rebuilt voices get them too.
  private filterType: BiquadFilterType = 'lowpass'
  private cutoff = 1200
  private resonance = 4
  private modOctaves = 2

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx
    this.setVoices(1)
    this.controls = [
      {
        kind: 'select',
        id: 'type',
        label: 'Type',
        options: FILTER_TYPES,
        get: () => this.filterType,
        set: (v) => {
          this.filterType = v as BiquadFilterType
          for (const { filter } of this.voices) filter.type = this.filterType
        },
      },
      {
        kind: 'slider',
        id: 'cutoff',
        label: 'Cutoff',
        min: 20,
        max: 20000,
        scale: 'log',
        format: format.hz,
        get: () => this.cutoff,
        set: (v) => {
          this.cutoff = v
          for (const { filter } of this.voices) filter.frequency.value = v
        },
      },
      {
        kind: 'slider',
        id: 'resonance',
        label: 'Reso',
        min: 0.1,
        max: 20,
        scale: 'log',
        format: format.number,
        get: () => this.resonance,
        set: (v) => {
          this.resonance = v
          for (const { filter } of this.voices) filter.Q.value = v
        },
      },
      {
        kind: 'slider',
        id: 'mod',
        label: 'Mod',
        min: 0,
        max: 6,
        scale: 'linear',
        format: format.octaves,
        get: () => this.modOctaves,
        set: (v) => {
          this.modOctaves = v
          for (const { cutoffCv } of this.voices) cutoffCv.gain.value = v * CENTS_PER_OCTAVE
        },
      },
    ]
  }

  setVoices(count: number): void {
    this.dispose()
    this.voices = times(count, () => {
      const filter = new BiquadFilterNode(this.ctx, {
        type: this.filterType,
        frequency: this.cutoff,
        Q: this.resonance,
      })
      const cutoffCv = new GainNode(this.ctx, { gain: this.modOctaves * CENTS_PER_OCTAVE })
      cutoffCv.connect(filter.detune)
      return { filter, cutoffCv }
    })
    this.inputs.in.channels = this.voices.map((v) => v.filter)
    this.inputs.cutoff.channels = this.voices.map((v) => v.cutoffCv)
    this.outputs.out.channels = this.voices.map((v) => v.filter)
  }

  dispose(): void {
    for (const { filter, cutoffCv } of this.voices) {
      filter.disconnect()
      cutoffCv.disconnect()
    }
  }
}
