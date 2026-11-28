// ADSR envelope.
//
// This is NOT an AudioNode. It drives an AudioParam (typically a VCA's gain) by
// scheduling automation events on it: "be at 0 now, ramp to 1 over the attack
// time, ramp down to the sustain level over the decay time, ..."
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

/** One point of the envelope: "the param reaches `value` at `time`". */
interface Breakpoint {
  time: number
  value: number
}

export class Adsr {
  // `private` means only code inside this class can touch these fields.
  // `readonly` means they're assigned once (in the constructor) and never reassigned.
  private readonly param: AudioParam
  private readonly settings: AdsrSettings

  // The envelope we last scheduled, as a list of breakpoints joined by straight
  // lines. We keep our own copy so we can work out the envelope's level at any
  // moment (see `levelAt`).
  private breakpoints: Breakpoint[] = [{ time: 0, value: 0 }]

  // The settings object is shared, not copied: if the UI changes
  // `settings.attack`, the next gateOn() picks up the new value.
  constructor(param: AudioParam, settings: AdsrSettings) {
    this.param = param
    this.settings = settings
    param.value = 0
  }

  /** Note starts: attack, then decay, then hold at the sustain level. */
  gateOn(time: number): void {
    const { attack, decay, sustain } = this.settings // destructuring
    // Start from wherever the envelope currently is, so retriggering during a
    // release doesn't click by jumping to 0.
    const start = this.levelAt(time)
    this.schedule([
      { time, value: start },
      { time: time + attack, value: 1 },
      { time: time + attack + decay, value: sustain },
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

  /** Replace whatever is scheduled on the param with these breakpoints. */
  private schedule(points: Breakpoint[]): void {
    const [first, ...rest] = points
    // Drop any automation that hasn't happened yet...
    this.param.cancelScheduledValues(first.time)
    // ...then pin the starting value explicitly. A ramp always goes from the
    // previous event, so without this the first ramp's start point would be
    // undefined (and Firefox handles that edge case differently from Chrome).
    this.param.setValueAtTime(first.value, first.time)
    for (const p of rest) {
      this.param.linearRampToValueAtTime(p.value, p.time)
    }
    this.breakpoints = points
  }

  /**
   * The envelope's level at `time`, worked out from our own breakpoints.
   *
   * Why not just read `param.value`? Browsers don't agree on what it returns
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
    // Past the last breakpoint: the param holds the last value (e.g. sustain).
    return points[points.length - 1].value
  }
}
