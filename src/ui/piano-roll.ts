import { noteName, type Note } from '../notes.ts'

// Piano roll on a Canvas 2D: time runs left to right, pitch bottom to top.
//
// Editing:
//   - click an empty cell to add a note (drag while adding to set its length)
//   - drag a note to move it
//   - drag a note's right edge to resize it
//   - right-click a note, or click it without dragging, to delete it
//
// The notes array is shared with the sequencer and edited in place.

const KEYS_WIDTH = 44 // the keyboard column on the left, in CSS pixels
// The roll stretches to fill its container's width (but not below this; the
// container scrolls instead). Rows have a fixed height, and the container
// scrolls vertically through the pitch range.
const MIN_BEAT_WIDTH = 24
const ROW_HEIGHT = 14
const LOWEST_PITCH = 24 // C1
const HIGHEST_PITCH = 107 // B7
const MIDDLE_C = 60
const ROWS = HIGHEST_PITCH - LOWEST_PITCH + 1
const SNAP = 0.25 // beats: a 16th note
const EDGE_GRAB = 6 // px from a note's right end that counts as its edge
const DRAG_THRESHOLD = 4 // px of movement before a press counts as a drag

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]) // C#, D#, F#, G#, A#

/**
 * What the current pointer press is doing. Another discriminated union: the
 * `kind` tells which, and only 'move' needs `grabOffset`.
 */
type Drag =
  | {
      kind: 'move'
      note: Note
      /** Where in the note it was grabbed, in beats from its start. */
      grabOffset: number
      startX: number
      startY: number
      moved: boolean
    }
  | {
      kind: 'resize'
      note: Note
      startX: number
      startY: number
      moved: boolean
    }

export interface PianoRollOptions {
  loopBeats: number
  /** Where the playhead is, in beats, or null when stopped. */
  playhead: () => number | null
}

export class PianoRoll {
  private readonly canvas: HTMLCanvasElement
  private readonly g: CanvasRenderingContext2D // "graphics"
  private readonly notes: Note[]
  private readonly options: PianoRollOptions
  // Sizes in CSS pixels, recomputed by resize() whenever the container changes.
  private beatWidth = MIN_BEAT_WIDTH
  private readonly rowHeight = ROW_HEIGHT
  private width = 0
  private height = 0
  private drag: Drag | null = null
  /** New notes get the length of the last one you drew or resized. */
  private lastDuration = 1

  constructor(canvas: HTMLCanvasElement, notes: Note[], options: PianoRollOptions) {
    this.canvas = canvas
    this.notes = notes
    this.options = options

    const g = canvas.getContext('2d')
    if (!g) throw new Error('Canvas 2D not supported')
    this.g = g

    // Fill the parent element, and follow it when the window is resized.
    const container = canvas.parentElement
    if (!container) throw new Error('Piano roll canvas needs a parent element')
    new ResizeObserver(() => this.resize(container)).observe(container)
    this.resize(container)
    this.scrollToNotes(container)

    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e))
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e))
    canvas.addEventListener('pointerup', () => this.onPointerUp())
    canvas.addEventListener('pointercancel', () => (this.drag = null))
    // Right-click is for deleting notes, so don't open the browser's menu.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())

    // Redraw every frame: cheap at this size, and keeps the playhead moving.
    const frame = (): void => {
      this.draw()
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }

  // --- Geometry ---------------------------------------------------------------

  private resize(container: HTMLElement): void {
    // clientWidth/clientHeight: the container's inner size, without borders.
    this.beatWidth = Math.max(
      MIN_BEAT_WIDTH,
      (container.clientWidth - KEYS_WIDTH) / this.options.loopBeats,
    )
    this.width = Math.floor(KEYS_WIDTH + this.options.loopBeats * this.beatWidth)
    this.height = ROWS * this.rowHeight

    // Draw in CSS pixels, but back the canvas with device pixels so it's sharp
    // on high-DPI screens: a bigger bitmap, shown at CSS size, with the drawing
    // scaled up to match. (Setting canvas.width resets the transform, so the
    // scale is applied again each time.)
    const dpr = window.devicePixelRatio || 1
    this.canvas.width = Math.round(this.width * dpr)
    this.canvas.height = Math.round(this.height * dpr)
    this.canvas.style.width = `${this.width}px`
    this.canvas.style.height = `${this.height}px`
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  /** Scroll vertically so the notes (or middle C, if there are none) are in the middle. */
  private scrollToNotes(container: HTMLElement): void {
    const pitches = this.notes.map((n) => n.pitch)
    const center =
      pitches.length > 0 ? (Math.min(...pitches) + Math.max(...pitches)) / 2 : MIDDLE_C
    container.scrollTop = this.yOf(center) - container.clientHeight / 2
  }

  private xOf(beat: number): number {
    return KEYS_WIDTH + beat * this.beatWidth
  }
  private yOf(pitch: number): number {
    return (HIGHEST_PITCH - pitch) * this.rowHeight
  }
  private beatAt(x: number): number {
    return (x - KEYS_WIDTH) / this.beatWidth
  }
  private pitchAt(y: number): number {
    return clamp(HIGHEST_PITCH - Math.floor(y / this.rowHeight), LOWEST_PITCH, HIGHEST_PITCH)
  }

  private local(event: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect()
    return { x: event.clientX - r.left, y: event.clientY - r.top }
  }

  // `Note | undefined`: Array.find returns undefined when nothing matches.
  private noteAt(x: number, y: number): Note | undefined {
    const beat = this.beatAt(x)
    const pitch = this.pitchAt(y)
    return this.notes.find(
      (n) => n.pitch === pitch && beat >= n.startBeat && beat < n.startBeat + n.durationBeats,
    )
  }

  private onEdge(note: Note, x: number): boolean {
    return this.xOf(note.startBeat + note.durationBeats) - x <= EDGE_GRAB
  }

  // --- Editing ----------------------------------------------------------------

  private onPointerDown(event: PointerEvent): void {
    const { x, y } = this.local(event)
    if (x < KEYS_WIDTH) return

    // event.button: 0 = main (left) button, 1 = middle, 2 = secondary (right).
    if (event.button === 2) {
      // Right-click deletes the note under the pointer, and does nothing on an empty cell.
      const hit = this.noteAt(x, y)
      if (hit) this.notes.splice(this.notes.indexOf(hit), 1)
      return
    }
    if (event.button !== 0) return

    this.canvas.setPointerCapture(event.pointerId)
    const hit = this.noteAt(x, y)
    if (hit) {
      this.drag = this.onEdge(hit, x)
        ? { kind: 'resize', note: hit, startX: x, startY: y, moved: false }
        : {
            kind: 'move',
            note: hit,
            grabOffset: this.beatAt(x) - hit.startBeat,
            startX: x,
            startY: y,
            moved: false,
          }
      return
    }

    // Empty cell: add a note there, then let a drag set its length.
    const startBeat = clamp(snapDown(this.beatAt(x)), 0, this.options.loopBeats - SNAP)
    const note: Note = {
      pitch: this.pitchAt(y),
      startBeat,
      durationBeats: Math.min(this.lastDuration, this.options.loopBeats - startBeat),
      velocity: 0.8,
    }
    this.notes.push(note)
    this.drag = { kind: 'resize', note, startX: x, startY: y, moved: false }
  }

  private onPointerMove(event: PointerEvent): void {
    const { x, y } = this.local(event)
    const drag = this.drag

    if (!drag) {
      // Not dragging: just show what a press here would do.
      const hit = this.noteAt(x, y)
      this.canvas.style.cursor = hit ? (this.onEdge(hit, x) ? 'ew-resize' : 'grab') : 'crosshair'
      return
    }

    // Ignore tiny wobbles, so a click doesn't turn into a micro-drag.
    if (!drag.moved && Math.hypot(x - drag.startX, y - drag.startY) < DRAG_THRESHOLD) return
    drag.moved = true

    const note = drag.note
    const loop = this.options.loopBeats
    switch (drag.kind) {
      case 'move': // `drag` is narrowed to the 'move' variant: grabOffset exists
        note.startBeat = clamp(snapRound(this.beatAt(x) - drag.grabOffset), 0, loop - note.durationBeats)
        note.pitch = this.pitchAt(y)
        break
      case 'resize': {
        const end = snapRound(this.beatAt(x))
        note.durationBeats = clamp(end - note.startBeat, SNAP, loop - note.startBeat)
        this.lastDuration = note.durationBeats
        break
      }
    }
  }

  private onPointerUp(): void {
    const drag = this.drag
    this.drag = null
    // A click on a note (no drag) deletes it.
    if (drag?.kind === 'move' && !drag.moved) {
      const index = this.notes.indexOf(drag.note)
      if (index !== -1) this.notes.splice(index, 1)
    }
  }

  // --- Drawing ----------------------------------------------------------------

  private draw(): void {
    const g = this.g
    // Read the palette from the CSS custom properties each frame, so the canvas
    // follows the light/dark theme like the rest of the page.
    const css = getComputedStyle(this.canvas)
    const color = (name: string): string => css.getPropertyValue(name).trim()
    const bg = color('--bg')
    const surface = color('--surface')
    const border = color('--border')
    const muted = color('--text-muted')
    const text = color('--text')
    const accent = color('--accent')

    // Rows: black-key rows darker, like a piano keyboard turned sideways.
    for (let pitch = LOWEST_PITCH; pitch <= HIGHEST_PITCH; pitch++) {
      const y = this.yOf(pitch)
      g.fillStyle = BLACK_KEYS.has(pitch % 12) ? bg : surface
      g.fillRect(0, y, this.width, this.rowHeight)
    }

    // Vertical lines: every beat, stronger every bar (4 beats).
    for (let beat = 0; beat <= this.options.loopBeats; beat++) {
      const x = Math.round(this.xOf(beat)) + 0.5 // +0.5 keeps 1px lines crisp
      g.strokeStyle = beat % 4 === 0 ? muted : border
      g.beginPath()
      g.moveTo(x, 0)
      g.lineTo(x, this.height)
      g.stroke()
    }

    // Horizontal line under every C, to mark octaves.
    g.strokeStyle = border
    for (let pitch = LOWEST_PITCH; pitch <= HIGHEST_PITCH; pitch++) {
      if (pitch % 12 !== 0) continue
      const y = this.yOf(pitch) + this.rowHeight - 0.5
      g.beginPath()
      g.moveTo(0, y)
      g.lineTo(this.width, y)
      g.stroke()
    }

    // Keyboard column with C labels.
    g.fillStyle = surface
    g.fillRect(0, 0, KEYS_WIDTH, this.height)
    g.font = '600 10px Inter, system-ui, sans-serif'
    g.textBaseline = 'middle'
    for (let pitch = LOWEST_PITCH; pitch <= HIGHEST_PITCH; pitch++) {
      const y = this.yOf(pitch)
      if (BLACK_KEYS.has(pitch % 12)) {
        g.fillStyle = bg
        g.fillRect(0, y, KEYS_WIDTH * 0.6, this.rowHeight)
      }
      if (pitch % 12 === 0) {
        g.fillStyle = muted
        g.fillText(noteName(pitch), KEYS_WIDTH * 0.62, y + this.rowHeight / 2)
      }
    }
    g.fillStyle = border
    g.fillRect(KEYS_WIDTH - 1, 0, 1, this.height)

    // Notes.
    for (const note of this.notes) {
      const x = this.xOf(note.startBeat)
      const y = this.yOf(note.pitch)
      const w = note.durationBeats * this.beatWidth
      g.fillStyle = accent
      g.fillRect(x + 1, y + 1, w - 2, this.rowHeight - 2)
      g.fillStyle = bg // a darker strip marks the resize edge
      g.fillRect(x + w - 4, y + 3, 2, this.rowHeight - 6)
    }

    // Playhead.
    const beat = this.options.playhead()
    if (beat !== null) {
      const x = Math.round(this.xOf(beat)) + 0.5
      g.strokeStyle = text
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(x, 0)
      g.lineTo(x, this.height)
      g.stroke()
      g.lineWidth = 1
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function snapDown(beat: number): number {
  return Math.floor(beat / SNAP) * SNAP
}

function snapRound(beat: number): number {
  return Math.round(beat / SNAP) * SNAP
}
