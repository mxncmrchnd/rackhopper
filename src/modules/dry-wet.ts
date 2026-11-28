import { format, type Control } from './controls.ts'

// The dry/wet mixer shared by the effect modules.
//
//   input --+----------------- dry gain --+--> output
//           |                             |
//           +--> (the effect) --> wetIn --+-- wet gain
//
// The effect reads from `input` and writes into `wetIn`; this class does the
// rest. "Mix" crossfades from all dry (0) to all wet (1) along an equal-power
// curve (cos/sin), so the loudness stays even in the middle instead of dipping.

export class DryWet {
  readonly input: GainNode
  readonly output: GainNode
  /** Where the effect's processed signal goes in. */
  readonly wetIn: GainNode
  private readonly dry: GainNode
  private amount: number

  constructor(ctx: BaseAudioContext, mix: number) {
    this.input = new GainNode(ctx)
    this.output = new GainNode(ctx)
    this.dry = new GainNode(ctx)
    this.wetIn = new GainNode(ctx)
    this.input.connect(this.dry).connect(this.output)
    this.wetIn.connect(this.output)
    this.amount = mix
    this.apply()
  }

  /** The "Mix" knob, the same on every effect. */
  control(): Control {
    return {
      kind: 'slider',
      id: 'mix',
      label: 'Mix',
      min: 0,
      max: 1,
      scale: 'linear',
      format: format.percent,
      get: () => this.amount,
      set: (v) => {
        this.amount = v
        this.apply()
      },
    }
  }

  dispose(): void {
    for (const node of [this.input, this.output, this.dry, this.wetIn]) node.disconnect()
  }

  private apply(): void {
    const angle = (this.amount * Math.PI) / 2
    this.dry.gain.value = Math.cos(angle)
    this.wetIn.gain.value = Math.sin(angle)
  }
}
