// Piano roll data: a list of notes, independent of how they're drawn or played.
// The piano roll edits this array in place, and the sequencer reads it on every
// scheduler tick, so edits are heard on the next pass.

export interface Note {
  /** MIDI note number: 60 = middle C (C4), 69 = A4 (440 Hz). */
  pitch: number
  startBeat: number
  durationBeats: number
  /** 0..1, scales the envelope. */
  velocity: number
}

export const BEATS_PER_BAR = 4 // the grid is always 4/4
export const MAX_BARS = 64

/**
 * The melody and its loop length. One Song object is shared (by reference) by
 * the sequencer, the piano roll and main.ts, so a change made by any of them is
 * seen by all: edit it in place, never replace it.
 */
export interface Song {
  notes: Note[]
  bars: number
}

export function loopBeats(song: Song): number {
  return song.bars * BEATS_PER_BAR
}

/** Snap every note to a grid (in beats): starts to the nearest step, lengths to at least one step. */
export function quantize(notes: Note[], step: number): void {
  for (const note of notes) {
    const start = Math.round(note.startBeat / step) * step
    const end = Math.round((note.startBeat + note.durationBeats) / step) * step
    note.startBeat = start
    note.durationBeats = Math.max(step, end - start)
  }
}

/** MIDI note number -> name, e.g. 60 -> "C4". */
export function noteName(pitch: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return `${names[pitch % 12]}${Math.floor(pitch / 12) - 1}`
}

/** A short arpeggio pattern over four bars, so Play does something right away. */
export function defaultMelody(): Note[] {
  // [pitch, startBeat, durationBeats] tuples, expanded into Note objects.
  // `[number, number, number][]` is a *tuple* type: an array with a fixed
  // length where each position has its own type.
  // prettier-ignore
  const raw: [number, number, number][] = [
    [57, 0, 0.5], [60, 0.5, 0.5], [64, 1, 0.5], [69, 1.5, 0.5], [67, 2, 1], [64, 3, 1],
    [53, 4, 0.5], [57, 4.5, 0.5], [60, 5, 0.5], [65, 5.5, 0.5], [64, 6, 1], [60, 7, 1],
    [60, 8, 0.5], [64, 8.5, 0.5], [67, 9, 0.5], [72, 9.5, 0.5], [71, 10, 1], [67, 11, 1],
    [55, 12, 0.5], [59, 12.5, 0.5], [62, 13, 0.5], [67, 13.5, 0.5], [64, 14, 2],
  ]
  return raw.map(([pitch, startBeat, durationBeats]) => ({
    pitch,
    startBeat,
    durationBeats,
    velocity: 0.8,
  }))
}
