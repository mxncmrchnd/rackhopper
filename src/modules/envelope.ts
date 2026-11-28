// One ADSR envelope, driving one AudioParam by scheduling automation on it:
// "be at 0 now, ramp to 1 over the attack time, ramp down to the sustain level
// over the decay time, ..." The ADSR module owns one Envelope per voice.
//
//   level
//     1 |    /\
//       |   /  \______  <- sustain level
//       |  /          \
//     0 |_/            \___
//         A  D    S    R
//        gate on   gate off

/** Envelope settings. Times are in seconds, sustain is a level from 0 to 1. */
export interface AdsrSettings {
  attack: number
  decay: number
  sustain: number
  release: number
}

/** One point of the envelope: "the level reaches `value` at `time`". */
interface Breakpoint {
  time: number
  value: number
}

export class Envelope {
  private readonly level: AudioParam
  private readonly settings: AdsrSettings

  // The envelope we last scheduled, as a list of breakpoints joined by straight
  // lines. We keep our own copy so we can work out the envelope's level at any
  // moment (see `levelAt`).
  private breakpoints: Breakpoint[] = [{ time: 0, value: 0 }]

  /** `settings` is shared with the module, so knob changes apply to the next note. */
  constructor(level: AudioParam, settings: AdsrSettings) {
    this.level = level
    this.settings = settings
    // An explicit first event, so `schedule()` always has one to ramp from.
    level.setValueAtTime(0, 0)
  }

  /**
   * Note starts: attack, then decay, then hold at the sustain level.
   * `velocity` (0..1) scales the whole envelope: softer notes peak lower.
   *
   * `time` can be in the future (the sequencer schedules ahead), but calls must
   * come in time order.
   */
  gateOn(time: number, velocity = 1): void {
    const { attack, decay, sustain } = this.settings // destructuring
    // Start from wherever the envelope currently is, so retriggering during a
    // release doesn't click by jumping to 0.
    const start = this.levelAt(time)
    this.schedule([
      { time, value: start },
      { time: time + attack, value: velocity },
      { time: time + attack + decay, value: sustain * velocity },
    ])
  }

  /** Note ends: fall from the current level to 0 over the release time. */
  gateOff(time: number): void {
    const start = this.levelAt(time)
    this.schedule([
      { time, value: start },
      { time: time + this.settings.release, value: 0 },
    ])
  }

  /** Replace whatever is scheduled with these breakpoints. */
  private schedule(points: Breakpoint[]): void {
    const [first, ...rest] = points
    // Drop all automation from first.time onwards...
    this.level.cancelScheduledValues(first.time)
    // ...but that can cut a ramp in half: if first.time falls in the middle of
    // the previous attack (a note-off scheduled before the attack finished),
    // the attack ramp's end point was just removed. Ramping to the level the
    // old envelope would have had at first.time puts that half back: it's the
    // same straight line, just ending earlier.
    this.level.linearRampToValueAtTime(first.value, first.time)
    // Then pin the starting value explicitly. A ramp always goes from the
    // previous event, so this gives the new envelope's first ramp a well-defined
    // start (Firefox and Chrome disagree on some edge cases otherwise).
    this.level.setValueAtTime(first.value, first.time)
    for (const p of rest) {
      this.level.linearRampToValueAtTime(p.value, p.time)
    }
    this.breakpoints = points
  }

  /**
   * The envelope's level at `time`, worked out from our own breakpoints.
   *
   * Why not just read `level.value`? Browsers don't agree on what it returns
   * while automation is running, and `cancelAndHoldAtTime()` (the API built
   * for this) isn't available in Firefox.
   */
  private levelAt(time: number): number {
    const points = this.breakpoints
    if (time <= points[0].time) return points[0].value

    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]
      const b = points[i]
      if (time < b.time) {
        // Linear interpolation between a and b.
        const t = (time - a.time) / (b.time - a.time)
        return a.value + (b.value - a.value) * t
      }
    }
    // Past the last breakpoint: the level holds the last value (e.g. sustain).
    return points[points.length - 1].value
  }
}
