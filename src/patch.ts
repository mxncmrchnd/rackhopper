import {
  connectNodes,
  disconnectNodes,
  type Input,
  type Output,
  type Port,
  type SynthModule,
} from './modules/synth-module.ts'

// The patch: which modules are in the rack, where they sit, and which cables
// connect them.
//
// Connections are stored as plain data (`{ from: { moduleId, port }, to: ... }`)
// rather than as references to audio nodes. That keeps the model easy to log,
// compare, and later save as JSON. The Patch keeps the live audio graph in sync
// with that data.

/** Size of the rack grid, in module slots. */
export const GRID = { cols: 10, rows: 4 }

/** A slot in the rack grid (0-based). */
export interface GridPosition {
  col: number
  row: number
}

/** One end of a cable: a named port on a module. */
export interface PortRef {
  moduleId: string
  port: string
}

/** A cable, always stored as output -> input. */
export interface Connection {
  from: PortRef
  to: PortRef
}

export class Patch {
  private readonly moduleMap = new Map<string, SynthModule>()
  private readonly positions = new Map<string, GridPosition>()
  private readonly connectionList: Connection[] = []
  private voiceCount = 1

  /** Modules in the order they were added. */
  get modules(): SynthModule[] {
    return [...this.moduleMap.values()]
  }

  /** `readonly Connection[]`: callers can read the list but not push to it. */
  get connections(): readonly Connection[] {
    return this.connectionList
  }

  get voices(): number {
    return this.voiceCount
  }

  /**
   * Add a module at a grid position and return it.
   *
   * Generic so the return type is the *same* type that was passed in:
   * `patch.add(new Vco(ctx), pos)` gives back a `Vco`, not just a `SynthModule`.
   */
  add<M extends SynthModule>(module: M, position: GridPosition): M {
    if (!this.isFree(position)) throw new Error(`Slot ${position.col},${position.row} is taken`)
    module.setVoices(this.voiceCount)
    this.moduleMap.set(module.id, module)
    this.positions.set(module.id, { ...position })
    return module
  }

  /** Unplug a module's cables, stop it, and take it out of the rack. */
  remove(moduleId: string): void {
    const module = this.module(moduleId)
    for (const c of this.connectionList.filter((c) => usesModule(c, moduleId))) {
      this.disconnect(c)
    }
    module.dispose()
    this.moduleMap.delete(moduleId)
    this.positions.delete(moduleId)
  }

  positionOf(moduleId: string): GridPosition {
    const position = this.positions.get(moduleId)
    if (!position) throw new Error(`No module "${moduleId}" in the patch`)
    return position
  }

  /** Is this slot inside the grid and empty? `ignore` lets a module "see through" itself while moving. */
  isFree(position: GridPosition, ignore?: string): boolean {
    const { col, row } = position
    if (col < 0 || row < 0 || col >= GRID.cols || row >= GRID.rows) return false
    for (const [id, p] of this.positions) {
      if (id !== ignore && p.col === col && p.row === row) return false
    }
    return true
  }

  /** First empty slot, row by row, or null if the rack is full. */
  firstFreeSlot(): GridPosition | null {
    for (let row = 0; row < GRID.rows; row++) {
      for (let col = 0; col < GRID.cols; col++) {
        if (this.isFree({ col, row })) return { col, row }
      }
    }
    return null
  }

  move(moduleId: string, position: GridPosition): boolean {
    if (!this.isFree(position, moduleId)) return false
    this.positions.set(moduleId, { ...position })
    return true
  }

  /**
   * Change the number of voices for every poly module.
   *
   * Modules rebuild their per-voice nodes, so every cable is unplugged first
   * (while the old nodes still exist) and plugged back in afterwards.
   */
  setVoices(count: number): void {
    for (const c of this.connectionList) this.wire(c, disconnectNodes)
    this.voiceCount = count
    for (const module of this.moduleMap.values()) module.setVoices(count)
    for (const c of this.connectionList) this.wire(c, connectNodes)
  }

  /**
   * Type-checked connect, for patches built in code.
   * `keyof S['outputs']` is "the names of S's outputs" (an indexed access type,
   * then keyof), so `patch.connect(vco, 'oops', vca, 'in')` won't compile.
   */
  connect<S extends SynthModule, D extends SynthModule>(
    source: S,
    outputName: keyof S['outputs'] & string,
    destination: D,
    inputName: keyof D['inputs'] & string,
  ): void {
    this.connectRefs(
      { moduleId: source.id, port: outputName },
      { moduleId: destination.id, port: inputName },
    )
  }

  /** Connect by ids and port names, e.g. from the UI. Ignores duplicates. */
  connectRefs(from: PortRef, to: PortRef): void {
    if (this.connectionList.some((c) => samePort(c.from, from) && samePort(c.to, to))) return
    // Copy just the two fields we want, so the stored data stays plain even if
    // the caller passed an object with extra properties.
    const connection: Connection = {
      from: { moduleId: from.moduleId, port: from.port },
      to: { moduleId: to.moduleId, port: to.port },
    }
    this.wire(connection, connectNodes)
    this.connectionList.push(connection)
  }

  disconnect(connection: Connection): void {
    const index = this.connectionList.indexOf(connection)
    if (index === -1) return
    this.wire(connection, disconnectNodes)
    this.connectionList.splice(index, 1)
  }

  /** Plain-data snapshot, handy for console.log (and, later, for saving). */
  toJSON(): object {
    return {
      voices: this.voiceCount,
      modules: this.modules.map((m) => ({ id: m.id, type: m.type, ...this.positionOf(m.id) })),
      connections: [...this.connectionList],
    }
  }

  /**
   * Connect (or disconnect) every channel pair of a cable.
   * `operation` is a function parameter: we pass connectNodes or disconnectNodes.
   */
  private wire(connection: Connection, operation: (from: Output, to: Input) => void): void {
    const outs = this.outputOf(connection.from).channels
    const ins = this.inputOf(connection.to).channels
    for (const [i, j] of channelPairs(outs.length, ins.length)) {
      operation(outs[i], ins[j])
    }
  }

  private module(id: string): SynthModule {
    const module = this.moduleMap.get(id)
    if (!module) throw new Error(`No module "${id}" in the patch`)
    return module
  }

  private outputOf(ref: PortRef): Port<Output> {
    // With string port names, TypeScript can't know the port exists, so check.
    const port: Port<Output> | undefined = this.module(ref.moduleId).outputs[ref.port]
    if (!port) throw new Error(`Module "${ref.moduleId}" has no output "${ref.port}"`)
    return port
  }

  private inputOf(ref: PortRef): Port<Input> {
    const port: Port<Input> | undefined = this.module(ref.moduleId).inputs[ref.port]
    if (!port) throw new Error(`Module "${ref.moduleId}" has no input "${ref.port}"`)
    return port
  }
}

/**
 * Which output channel goes to which input channel, as [out, in] index pairs:
 *   - mono output -> every input channel (one LFO moves all voices)
 *   - poly output -> mono input: every channel into it (the Output mixes voices)
 *   - poly -> poly: channel by channel
 */
export function channelPairs(outCount: number, inCount: number): [number, number][] {
  if (outCount === 1) return Array.from({ length: inCount }, (_, j) => [0, j])
  if (inCount === 1) return Array.from({ length: outCount }, (_, i) => [i, 0])
  return Array.from({ length: Math.min(outCount, inCount) }, (_, i) => [i, i])
}

export function samePort(a: PortRef, b: PortRef): boolean {
  return a.moduleId === b.moduleId && a.port === b.port
}

function usesModule(c: Connection, moduleId: string): boolean {
  return c.from.moduleId === moduleId || c.to.moduleId === moduleId
}
