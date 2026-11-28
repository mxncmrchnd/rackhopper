import { LocalizedError } from './i18n.ts'
import { isValueControl } from './modules/controls.ts'
import { MAX_BARS, type Note, type Song } from './notes.ts'
import type { Connection, Patch, PortRef } from './patch.ts'

// Saving and loading: the whole project as plain JSON.
//
// The same format is used for the three places a project can live:
//   - localStorage (autosave, restored when the page is reloaded)
//   - a .json file (Save / Open)
//   - the URL hash (Share link), compressed so the link stays short
//
// Saved modules keep the id they had ("vco-1"), but loading builds new modules
// with fresh ids, so connections are remapped from old ids to new ones.
//
// Versions:
//   1: the first format (the loop was always 4 bars)
//   2: adds `bars`, the loop length
// Older versions are upgraded when loaded ("migrated"); see parseProject.

export const PROJECT_FORMAT = 'rackhopper'
export const PROJECT_VERSION = 2

/** A control value: a number for knobs/sliders, a string for dropdowns. */
export type ControlValue = number | string

export interface SavedModule {
  id: string
  type: string
  col: number
  row: number
  /** Control values by control id, e.g. { cutoff: 1200, type: 'lowpass' }. */
  controls: Record<string, ControlValue>
}

export interface SavedProject {
  format: typeof PROJECT_FORMAT // `typeof` on a const: the literal type 'rackhopper'
  version: typeof PROJECT_VERSION
  voices: number
  modules: SavedModule[]
  connections: Connection[]
  notes: Note[]
  bars: number
}

/** Snapshot the current project as plain data. */
export function serializeProject(patch: Patch, song: Song): SavedProject {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    voices: patch.voices,
    modules: patch.modules.map((m) => ({
      id: m.id,
      type: m.type,
      ...patch.positionOf(m.id),
      // Object.fromEntries turns [key, value] pairs into an object.
      // Displays (the oscilloscope screen) have nothing to save, so skip them.
      controls: Object.fromEntries(m.controls.filter(isValueControl).map((c) => [c.id, c.get()])),
    })),
    connections: patch.connections.map((c) => ({ from: { ...c.from }, to: { ...c.to } })),
    notes: song.notes.map((n) => ({ ...n })),
    bars: song.bars,
  }
}

// --- Validation -----------------------------------------------------------------
//
// A file or link can contain anything, so loaded JSON is typed `unknown`, not
// `any`. `any` switches type checking off; `unknown` means "could be anything,
// prove what it is before using it". The type guards below do that proving:
// each one checks at runtime, and tells TypeScript what it found.

/** Thrown for a file or link that isn't a valid project (with a translatable message). */
export class ProjectError extends LocalizedError {}

// `v is Record<string, unknown>`: a type predicate. When it returns true,
// TypeScript lets us read properties of `v`.
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isNonNegativeInteger(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0
}

function isPortRef(v: unknown): v is PortRef {
  return isRecord(v) && typeof v.moduleId === 'string' && typeof v.port === 'string'
}

function parseModule(v: unknown): SavedModule {
  if (
    !isRecord(v) ||
    typeof v.id !== 'string' ||
    typeof v.type !== 'string' ||
    !isNonNegativeInteger(v.col) ||
    !isNonNegativeInteger(v.row) ||
    !isRecord(v.controls)
  ) {
    throw new ProjectError('error.module')
  }
  // Keep only control values of the right kinds; drop anything else.
  const controls: Record<string, ControlValue> = {}
  for (const [key, value] of Object.entries(v.controls)) {
    if (isFiniteNumber(value) || typeof value === 'string') controls[key] = value
  }
  return { id: v.id, type: v.type, col: v.col, row: v.row, controls }
}

function parseConnection(v: unknown): Connection {
  if (!isRecord(v) || !isPortRef(v.from) || !isPortRef(v.to)) {
    throw new ProjectError('error.connection')
  }
  return {
    from: { moduleId: v.from.moduleId, port: v.from.port },
    to: { moduleId: v.to.moduleId, port: v.to.port },
  }
}

function parseNote(v: unknown): Note {
  if (
    !isRecord(v) ||
    !isFiniteNumber(v.pitch) ||
    !isFiniteNumber(v.startBeat) ||
    !isFiniteNumber(v.durationBeats) ||
    !isFiniteNumber(v.velocity) ||
    v.durationBeats <= 0
  ) {
    throw new ProjectError('error.note')
  }
  return {
    pitch: Math.round(v.pitch),
    startBeat: Math.max(0, v.startBeat),
    durationBeats: v.durationBeats,
    velocity: Math.min(1, Math.max(0, v.velocity)),
  }
}

/** Check that `data` is a project we can load, and return a clean copy of it. */
export function parseProject(data: unknown): SavedProject {
  if (!isRecord(data) || data.format !== PROJECT_FORMAT) {
    throw new ProjectError('error.notProject')
  }
  if (data.version !== 1 && data.version !== PROJECT_VERSION) {
    throw new ProjectError('error.version', { version: String(data.version) })
  }
  if (!Number.isInteger(data.voices) || (data.voices as number) < 1 || (data.voices as number) > 8) {
    throw new ProjectError('error.voices')
  }
  if (!Array.isArray(data.modules) || !Array.isArray(data.connections) || !Array.isArray(data.notes)) {
    throw new ProjectError('error.missing')
  }
  // Migration: version 1 had no `bars`; its loop was always 4 bars long.
  const bars = data.version === 1 ? 4 : data.bars
  if (!Number.isInteger(bars) || (bars as number) < 1 || (bars as number) > MAX_BARS) {
    throw new ProjectError('error.bars')
  }
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION, // whatever was loaded, it's now in the current format
    voices: data.voices as number,
    modules: data.modules.map(parseModule),
    connections: data.connections.map(parseConnection),
    notes: data.notes.map(parseNote),
    bars: bars as number,
  }
}

// --- Share links ------------------------------------------------------------------
//
// The project JSON is compressed with the browser's built-in CompressionStream
// (no library needed), then written as base64url (base64 with - and _ instead
// of + and /, which are awkward in URLs). A typical project becomes a link of a
// couple of thousand characters.

const HASH_PREFIX = '#p='

/** "#p=..." for this project. */
export async function projectToHash(project: SavedProject): Promise<string> {
  const stream = new Blob([JSON.stringify(project)])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  return HASH_PREFIX + toBase64Url(bytes)
}

/** The project in a URL hash, null if the hash isn't a project link. Throws if it's a broken one. */
export async function projectFromHash(hash: string): Promise<SavedProject | null> {
  if (!hash.startsWith(HASH_PREFIX)) return null
  try {
    const bytes = fromBase64Url(hash.slice(HASH_PREFIX.length))
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    const text = await new Response(stream).text()
    return parseProject(JSON.parse(text))
  } catch (error) {
    if (error instanceof ProjectError) throw error
    throw new ProjectError('error.damagedLink')
  }
}

function toBase64Url(bytes: Uint8Array): string {
  // btoa works on "binary strings" (one character per byte), so build one first.
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}
