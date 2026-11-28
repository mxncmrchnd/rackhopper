import { loopBeats, type Note, type Song } from '../notes.ts'
import { format, type Control } from './controls.ts'
import { makeId, times, type Output, type Port, type SynthModule } from './synth-module.ts'

// Sequencer: plays the piano roll's notes in a loop.
//
// It has two kinds of output:
//   - `pitch`, a poly control signal (one ConstantSourceNode per voice)
//     patched into a VCO's pitch input. Following the CV convention,
//     1.0 = one octave, and 0 = A3, so with the VCO tuned to 220 Hz the notes
//     come out at the right pitch.
//   - gate events: "voice v starts a note at time t" / "voice v ends it",
//     passed to the `onGate` callback, which main.ts forwards to every ADSR.
//     (Gates are JavaScript calls, not audio signals, so they aren't cables.)
//
// Polyphony: each new note is given to a voice (see `allocateVoice`). With one
// voice, a new note simply takes over from the previous one (mono).
//
// Timing: the look-ahead scheduler ("A Tale of Two Clocks").
// JavaScript timers are imprecise (they can fire late by tens of milliseconds),
// but the audio clock (`ctx.currentTime`) is sample-accurate. So a timer only
// *wakes up* the scheduler every 25 ms, and each time it schedules every event
// in the next 100 ms at its exact audio time. The timer's jitter never reaches
// the audio, as long as it fires at least once per look-ahead window.

const LOOKAHEAD_SECONDS = 0.1
const TICK_MS = 25
const A3 = 57 // MIDI note number for pitch CV 0
const START_DELAY = 0.05 // seconds of head start, so the first note isn't late

export type GateHandler = (voice: number, on: boolean, time: number, velocity: number) => void

/** A note starting or ending, at an absolute beat (counting loop repeats). */
interface NoteEvent {
  beat: number
  on: boolean
  note: Note
}

/** What one voice is doing. */
interface VoiceState {
  /** The note it's playing, or null if it's free (possibly still releasing). */
  note: Note | null
  /** Beat at which it started its current note, or was released. */
  since: number
}

export class Sequencer implements SynthModule<never, 'pitch'> {
  readonly id = makeId('seq')
  readonly type = 'sequencer'
  readonly title = 'Sequencer'
  readonly inputs = {}
  readonly outputs: { pitch: Port<Output> } = { pitch: { channels: [] } }
  readonly controls: readonly Control[]

  onGate: GateHandler = () => {}

  private readonly ctx: BaseAudioContext
  private readonly song: Song
  private sources: ConstantSourceNode[] = []
  private voices: VoiceState[] = []
  private bpm = 120

  // `number | null`: null when stopped. `window.setInterval` returns a number id.
  private timer: number | null = null
  // Tempo mapping: the beat `anchorBeat` happens at audio time `anchorTime`.
  // Changing tempo while playing moves the anchor to "now".
  private anchorTime = 0
  private anchorBeat = 0
  /** Everything before this beat has been scheduled already. */
  private scheduledUntil = 0

  constructor(ctx: BaseAudioContext, song: Song) {
    this.ctx = ctx
    this.song = song // shared with the piano roll, not copied
    this.setVoices(1)

    this.controls = [
      {
        kind: 'slider',
        id: 'tempo',
        label: 'Tempo',
        min: 40,
        max: 240,
        step: 1,
        scale: 'linear',
        format: format.bpm,
        get: () => this.bpm,
        set: (v) => this.setBpm(v),
      },
    ]
  }

  get playing(): boolean {
    return this.timer !== null
  }

  setVoices(count: number): void {
    this.stopSources()
    this.sources = times(count, () => {
      const source = new ConstantSourceNode(this.ctx, { offset: 0 })
      source.start()
      return source
    })
    this.voices = times(count, () => ({ note: null, since: -Infinity }))
    this.outputs.pitch.channels = this.sources
  }

  start(): void {
    if (this.playing) return
    this.anchorTime = this.ctx.currentTime + START_DELAY
    this.anchorBeat = 0
    this.scheduledUntil = 0
    for (const voice of this.voices) voice.note = null
    this.tick()
    this.timer = window.setInterval(() => this.tick(), TICK_MS)
  }

  stop(): void {
    if (this.timer === null) return
    window.clearInterval(this.timer)
    this.timer = null
    const now = this.ctx.currentTime
    // Events up to 100 ms ahead are already scheduled: cancel them. The gate-off
    // makes each ADSR cancel its own pending events too.
    this.voices.forEach((voice, i) => {
      this.sources[i].offset.cancelScheduledValues(now)
      voice.note = null
      this.onGate(i, false, now, 0)
    })
  }

  /** Position in the loop (0..loopBeats), or null when stopped. For the playhead. */
  currentBeat(): number | null {
    if (!this.playing) return null
    const beat = this.beatAt(this.ctx.currentTime)
    return beat < 0 ? null : beat % loopBeats(this.song)
  }

  dispose(): void {
    this.stop()
    this.stopSources()
  }

  private stopSources(): void {
    for (const source of this.sources) {
      source.stop()
      source.disconnect()
    }
  }

  private setBpm(bpm: number): void {
    if (this.playing) {
      // Re-anchor so the beat we're on now stays where it is, and only the
      // future speeds up or slows down.
      const now = this.ctx.currentTime
      this.anchorBeat = this.beatAt(now)
      this.anchorTime = now
    }
    this.bpm = bpm
  }

  private beatAt(time: number): number {
    return this.anchorBeat + ((time - this.anchorTime) * this.bpm) / 60
  }

  private timeAt(beat: number): number {
    return this.anchorTime + ((beat - this.anchorBeat) * 60) / this.bpm
  }

  /** Schedule everything between what's already scheduled and the look-ahead horizon. */
  private tick(): void {
    this.releaseDeletedNotes()
    const until = this.beatAt(this.ctx.currentTime + LOOKAHEAD_SECONDS)
    if (until <= this.scheduledUntil) return
    for (const event of this.eventsBetween(this.scheduledUntil, until)) {
      this.dispatch(event)
    }
    this.scheduledUntil = until
  }

  /**
   * A note deleted (or cleared) in the piano roll while sounding never gets its
   * note-off event, so its voice would stay on. Release such voices now.
   *
   * Releasing "now" keeps the time order the envelopes need: anything else
   * already scheduled for that voice would have replaced its note. And if the
   * deleted note's start was still pending, the gate-off cancels it.
   */
  private releaseDeletedNotes(): void {
    const now = this.ctx.currentTime
    this.voices.forEach((voice, i) => {
      if (voice.note && !this.song.notes.includes(voice.note)) {
        this.voices[i] = { note: null, since: this.beatAt(now) }
        this.onGate(i, false, now, 0)
      }
    })
  }

  /** Note starts and ends with `from <= beat < to`, sorted by time. */
  private eventsBetween(from: number, to: number): NoteEvent[] {
    const events: NoteEvent[] = []
    const length = loopBeats(this.song) // read every time: the length can change while playing
    // The window can span a loop boundary, so check each loop repeat it touches.
    // Starting one repeat early catches notes that end after the loop point.
    const firstRepeat = Math.floor(from / length) - 1
    const lastRepeat = Math.floor(to / length)
    for (let repeat = firstRepeat; repeat <= lastRepeat; repeat++) {
      const offset = repeat * length
      for (const note of this.song.notes) {
        // Notes past the end (left over after shortening the loop) don't play.
        if (note.startBeat >= length) continue
        const on = offset + note.startBeat
        const off = on + note.durationBeats
        if (on >= from && on < to) events.push({ beat: on, on: true, note })
        if (off >= from && off < to) events.push({ beat: off, on: false, note })
      }
    }
    // Time order matters (each envelope expects it). At equal times, note-offs
    // come first, so back-to-back notes release and then retrigger.
    return events.sort((a, b) => a.beat - b.beat || Number(a.on) - Number(b.on))
  }

  private dispatch(event: NoteEvent): void {
    const time = this.timeAt(event.beat)
    if (event.on) {
      const v = this.allocateVoice()
      this.voices[v] = { note: event.note, since: event.beat }
      this.sources[v].offset.setValueAtTime((event.note.pitch - A3) / 12, time)
      this.onGate(v, true, time, event.note.velocity)
    } else {
      // Only the voice still playing this note can end it. If the note was
      // "stolen" by a newer one, its end is ignored.
      const v = this.voices.findIndex((voice) => voice.note === event.note)
      if (v === -1) return
      this.voices[v] = { note: null, since: event.beat }
      this.onGate(v, false, time, 0)
    }
  }

  /**
   * Pick a voice for a new note:
   *   1. a free voice, preferring the one released longest ago (its release
   *      tail has had the most time to fade out);
   *   2. if every voice is busy, steal the one whose note started first.
   * With a single voice, both rules return voice 0: mono behaviour.
   */
  private allocateVoice(): number {
    let best = 0
    for (let i = 1; i < this.voices.length; i++) {
      const a = this.voices[i]
      const b = this.voices[best]
      const aFree = a.note === null
      const bFree = b.note === null
      // A free voice beats a busy one; between two of the same kind, the older wins.
      if ((aFree && !bFree) || (aFree === bFree && a.since < b.since)) best = i
    }
    return best
  }
}
