import { format, type Control } from './controls.ts'
import { makeId, monoPort, type SynthModule } from './synth-module.ts'

// Compressor: evens out loudness by turning loud parts down.
//
//   input --> DynamicsCompressorNode --> makeup gain --> out
//
// When the signal goes above "Threshold", it's reduced: with a "Ratio" of 4:1,
// going 4 dB over the threshold comes out only 1 dB over. "Attack" is how fast
// it reacts to a loud sound, "Release" how fast it lets go afterwards.
// (A slow attack lets the initial "click" of a pluck through, then clamps down.)
//
// Turning loud parts down makes everything quieter, so a "makeup" gain brings
// the level back up. Ours is automatic: it compensates for half of the maximum
// possible reduction, a common rule of thumb.

const dbToGain = (db: number): number => 10 ** (db / 20)

export class Compressor implements SynthModule<'in', 'out'> {
  readonly id = makeId('comp')
  readonly type = 'compressor'
  readonly title = 'Compressor'
  readonly inputs
  readonly outputs
  readonly controls: readonly Control[]

  private readonly compressor: DynamicsCompressorNode
  private readonly makeup: GainNode

  constructor(ctx: BaseAudioContext) {
    this.compressor = new DynamicsCompressorNode(ctx, {
      threshold: -24,
      ratio: 4,
      knee: 6, // dB over which compression eases in, instead of switching on abruptly
      attack: 0.01,
      release: 0.15,
    })
    this.makeup = new GainNode(ctx)
    this.compressor.connect(this.makeup)
    this.updateMakeup()

    this.inputs = { in: monoPort(this.compressor) }
    this.outputs = { out: monoPort(this.makeup) }
    this.controls = [
      {
        kind: 'slider',
        id: 'threshold',
        label: 'Threshold',
        min: -60,
        max: 0,
        scale: 'linear',
        format: format.db,
        get: () => this.compressor.threshold.value,
        set: (v) => {
          this.compressor.threshold.value = v
          this.updateMakeup()
        },
      },
      {
        kind: 'slider',
        id: 'ratio',
        label: 'Ratio',
        min: 1,
        max: 20,
        scale: 'log',
        format: format.ratio,
        get: () => this.compressor.ratio.value,
        set: (v) => {
          this.compressor.ratio.value = v
          this.updateMakeup()
        },
      },
      {
        kind: 'slider',
        id: 'attack',
        label: 'Attack',
        min: 0.001,
        max: 0.5,
        scale: 'log',
        format: format.seconds,
        get: () => this.compressor.attack.value,
        set: (v) => (this.compressor.attack.value = v),
      },
      {
        kind: 'slider',
        id: 'release',
        label: 'Release',
        min: 0.02,
        max: 1,
        scale: 'log',
        format: format.seconds,
        get: () => this.compressor.release.value,
        set: (v) => (this.compressor.release.value = v),
      },
    ]
  }

  setVoices(): void {
    // Mono module: always one channel.
  }

  dispose(): void {
    this.compressor.disconnect()
    this.makeup.disconnect()
  }

  private updateMakeup(): void {
    // A full-scale (0 dB) signal is -threshold dB over the threshold, and comes
    // out reduced by that amount x (1 - 1/ratio). Make up half of it.
    const threshold = this.compressor.threshold.value
    const ratio = this.compressor.ratio.value
    const maxReduction = -threshold * (1 - 1 / ratio)
    this.makeup.gain.value = dbToGain(maxReduction / 2)
  }
}
