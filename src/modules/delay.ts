import { format, type Control } from './controls.ts'
import { DryWet } from './dry-wet.ts'
import { makeId, monoPort, type SynthModule } from './synth-module.ts'

// Delay (echo): repeats the sound after "Time", each repeat quieter than the
// last by the "Feedback" amount.
//
//   input --> DelayNode --> damping (low-pass) --+--> wet
//                ^                               |
//                +-------- feedback gain <-------+
//
// The feedback loop goes back into the DelayNode. Web Audio only allows loops
// that contain a DelayNode, which is exactly what makes echoes possible. The
// low-pass in the loop makes each repeat a little darker, like tape echo.
//
// Mono, like all the effects: a poly cable plugged in is mixed down first, so
// effects belong at the end of the chain (after the VCA).

const MAX_DELAY = 2 // seconds

export class Delay implements SynthModule<'in', 'out'> {
  readonly id = makeId('delay')
  readonly type = 'delay'
  readonly title = 'Delay'
  readonly inputs
  readonly outputs
  readonly controls: readonly Control[]

  private readonly ctx: BaseAudioContext
  private readonly mixer: DryWet
  private readonly delay: DelayNode
  private readonly damping: BiquadFilterNode
  private readonly feedback: GainNode
  private time = 0.375 // a dotted eighth at 120 BPM

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx
    this.mixer = new DryWet(ctx, 0.3)
    this.delay = new DelayNode(ctx, { maxDelayTime: MAX_DELAY, delayTime: this.time })
    this.damping = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 4000 })
    this.feedback = new GainNode(ctx, { gain: 0.4 })

    this.mixer.input.connect(this.delay)
    this.delay.connect(this.damping)
    this.damping.connect(this.feedback).connect(this.delay) // the loop
    this.damping.connect(this.mixer.wetIn)

    this.inputs = { in: monoPort(this.mixer.input) }
    this.outputs = { out: monoPort(this.mixer.output) }
    this.controls = [
      {
        kind: 'slider',
        id: 'time',
        label: 'Time',
        min: 0.01,
        max: MAX_DELAY,
        scale: 'log',
        format: format.seconds,
        get: () => this.time,
        set: (v) => {
          this.time = v
          // Glide to the new time instead of jumping, which would click.
          this.delay.delayTime.setTargetAtTime(v, this.ctx.currentTime, 0.05)
        },
      },
      {
        kind: 'slider',
        id: 'feedback',
        label: 'Feedback',
        min: 0,
        max: 0.95, // at 1 or more, the echoes would never fade (or keep growing)
        scale: 'linear',
        format: format.percent,
        get: () => this.feedback.gain.value,
        set: (v) => (this.feedback.gain.value = v),
      },
      this.mixer.control(),
    ]
  }

  setVoices(): void {
    // Mono module: always one channel.
  }

  dispose(): void {
    this.mixer.dispose()
    for (const node of [this.delay, this.damping, this.feedback]) node.disconnect()
  }
}
