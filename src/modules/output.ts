import { format, type Control } from './controls.ts'
import { makeId, monoPort, type SynthModule } from './synth-module.ts'

// The end of the chain: a master volume feeding the speakers.
//
// Its input is mono, so a poly cable plugged into it is summed: all the voices
// are mixed together here.

export class Output implements SynthModule<'in', never> {
  readonly id = makeId('output')
  readonly type = 'output'
  readonly title = 'Output'
  readonly inputs
  // `never` is the type with no values, so `Record<never, Port>` is an object
  // with no keys at all: this module has no outputs.
  readonly outputs = {}
  readonly controls: readonly Control[]
  private readonly master: GainNode

  constructor(ctx: BaseAudioContext, volume = 0.2) {
    this.master = new GainNode(ctx, { gain: volume }) // raw oscillators are loud
    this.master.connect(ctx.destination)
    this.inputs = { in: monoPort(this.master) }
    this.controls = [
      {
        kind: 'slider',
        id: 'volume',
        label: 'Volume',
        min: 0,
        max: 1,
        scale: 'linear',
        format: format.percent,
        get: () => this.master.gain.value,
        set: (v) => (this.master.gain.value = v),
      },
    ]
  }

  setVoices(): void {
    // Mono module: always one channel.
  }

  dispose(): void {
    this.master.disconnect()
  }
}
