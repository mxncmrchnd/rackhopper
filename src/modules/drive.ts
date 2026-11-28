import { format, type Control } from './controls.ts'
import { makeId, monoPort, type SynthModule } from './synth-module.ts'

// Drive: soft saturation, the warm "overdriven amp" kind of distortion.
//
//   input --> WaveShaperNode --> tone (low-pass) --> level --> out
//
// A WaveShaperNode bends each sample through a curve. Ours is
// tanh(k·x) / tanh(k): nearly a straight line for quiet signals, flattening out
// for loud ones, which rounds off the peaks of the wave and adds harmonics.
// "Drive" is k: the bigger it is, the sooner the curve flattens and the
// grittier the sound. Dividing by tanh(k) keeps the loudest peak at 1.
//
// Distortion makes a sound denser, so it gets louder as Drive goes up; "Level"
// is there to bring it back down. "Tone" tames the fizzy top end.

const CURVE_SIZE = 2048

export class Drive implements SynthModule<'in', 'out'> {
  readonly id = makeId('drive')
  readonly type = 'drive'
  readonly title = 'Drive'
  readonly inputs
  readonly outputs
  readonly controls: readonly Control[]

  private readonly shaper: WaveShaperNode
  private readonly tone: BiquadFilterNode
  private readonly level: GainNode
  private amount = 4

  constructor(ctx: BaseAudioContext) {
    // oversample: process at a higher rate internally. Distortion creates
    // harmonics above what the sample rate can hold, which otherwise fold back
    // down as harsh, unmusical tones ("aliasing").
    this.shaper = new WaveShaperNode(ctx, { curve: makeCurve(this.amount), oversample: '4x' })
    this.tone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 6000 })
    this.level = new GainNode(ctx, { gain: 0.6 })
    this.shaper.connect(this.tone).connect(this.level)

    this.inputs = { in: monoPort(this.shaper) }
    this.outputs = { out: monoPort(this.level) }
    this.controls = [
      {
        kind: 'slider',
        id: 'drive',
        label: 'Drive',
        min: 1,
        max: 50,
        scale: 'log',
        format: format.number,
        get: () => this.amount,
        set: (v) => {
          this.amount = v
          this.shaper.curve = makeCurve(v) // 2048 values: cheap enough to redo on every move
        },
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
      {
        kind: 'slider',
        id: 'level',
        label: 'Level',
        min: 0,
        max: 1,
        scale: 'linear',
        format: format.percent,
        get: () => this.level.gain.value,
        set: (v) => (this.level.gain.value = v),
      },
    ]
  }

  setVoices(): void {
    // Mono module: always one channel.
  }

  dispose(): void {
    for (const node of [this.shaper, this.tone, this.level]) node.disconnect()
  }
}

/** The shaping curve: CURVE_SIZE points of tanh(k·x) / tanh(k), for x from -1 to 1. */
function makeCurve(k: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(CURVE_SIZE)
  for (let i = 0; i < CURVE_SIZE; i++) {
    const x = (i / (CURVE_SIZE - 1)) * 2 - 1
    curve[i] = Math.tanh(k * x) / Math.tanh(k)
  }
  return curve
}
