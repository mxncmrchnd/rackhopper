import { format, type Control, type SliderControl } from './controls.ts'
import { makeId, monoPort, type SynthModule } from './synth-module.ts'

// 3-band equalizer: boost or cut the lows, mids and highs.
//
//   input --> low shelf --> mid peak --> high shelf --> out
//
// Three BiquadFilterNodes in a row, each with a `gain` in dB (+ boosts, - cuts):
//   - low shelf (below 200 Hz): raises or lowers everything under the corner,
//     like a "bass" knob
//   - peaking (around "Mid freq"): a bump or dip around one frequency
//   - high shelf (above 5 kHz): like a "treble" knob
// At 0 dB each filter lets everything through unchanged.

const MAX_GAIN = 15 // dB, either way

export class Eq implements SynthModule<'in', 'out'> {
  readonly id = makeId('eq')
  readonly type = 'eq'
  readonly title = 'EQ'
  readonly inputs
  readonly outputs
  readonly controls: readonly Control[]

  private readonly low: BiquadFilterNode
  private readonly mid: BiquadFilterNode
  private readonly high: BiquadFilterNode

  constructor(ctx: BaseAudioContext) {
    this.low = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 200, gain: 0 })
    this.mid = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 1000, Q: 0.9, gain: 0 })
    this.high = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 5000, gain: 0 })
    this.low.connect(this.mid).connect(this.high)

    this.inputs = { in: monoPort(this.low) }
    this.outputs = { out: monoPort(this.high) }
    this.controls = [
      gainKnob('low', 'Low', this.low),
      gainKnob('mid', 'Mid', this.mid),
      {
        kind: 'slider',
        id: 'midFreq',
        label: 'Mid freq',
        min: 200,
        max: 5000,
        scale: 'log',
        format: format.hz,
        get: () => this.mid.frequency.value,
        set: (v) => (this.mid.frequency.value = v),
      },
      gainKnob('high', 'High', this.high),
    ]
  }

  setVoices(): void {
    // Mono module: always one channel.
  }

  dispose(): void {
    for (const node of [this.low, this.mid, this.high]) node.disconnect()
  }
}

/** A -15..+15 dB knob for one band's gain. */
function gainKnob(id: string, label: string, filter: BiquadFilterNode): SliderControl {
  return {
    kind: 'slider',
    id,
    label,
    min: -MAX_GAIN,
    max: MAX_GAIN,
    scale: 'linear',
    bipolar: true,
    format: format.db,
    get: () => filter.gain.value,
    set: (v) => (filter.gain.value = v),
  }
}
