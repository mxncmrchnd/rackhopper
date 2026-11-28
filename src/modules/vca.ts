import { format, type Control } from './controls.ts'
import { makeId, times, type Input, type Output, type Port, type SynthModule } from './synth-module.ts'

// Voltage-controlled amplifier: one GainNode per voice.
//
// The "Level" control is the base gain and starts at 0 (closed). A signal
// patched into the `gain` input is *added* to it, so with an ADSR patched in
// the VCA opens and closes with the envelope. Turn Level up for a drone.

export class Vca implements SynthModule<'in' | 'gain', 'out'> {
  readonly id = makeId('vca')
  readonly type = 'vca'
  readonly title = 'VCA'
  readonly inputs: { in: Port<Input>; gain: Port<Input> } = {
    in: { channels: [] },
    gain: { channels: [] },
  }
  readonly outputs: { out: Port<Output> } = { out: { channels: [] } }
  readonly controls: readonly Control[]

  private readonly ctx: BaseAudioContext
  private nodes: GainNode[] = []
  private level: number

  constructor(ctx: BaseAudioContext, level = 0) {
    this.ctx = ctx
    this.level = level
    this.setVoices(1)
    this.controls = [
      {
        kind: 'slider',
        id: 'level',
        label: 'Level',
        min: 0,
        max: 1,
        scale: 'linear',
        format: format.percent,
        get: () => this.level,
        set: (v) => {
          this.level = v
          for (const node of this.nodes) node.gain.value = v
        },
      },
    ]
  }

  setVoices(count: number): void {
    this.dispose()
    this.nodes = times(count, () => new GainNode(this.ctx, { gain: this.level }))
    // The same GainNode is both the audio input and the output.
    this.inputs.in.channels = this.nodes
    this.inputs.gain.channels = this.nodes.map((n) => n.gain)
    this.outputs.out.channels = this.nodes
  }

  dispose(): void {
    for (const node of this.nodes) node.disconnect()
  }
}
