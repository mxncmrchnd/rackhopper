import { loopBeats, noteName, type Note, type Song } from '../notes.ts'

// Piano roll on a Canvas 2D: time runs left to right, pitch bottom to top.
//
// Editing:
//   - click an empty cell to add a note (drag while adding to set its length)
//   - drag a note to move it
//   - drag a note's right edge to resize it
//   - right-click a note, or click it without dragging, to delete it
// Viewing:
//   - scroll with the scrollbars / mouse wheel; the keyboard column stays put
//   - zoom with zoomIn()/zoomOut() (buttons in main.ts) or Ctrl + mouse wheel
//   - while playing, the view follows the playhead
//
// Only the visible part is drawn. The canvas is exactly the size of its
// scrolling container and "sticks" in place (CSS position: sticky), while an
// invisible "sizer" element, as big as the whole song, gives the container its
// scrollbars. Each frame, we read scrollLeft/scrollTop and draw that window.
// That way a 64-bar song doesn't need a giant canvas.
//
// The song is shared with the sequencer and edited in place.

const KEYS_WIDTH = 44 // the keyboard column on the left, in CSS pixels
const RULER_HEIGHT = 16 // bar numbers along the top
const MIN_BEAT_WIDTH = 6 // fully zoomed out
const MAX_BEAT_WIDTH = 160 // fully zoomed in
const FIT_MIN_BEAT_WIDTH = 24 // "fit to width" never squeezes beats below this
const ZOOM_STEP = 1.25
const ROW_HEIGHT = 14
const LOWEST_PITCH = 24 // C1
const HIGHEST_PITCH = 107 // B7
const ROWS = HIGHEST_PITCH - LOWEST_PITCH + 1
const MIDDLE_C = 60
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
  /** Where the playhead is, in beats, or null when stopped. */
  playhead: () => number | null
}

export class PianoRoll {
  private readonly canvas: HTMLCanvasElement
  private readonly container: HTMLElement
  private readonly sizer: HTMLElement
  private readonly g: CanvasRenderingContext2D // "graphics"
  private readonly song: Song
  private readonly options: PianoRollOptions
  /** Beat width chosen by zooming, or null for "fit the loop to the width". */
  private zoom: number | null = null
  private drag: Drag | null = null
  /** New notes get the length of the last one you drew or resized. */
  private lastDuration = 1
  /** For the follow-the-playhead check: where it was on the previous frame. */
  private lastPlayhead: number | null = null

  constructor(canvas: HTMLCanvasElement, song: Song, options: PianoRollOptions) {
    this.canvas = canvas
    this.song = song
    this.options = options

    const g = canvas.getContext('2d')
    if (!g) throw new Error('Canvas 2D not supported')
    this.g = g

    const container = canvas.parentElement
    if (!container) throw new Error('Piano roll canvas needs a parent element')
    this.container = container
    this.sizer = document.createElement('div')
    this.sizer.className = 'piano-roll-sizer'
    container.append(this.sizer)

    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e))
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e))
    canvas.addEventListener('pointerup', () => this.onPointerUp())
    canvas.addEventListener('pointercancel', () => (this.drag = null))
    // Right-click is for deleting notes, so don't open the browser's menu.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    // Ctrl + wheel zooms (around the pointer) instead of scrolling.
    container.addEventListener('wheel', (e) => this.onWheel(e), { passive: false })

    this.scrollToStart()

    // Redraw every frame: only the visible part, so it stays cheap.
    const frame = (): void => {
      this.draw()
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }

  /** Back to "fit to width", scrolled to the beginning and centred on the notes. */
  scrollToStart(): void {
    this.zoom = null
    this.updateSizer()
    this.container.scrollLeft = 0
    const pitches = this.song.notes.map((n) => n.pitch)
    const center = pitches.length > 0 ? (Math.min(...pitches) + Math.max(...pitches)) / 2 : MIDDLE_C
    this.container.scrollTop = this.contentY(center) - this.container.clientHeight / 2
  }

  zoomIn(): void {
    this.setZoom(this.beatWidth * ZOOM_STEP)
  }

  zoomOut(): void {
    this.setZoom(this.beatWidth / ZOOM_STEP)
  }

  // --- Geometry ---------------------------------------------------------------
  //
  // Two coordinate systems:
  //   - "content": the whole song, as if drawn on one huge canvas
  //   - "screen": the visible canvas (content minus the scroll position)
  // The keyboard column and the ruler are drawn at fixed screen positions.

  private get loop(): number {
    return loopBeats(this.song)
  }

  /** Width of one beat, in pixels. */
  private get beatWidth(): number {
    if (this.zoom !== null) return this.zoom
    const fit = (this.container.clientWidth - KEYS_WIDTH) / this.loop
    return Math.min(MAX_BEAT_WIDTH, Math.max(FIT_MIN_BEAT_WIDTH, fit))
  }

  private setZoom(beatWidth: number, anchorX = KEYS_WIDTH): void {
    // Keep the beat under `anchorX` (the pointer, or the left edge) in place.
    const beatAtAnchor = this.beatAt(anchorX)
    this.zoom = Math.min(MAX_BEAT_WIDTH, Math.max(MIN_BEAT_WIDTH, beatWidth))
    this.updateSizer()
    this.container.scrollLeft = beatAtAnchor * this.beatWidth - (anchorX - KEYS_WIDTH)
  }

  /** Make the sizer as big as the whole song, so the scrollbars cover it. */
  private updateSizer(): void {
    const width = Math.ceil(KEYS_WIDTH + this.loop * this.beatWidth)
    const height = RULER_HEIGHT + ROWS * ROW_HEIGHT
    this.sizer.style.width = `${width}px`
    this.sizer.style.height = `${height}px`
  }

  private contentY(pitch: number): number {
    return RULER_HEIGHT + (HIGHEST_PITCH - pitch) * ROW_HEIGHT
  }

  private screenX(beat: number): number {
    return KEYS_WIDTH + beat * this.beatWidth - this.container.scrollLeft
  }

  private screenY(pitch: number): number {
    return this.contentY(pitch) - this.container.scrollTop
  }

  private beatAt(x: number): number {
    return (x - KEYS_WIDTH + this.container.scrollLeft) / this.beatWidth
  }

  private pitchAt(y: number): number {
    const row = Math.floor((y + this.container.scrollTop - RULER_HEIGHT) / ROW_HEIGHT)
    return clamp(HIGHEST_PITCH - row, LOWEST_PITCH, HIGHEST_PITCH)
  }

  private local(event: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect()
    return { x: event.clientX - r.left, y: event.clientY - r.top }
  }

  // `Note | undefined`: Array.find returns undefined when nothing matches.
  private noteAt(x: number, y: number): Note | undefined {
    if (y < RULER_HEIGHT) return undefined
    const beat = this.beatAt(x)
    const pitch = this.pitchAt(y)
    return this.song.notes.find(
      (n) => n.pitch === pitch && beat >= n.startBeat && beat < n.startBeat + n.durationBeats,
    )
  }

  private onEdge(note: Note, x: number): boolean {
    return this.screenX(note.startBeat + note.durationBeats) - x <= EDGE_GRAB
  }

  // --- Editing ----------------------------------------------------------------

  private onWheel(event: WheelEvent): void {
    if (!event.ctrlKey) return // plain wheel: let the container scroll
    event.preventDefault() // otherwise the browser zooms the whole page
    const { x } = this.local(event)
    const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
    this.setZoom(this.beatWidth * factor, Math.max(KEYS_WIDTH, x))
  }

  private onPointerDown(event: PointerEvent): void {
    const { x, y } = this.local(event)
    if (x < KEYS_WIDTH || y < RULER_HEIGHT) return

    // event.button: 0 = main (left) button, 1 = middle, 2 = secondary (right).
    if (event.button === 2) {
      // Right-click deletes the note under the pointer, and does nothing on an empty cell.
      const hit = this.noteAt(x, y)
      if (hit) this.song.notes.splice(this.song.notes.indexOf(hit), 1)
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
    const startBeat = clamp(snapDown(this.beatAt(x)), 0, this.loop - SNAP)
    const note: Note = {
      pitch: this.pitchAt(y),
      startBeat,
      durationBeats: Math.min(this.lastDuration, this.loop - startBeat),
      velocity: 0.8,
    }
    this.song.notes.push(note)
    this.drag = { kind: 'resize', note, startX: x, startY: y, moved: false }
  }

  private onPointerMove(event: PointerEvent): void {
    const { x, y } = this.local(event)
    const drag = this.drag

    if (!drag) {
      // Not dragging: just show what a press here would do.
      const hit = this.noteAt(x, y)
      const inGrid = x >= KEYS_WIDTH && y >= RULER_HEIGHT
      this.canvas.style.cursor = hit
        ? this.onEdge(hit, x)
          ? 'ew-resize'
          : 'grab'
        : inGrid
          ? 'crosshair'
          : 'default'
      return
    }

    // Ignore tiny wobbles, so a click doesn't turn into a micro-drag.
    if (!drag.moved && Math.hypot(x - drag.startX, y - drag.startY) < DRAG_THRESHOLD) return
    drag.moved = true

    const note = drag.note
    switch (drag.kind) {
      case 'move': // `drag` is narrowed to the 'move' variant: grabOffset exists
        note.startBeat = clamp(snapRound(this.beatAt(x) - drag.grabOffset), 0, this.loop - note.durationBeats)
        note.pitch = this.pitchAt(y)
        break
      case 'resize': {
        const end = snapRound(this.beatAt(x))
        note.durationBeats = clamp(end - note.startBeat, SNAP, this.loop - note.startBeat)
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
      const index = this.song.notes.indexOf(drag.note)
      if (index !== -1) this.song.notes.splice(index, 1)
    }
  }

  // --- Drawing ----------------------------------------------------------------

  /** Keep the playhead in view while playing, a page at a time. */
  private follow(beat: number | null): void {
    const previous = this.lastPlayhead
    this.lastPlayhead = beat
    if (beat === null || previous === null) return
    const x = this.screenX(beat)
    const wrapped = beat < previous // jumped back to the loop start
    if (x > this.container.clientWidth - 8 || (wrapped && x < KEYS_WIDTH)) {
      this.container.scrollLeft = beat * this.beatWidth
    }
  }

  private draw(): void {
    const g = this.g
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    if (width === 0 || height === 0) return // hidden or not laid out yet
    this.updateSizer() // cheap, and keeps up with length changes and resizes

    // Match the canvas bitmap to the visible area, in device pixels.
    const dpr = window.devicePixelRatio || 1
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr)
      this.canvas.height = Math.round(height * dpr)
      this.canvas.style.width = `${width}px`
      this.canvas.style.height = `${height}px`
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0)

    const playhead = this.options.playhead()
    this.follow(playhead)

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

    // Visible range (with a row/beat of margin).
    const firstPitch = Math.max(LOWEST_PITCH, this.pitchAt(height) - 1)
    const lastPitch = Math.min(HIGHEST_PITCH, this.pitchAt(RULER_HEIGHT) + 1)
    const firstBeat = Math.max(0, Math.floor(this.beatAt(KEYS_WIDTH)))
    const lastBeat = Math.min(this.loop, Math.ceil(this.beatAt(width)))
    const loopEndX = this.screenX(this.loop)

    g.fillStyle = bg
    g.fillRect(0, 0, width, height)

    // Rows: black-key rows darker, like a piano keyboard turned sideways.
    for (let pitch = firstPitch; pitch <= lastPitch; pitch++) {
      g.fillStyle = BLACK_KEYS.has(pitch % 12) ? bg : surface
      g.fillRect(KEYS_WIDTH, this.screenY(pitch), loopEndX - KEYS_WIDTH, ROW_HEIGHT)
    }

    // Horizontal line under every C, to mark octaves.
    g.strokeStyle = border
    g.lineWidth = 1
    for (let pitch = firstPitch; pitch <= lastPitch; pitch++) {
      if (pitch % 12 !== 0) continue
      const y = this.screenY(pitch) + ROW_HEIGHT - 0.5
      line(g, KEYS_WIDTH, y, loopEndX, y)
    }

    // Vertical lines: every beat, stronger every bar. When zoomed far out,
    // beat lines would just be a grey blur, so only bars are drawn.
    const showBeats = this.beatWidth >= 10
    for (let beat = firstBeat; beat <= lastBeat; beat++) {
      const isBar = beat % 4 === 0
      if (!isBar && !showBeats) continue
      g.strokeStyle = isBar ? muted : border
      const x = Math.round(this.screenX(beat)) + 0.5
      line(g, x, RULER_HEIGHT, x, height)
    }

    // Notes.
    for (const note of this.song.notes) {
      if (note.pitch < firstPitch || note.pitch > lastPitch) continue
      if (note.startBeat + note.durationBeats < firstBeat || note.startBeat > lastBeat) continue
      const x = this.screenX(note.startBeat)
      const y = this.screenY(note.pitch)
      const w = note.durationBeats * this.beatWidth
      g.fillStyle = accent
      g.fillRect(x + 1, y + 1, Math.max(1, w - 2), ROW_HEIGHT - 2)
      if (w > 8) {
        g.fillStyle = bg // a darker strip marks the resize edge
        g.fillRect(x + w - 4, y + 3, 2, ROW_HEIGHT - 6)
      }
    }

    // Playhead.
    if (playhead !== null) {
      g.strokeStyle = text
      g.lineWidth = 2
      const x = Math.round(this.screenX(playhead)) + 0.5
      line(g, x, RULER_HEIGHT, x, height)
      g.lineWidth = 1
    }

    // Ruler with bar numbers, fixed at the top. Label every bar, or every
    // 2nd/4th/... when zoomed out so the numbers don't overlap.
    g.fillStyle = surface
    g.fillRect(0, 0, width, RULER_HEIGHT)
    g.fillStyle = border
    g.fillRect(0, RULER_HEIGHT - 1, width, 1)
    g.font = '600 10px Inter, system-ui, sans-serif'
    g.textBaseline = 'middle'
    g.fillStyle = muted
    let every = 1
    while (every * 4 * this.beatWidth < 28) every *= 2
    for (let bar = Math.floor(firstBeat / 4); bar * 4 < lastBeat; bar++) {
      if (bar % every !== 0) continue
      g.fillText(String(bar + 1), this.screenX(bar * 4) + 3, RULER_HEIGHT / 2)
    }

    // Keyboard column with C labels, fixed on the left (drawn last, on top).
    g.fillStyle = surface
    g.fillRect(0, RULER_HEIGHT, KEYS_WIDTH, height)
    for (let pitch = firstPitch; pitch <= lastPitch; pitch++) {
      const y = this.screenY(pitch)
      if (y + ROW_HEIGHT < RULER_HEIGHT) continue // hidden under the ruler
      if (BLACK_KEYS.has(pitch % 12)) {
        g.fillStyle = bg
        g.fillRect(0, y, KEYS_WIDTH * 0.6, ROW_HEIGHT)
      }
      if (pitch % 12 === 0) {
        g.fillStyle = muted
        g.fillText(noteName(pitch), KEYS_WIDTH * 0.62, y + ROW_HEIGHT / 2)
      }
    }
    g.fillStyle = surface // the corner above the keyboard
    g.fillRect(0, 0, KEYS_WIDTH, RULER_HEIGHT)
    g.fillStyle = border
    g.fillRect(KEYS_WIDTH - 1, 0, 1, height)
  }
}

function line(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  g.beginPath()
  g.moveTo(x1, y1)
  g.lineTo(x2, y2)
  g.stroke()
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
