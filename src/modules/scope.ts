import { format, type Control } from './controls.ts'
import { makeId, monoPort, type SynthModule } from './synth-module.ts'

// Oscilloscope: draws whatever is plugged into it, to see a signal's shape and
// level. Audio (a VCO), control signals (ADSR, LFO, the sequencer's pitch), or
// the result of an effect: any output can be plugged in.
//
//   in --> GainNode --+--> thru (pass the signal on, to use it inline)
//                     +--> AnalyserNode --> silent gain --> speakers
//
// An AnalyserNode keeps the most recent samples, which the screen reads on
// every animation frame. Its output goes to the speakers through a gain of 0:
// silent, but it guarantees the browser keeps processing the analyser (an
// unconnected node may be skipped).
//
// Mono: a poly cable is summed, so the screen shows all voices mixed.

const BUFFER = 8192 // samples kept: ~170 ms at 48 kHz, enough for a 50 ms window plus a trigger search

export class Scope implements SynthModule<'in', 'thru'> {
  readonly id = makeId('scope')
  readonly type = 'scope'
  readonly title = 'Scope'
  readonly inputs
  readonly outputs
  readonly controls: readonly Control[]

  private readonly input: GainNode
  private readonly analyser: AnalyserNode
  private readonly sink: GainNode
  private readonly buffer: Float32Array<ArrayBuffer>
  private windowSeconds = 0.01
  private range = 1

  constructor(ctx: BaseAudioContext) {
    this.input = new GainNode(ctx)
    this.analyser = new AnalyserNode(ctx, { fftSize: BUFFER })
    this.sink = new GainNode(ctx, { gain: 0 })
    this.input.connect(this.analyser).connect(this.sink).connect(ctx.destination)
    this.buffer = new Float32Array(this.analyser.fftSize)

    this.inputs = { in: monoPort(this.input) }
    this.outputs = { thru: monoPort(this.input) }
    this.controls = [
      {
        kind: 'scope',
        id: 'display',
        label: 'Display',
        sampleRate: ctx.sampleRate,
        samples: () => {
          // Copies the analyser's latest samples into our buffer (no allocation per frame).
          this.analyser.getFloatTimeDomainData(this.buffer)
          return this.buffer
        },
        window: () => this.windowSeconds,
        range: () => this.range,
      },
      {
        kind: 'slider',
        id: 'time',
        label: 'Time',
        min: 0.001,
        max: 0.05,
        scale: 'log',
        format: format.seconds,
        get: () => this.windowSeconds,
        set: (v) => (this.windowSeconds = v),
      },
      {
        kind: 'slider',
        id: 'range',
        label: 'Range',
        min: 0.05,
        max: 5,
        scale: 'log',
        format: format.number,
        get: () => this.range,
        set: (v) => (this.range = v),
      },
    ]
  }

  setVoices(): void {
    // Mono module: always one channel.
  }

  dispose(): void {
    for (const node of [this.input, this.analyser, this.sink]) node.disconnect()
  }
}
