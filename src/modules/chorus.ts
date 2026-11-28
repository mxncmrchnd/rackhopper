import { format, type Control } from './controls.ts'
import { DryWet } from './dry-wet.ts'
import { makeId, monoPort, type SynthModule } from './synth-module.ts'

// Chorus: makes one sound like several, slightly out of time and tune.
//
// The trick is a very short delay (~15 ms) whose delay time wobbles, driven by
// a slow LFO. A delay that keeps getting longer or shorter bends the pitch up
// and down a little, and mixed with the dry sound it shimmers.
//
// Two delay lines, panned hard left and right, wobble in opposite directions
// (the LFO is fed to the right one through a gain of -1), which makes the
// chorus wide and stereo.
//
//              +--> delay L --> pan left  --+
//   input -----+                            +--> wet
//              +--> delay R --> pan right --+
//
//   LFO --> depth --+--> delay L .delayTime
//                   +--> x(-1) --> delay R .delayTime

const BASE_DELAY = 0.015 // seconds
const MAX_DEPTH = 0.005 // seconds of wobble either side, at Depth 100 %

export class Chorus implements SynthModule<'in', 'out'> {
  readonly id = makeId('chorus')
  readonly type = 'chorus'
  readonly title = 'Chorus'
  readonly inputs
  readonly outputs
  readonly controls: readonly Control[]

  private readonly mixer: DryWet
  private readonly lfo: OscillatorNode
  private readonly depth: GainNode
  private readonly nodes: AudioNode[] // everything else, for dispose()
  private depthAmount = 0.5

  constructor(ctx: BaseAudioContext) {
    this.mixer = new DryWet(ctx, 0.5)
    this.lfo = new OscillatorNode(ctx, { type: 'sine', frequency: 0.8 })
    this.depth = new GainNode(ctx, { gain: this.depthAmount * MAX_DEPTH })
    const invert = new GainNode(ctx, { gain: -1 })
    const left = new DelayNode(ctx, { maxDelayTime: 0.05, delayTime: BASE_DELAY })
    const right = new DelayNode(ctx, { maxDelayTime: 0.05, delayTime: BASE_DELAY })
    const panLeft = new StereoPannerNode(ctx, { pan: -1 })
    const panRight = new StereoPannerNode(ctx, { pan: 1 })

    this.lfo.connect(this.depth)
    this.depth.connect(left.delayTime) // adds to the 15 ms base
    this.depth.connect(invert).connect(right.delayTime)
    this.mixer.input.connect(left).connect(panLeft).connect(this.mixer.wetIn)
    this.mixer.input.connect(right).connect(panRight).connect(this.mixer.wetIn)
    this.lfo.start()
    this.nodes = [invert, left, right, panLeft, panRight]

    this.inputs = { in: monoPort(this.mixer.input) }
    this.outputs = { out: monoPort(this.mixer.output) }
    this.controls = [
      {
        kind: 'slider',
        id: 'rate',
        label: 'Rate',
        min: 0.05,
        max: 5,
        scale: 'log',
        format: format.hz,
        get: () => this.lfo.frequency.value,
        set: (v) => (this.lfo.frequency.value = v),
      },
      {
        kind: 'slider',
        id: 'depth',
        label: 'Depth',
        min: 0,
        max: 1,
        scale: 'linear',
        format: format.percent,
        get: () => this.depthAmount,
        set: (v) => {
          this.depthAmount = v
          this.depth.gain.value = v * MAX_DEPTH
        },
      },
      this.mixer.control(),
    ]
  }

  setVoices(): void {
    // Mono module: always one channel.
  }

  dispose(): void {
    this.lfo.stop()
    this.lfo.disconnect()
    this.depth.disconnect()
    this.mixer.dispose()
    for (const node of this.nodes) node.disconnect()
  }
}
