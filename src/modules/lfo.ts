import { format, WAVEFORMS, type Control } from './controls.ts'
import { makeId, monoPort, type SynthModule } from './synth-module.ts'

// Low-frequency oscillator: a slow wave used as a control signal (vibrato,
// filter sweeps, tremolo) rather than something you listen to directly.
//
//   OscillatorNode (swings -1..1) -> GainNode (depth) -> out (swings -depth..depth)
//
// It's mono: one LFO patched into a poly input moves every voice together.

export class Lfo implements SynthModule<never, 'out'> {
  readonly id = makeId('lfo')
  readonly type = 'lfo'
  readonly title = 'LFO'
  readonly inputs = {}
  readonly outputs
  readonly controls: readonly Control[]
  private readonly osc: OscillatorNode
  private readonly depth: GainNode

  constructor(ctx: BaseAudioContext, rate = 2, depth = 0.25) {
    this.osc = new OscillatorNode(ctx, { type: 'sine', frequency: rate })
    this.depth = new GainNode(ctx, { gain: depth })
    this.osc.connect(this.depth)
    this.osc.start()

    this.outputs = { out: monoPort(this.depth) }
    this.controls = [
      {
        kind: 'select',
        id: 'wave',
        label: 'Wave',
        options: WAVEFORMS,
        get: () => this.osc.type,
        set: (v) => (this.osc.type = v as OscillatorType),
      },
      {
        kind: 'slider',
        id: 'rate',
        label: 'Rate',
        min: 0.05,
        max: 20,
        scale: 'log',
        format: format.hz,
        get: () => this.osc.frequency.value,
        set: (v) => (this.osc.frequency.value = v),
      },
      {
        kind: 'slider',
        id: 'depth',
        label: 'Depth',
        min: 0.001,
        max: 1,
        scale: 'log', // small depths (subtle vibrato) need the most precision
        format: format.number,
        get: () => this.depth.gain.value,
        set: (v) => (this.depth.gain.value = v),
      },
    ]
  }

  setVoices(): void {
    // Mono module: always one channel. (A method may declare fewer parameters
    // than the interface; TypeScript allows it, since extra arguments are ignored.)
  }

  dispose(): void {
    this.osc.stop()
    this.osc.disconnect()
    this.depth.disconnect()
  }
}
