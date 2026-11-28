import { LocalizedError } from './i18n.ts'
import { BEATS_PER_BAR, MAX_BARS, type Note, type Song } from './notes.ts'

// Reading Standard MIDI Files (.mid), written by hand: no library needed.
//
// A MIDI file is a series of "chunks", each a 4-letter type plus a length:
//   - one header chunk "MThd": format, number of tracks, and the time
//     resolution ("ticks per quarter note")
//   - one "MTrk" chunk per track: a list of events, each preceded by a
//     "delta time" (ticks since the previous event)
//
// We care about three kinds of event: note on, note off, and tempo. Everything
// else (controllers, pitch bend, lyrics...) is skipped.
//
// Numbers are big-endian (most significant byte first), which is what
// DataView reads by default. Delta times and some lengths use a
// "variable-length quantity": 7 bits per byte, the top bit meaning "more
// bytes follow".

/** Thrown for files we can't read. Carries a translation key, like ProjectError. */
export class MidiError extends LocalizedError {}

/**
 * One track event, at an absolute tick. A discriminated union on `kind`:
 * code that switches on it gets the right fields for each case.
 */
type MidiEvent =
  | { kind: 'noteOn'; tick: number; channel: number; pitch: number; velocity: number }
  | { kind: 'noteOff'; tick: number; channel: number; pitch: number }
  | { kind: 'tempo'; tick: number; microsecondsPerQuarter: number }

/** A note as found in the file, still in ticks. */
interface MidiNote {
  channel: number
  pitch: number
  startTick: number
  durationTicks: number
  velocity: number // 1..127
}

interface MidiFile {
  ticksPerQuarter: number
  /** Tempo at the start of the song, or null if the file doesn't say (then 120 BPM). */
  bpm: number | null
  notes: MidiNote[]
}

// --- Byte reader ------------------------------------------------------------------

/** Reads numbers from a byte buffer, moving forward as it goes. */
class Reader {
  private readonly view: DataView
  position = 0

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer)
  }

  get length(): number {
    return this.view.byteLength
  }

  private need(bytes: number): void {
    if (this.position + bytes > this.view.byteLength) throw new MidiError('error.midiCorrupt')
  }

  u8(): number {
    this.need(1)
    return this.view.getUint8(this.position++)
  }

  peek(): number {
    this.need(1)
    return this.view.getUint8(this.position)
  }

  u16(): number {
    this.need(2)
    const value = this.view.getUint16(this.position)
    this.position += 2
    return value
  }

  u32(): number {
    this.need(4)
    const value = this.view.getUint32(this.position)
    this.position += 4
    return value
  }

  /** A 4-character chunk type, like "MThd". */
  text4(): string {
    return String.fromCharCode(this.u8(), this.u8(), this.u8(), this.u8())
  }

  /** Variable-length quantity: 7 bits per byte, top bit set = more bytes follow. */
  varLength(): number {
    let value = 0
    for (let i = 0; i < 4; i++) {
      const byte = this.u8()
      value = (value << 7) | (byte & 0x7f)
      if ((byte & 0x80) === 0) return value
    }
    throw new MidiError('error.midiCorrupt') // longer than the format allows
  }

  skip(bytes: number): void {
    this.need(bytes)
    this.position += bytes
  }
}

// --- Parsing -------------------------------------------------------------------

function parseMidi(buffer: ArrayBuffer): MidiFile {
  const reader = new Reader(buffer)
  if (reader.length < 14 || reader.text4() !== 'MThd') throw new MidiError('error.notMidi')
  const headerLength = reader.u32()
  reader.u16() // format (0, 1 or 2): we merge all tracks anyway
  const trackCount = reader.u16()
  const division = reader.u16()
  reader.skip(headerLength - 6)
  // If the top bit is set, time is in SMPTE frames rather than beats: rare for
  // music files, and it has no notion of beats to put on our grid.
  if (division & 0x8000) throw new MidiError('error.midiSmpte')

  const events: MidiEvent[] = []
  for (let track = 0; track < trackCount && reader.position < reader.length; track++) {
    const type = reader.text4()
    const length = reader.u32()
    const end = reader.position + length
    if (type === 'MTrk') events.push(...parseTrack(reader, end))
    reader.position = end // also skips unknown chunk types, as the format requires
  }

  const tempo = events
    .filter((e) => e.kind === 'tempo') // narrowed to tempo events by an inferred type predicate
    .sort((a, b) => a.tick - b.tick)[0]
  return {
    ticksPerQuarter: division,
    // A quarter note lasts `microsecondsPerQuarter`, so BPM = 60 s / that.
    bpm: tempo ? 60_000_000 / tempo.microsecondsPerQuarter : null,
    notes: pairNotes(events),
  }
}

function parseTrack(reader: Reader, end: number): MidiEvent[] {
  const events: MidiEvent[] = []
  let tick = 0
  // "Running status": a status byte can be left out when it's the same as the
  // previous event's, so we remember it.
  let runningStatus = 0

  while (reader.position < end) {
    tick += reader.varLength()
    let status = reader.peek()
    if (status & 0x80) {
      reader.position++ // a real status byte
    } else if (runningStatus) {
      status = runningStatus // a data byte: reuse the previous status
    } else {
      throw new MidiError('error.midiCorrupt')
    }

    if (status === 0xff) {
      // Meta event: type, length, data. 0x51 = tempo (3 bytes, µs per quarter).
      runningStatus = 0
      const type = reader.u8()
      const length = reader.varLength()
      if (type === 0x51 && length === 3) {
        const microsecondsPerQuarter = (reader.u8() << 16) | (reader.u8() << 8) | reader.u8()
        events.push({ kind: 'tempo', tick, microsecondsPerQuarter })
      } else {
        reader.skip(length)
      }
      continue
    }
    if (status === 0xf0 || status === 0xf7) {
      // System exclusive (manufacturer-specific data): skip it.
      runningStatus = 0
      reader.skip(reader.varLength())
      continue
    }

    // Channel messages: the high 4 bits say what, the low 4 bits which channel.
    runningStatus = status
    const channel = status & 0x0f
    switch (status & 0xf0) {
      case 0x80: {
        const pitch = reader.u8()
        reader.u8() // release velocity, unused
        events.push({ kind: 'noteOff', tick, channel, pitch })
        break
      }
      case 0x90: {
        const pitch = reader.u8()
        const velocity = reader.u8()
        // By convention, "note on with velocity 0" means note off.
        events.push(
          velocity === 0
            ? { kind: 'noteOff', tick, channel, pitch }
            : { kind: 'noteOn', tick, channel, pitch, velocity },
        )
        break
      }
      case 0xc0: // program change
      case 0xd0: // channel pressure
        reader.skip(1)
        break
      default: // 0xa0 aftertouch, 0xb0 controller, 0xe0 pitch bend
        reader.skip(2)
    }
  }
  return events
}

/** Match each note-on with the next note-off of the same pitch on the same channel. */
function pairNotes(events: MidiEvent[]): MidiNote[] {
  // Events from different tracks were appended track by track; put them in time
  // order (offs before ons at the same tick, so repeated notes pair correctly).
  const ordered = [...events].sort(
    (a, b) => a.tick - b.tick || Number(a.kind === 'noteOn') - Number(b.kind === 'noteOn'),
  )
  // Notes waiting for their note-off, keyed by "channel:pitch". An array per
  // key, because the same pitch can be started twice before being released.
  const open = new Map<string, { tick: number; velocity: number }[]>()
  const notes: MidiNote[] = []
  let lastTick = 0

  for (const event of ordered) {
    lastTick = event.tick
    switch (event.kind) {
      case 'noteOn': {
        const key = `${event.channel}:${event.pitch}`
        const stack = open.get(key) ?? []
        stack.push({ tick: event.tick, velocity: event.velocity })
        open.set(key, stack)
        break
      }
      case 'noteOff': {
        const key = `${event.channel}:${event.pitch}`
        const start = open.get(key)?.shift() // oldest first
        if (start && event.tick > start.tick) {
          notes.push({
            channel: event.channel,
            pitch: event.pitch,
            startTick: start.tick,
            durationTicks: event.tick - start.tick,
            velocity: start.velocity,
          })
        }
        break
      }
      case 'tempo':
        break
    }
  }

  // Notes never switched off: end them at the last event.
  for (const [key, starts] of open) {
    const [channel, pitch] = key.split(':').map(Number)
    for (const start of starts) {
      if (lastTick > start.tick) {
        notes.push({ channel, pitch, startTick: start.tick, durationTicks: lastTick - start.tick, velocity: start.velocity })
      }
    }
  }
  return notes
}

// --- Turning a MIDI file into a song ------------------------------------------------

const DRUM_CHANNEL = 9 // "channel 10" counting from 1: General MIDI percussion
const LOWEST_PITCH = 24 // the piano roll's range, C1..B7
const HIGHEST_PITCH = 107

export interface MidiImport {
  song: Song
  /** Tempo from the file, if it has one. */
  bpm: number | null
  /** The file's length in bars, when it was longer than MAX_BARS and got cut. */
  truncatedFrom: number | null
}

/**
 * Read a .mid file into a song: all tracks merged, drums left out, notes moved
 * into the piano roll's range by octaves, and cut at MAX_BARS.
 */
export function importMidi(buffer: ArrayBuffer): MidiImport {
  const file = parseMidi(buffer)
  const toBeats = (ticks: number): number => ticks / file.ticksPerQuarter
  const maxBeats = MAX_BARS * BEATS_PER_BAR

  const melodic = file.notes.filter((n) => n.channel !== DRUM_CHANNEL)
  if (melodic.length === 0) throw new MidiError('error.midiNoNotes')

  // A loop rather than Math.max(...array): spreading tens of thousands of
  // notes as function arguments can exceed the browser's argument limit.
  let endBeat = 0
  for (const n of melodic) endBeat = Math.max(endBeat, toBeats(n.startTick + n.durationTicks))
  const fullBars = Math.max(1, Math.ceil(endBeat / BEATS_PER_BAR))

  const notes: Note[] = []
  for (const n of melodic) {
    const start = toBeats(n.startTick)
    if (start >= maxBeats) continue // past the 64-bar limit
    let pitch = n.pitch
    while (pitch < LOWEST_PITCH) pitch += 12
    while (pitch > HIGHEST_PITCH) pitch -= 12
    notes.push({
      pitch,
      startBeat: start,
      durationBeats: Math.min(toBeats(n.durationTicks), maxBeats - start),
      velocity: n.velocity / 127,
    })
  }

  return {
    song: { notes, bars: Math.min(fullBars, MAX_BARS) },
    bpm: file.bpm,
    truncatedFrom: fullBars > MAX_BARS ? fullBars : null,
  }
}
