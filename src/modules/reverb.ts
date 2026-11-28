import { format, type Control } from './controls.ts'
import { DryWet } from './dry-wet.ts'
import { makeId, monoPort, type SynthModule } from './synth-module.ts'

// Reverb: the sound of a room, made with a ConvolverNode.
//
// A convolver plays every input sample through an "impulse response": a
// recording of how a space answers a single click. We don't ship a recording;
// we generate one: random noise that fades out exponentially. That's a fair
// imitation of a room's dense, decaying reflections, and it's stereo (a
// different noise per channel) so the reverb sounds wide.
//
//   input --> ConvolverNode --> tone (low-pass) --> wet
//
// "Size" is the decay time (how long until the tail is ~60 dB quieter).
// "Tone" darkens the tail, like a room with soft surfaces.

const MIN_SIZE = 0.3
const MAX_SIZE = 6

export class Reverb implements SynthModule<'in', 'out'> {
  readonly id = makeId('reverb')
  readonly type = 'reverb'
  readonly title = 'Reverb'
  readonly inputs
  readonly outputs
  readonly controls: readonly Control[]

  private readonly ctx: BaseAudioContext
  private readonly mixer: DryWet
  private readonly tone: BiquadFilterNode
  private convolver: ConvolverNode
  private size = 2.5
  // `number | undefined`: a pending rebuild, see setSize.
  private rebuildTimer: number | undefined

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx
    this.mixer = new DryWet(ctx, 0.25)
    this.tone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 6000 })
    this.convolver = this.makeConvolver()
    this.tone.connect(this.mixer.wetIn)

    this.inputs = { in: monoPort(this.mixer.input) }
    this.outputs = { out: monoPort(this.mixer.output) }
    this.controls = [
      {
        kind: 'slider',
        id: 'size',
        label: 'Size',
        min: MIN_SIZE,
        max: MAX_SIZE,
        scale: 'log',
        format: format.seconds,
        get: () => this.size,
        set: (v) => this.setSize(v),
      },
      {
        kind: 'slider',
        id: 'tone',
        label: 'Tone',
        min: 500,
        max: 16000,
        scale: 'log',
        format: format.hz,
        get: () => this.tone.frequency.value,
        set: (v) => (this.tone.frequency.value = v),
      },
      this.mixer.control(),
    ]
  }

  setVoices(): void {
    // Mono module: always one channel.
  }

  dispose(): void {
    window.clearTimeout(this.rebuildTimer)
    this.mixer.dispose()
    this.convolver.disconnect()
    this.tone.disconnect()
  }

  private setSize(size: number): void {
    this.size = size
    // Generating a new impulse response takes a few milliseconds, too slow to
    // redo on every pixel of a knob drag. So wait until the knob has been still
    // for 150 ms ("debouncing"): each new move cancels the previous timer.
    window.clearTimeout(this.rebuildTimer)
    this.rebuildTimer = window.setTimeout(() => {
      // Swap in a new convolver rather than changing the old one's buffer:
      // simple, and the old tail is cut off cleanly.
      const old = this.convolver
      this.convolver = this.makeConvolver()
      this.mixer.input.disconnect(old)
      old.disconnect()
    }, 150)
  }

  /** A ConvolverNode with a fresh impulse response, wired between input and tone. */
  private makeConvolver(): ConvolverNode {
    const rate = this.ctx.sampleRate
    const length = Math.round(rate * this.size)
    const impulse = new AudioBuffer({ numberOfChannels: 2, length, sampleRate: rate })
    for (let channel = 0; channel < 2; channel++) {
      // getChannelData returns a Float32Array we can write samples into directly.
      const data = impulse.getChannelData(channel)
      for (let i = 0; i < length; i++) {
        const t = i / rate
        // exp(-6.9 * t / size) is 1 at t = 0 and 0.001 (-60 dB) at t = size.
        data[i] = (Math.random() * 2 - 1) * Math.exp((-6.9 * t) / this.size)
      }
    }
    const convolver = new ConvolverNode(this.ctx, { buffer: impulse })
    this.mixer.input.connect(convolver)
    convolver.connect(this.tone)
    return convolver
  }
}
