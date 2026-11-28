import type { Control } from './controls.ts'

// The common shape every module in the rack shares.
//
// Connection points are plain Web Audio objects:
//   - an output is an AudioNode (it produces a signal)
//   - an input is an AudioNode (audio goes in) or an AudioParam (the signal
//     modulates a parameter directly)
//
// Polyphony: a port carries one *channel* per voice, like a polyphonic cable
// in VCV Rack. A poly module (VCO, VCA, ...) builds one copy of its nodes per
// voice and exposes one node per channel; a mono module (LFO, Output) always
// has a single channel. When a cable connects ports with different channel
// counts, the patch decides how to wire them (see `channelPairs` in patch.ts):
// a mono output feeds every voice, and a mono input sums all voices.
//
// Control voltage (CV) convention: control signals are small numbers, roughly
// -1..1 (an LFO) or 0..1 (an envelope). Each module scales its CV inputs into
// sensible units, e.g. the VCO's pitch input treats 1.0 as one octave, like
// "1 volt per octave" on hardware synths. That way any modulator can be
// patched into any input and do something reasonable.

/** Anything a signal can be connected *into*. */
export type Input = AudioNode | AudioParam

/** Anything a signal can come *out of*. */
export type Output = AudioNode

/**
 * A port: the node (or param) for each channel.
 *
 * Generic over `T`, so `Port<Input>` holds inputs and `Port<Output>` holds
 * outputs, without writing two near-identical interfaces. The array is
 * replaced when the voice count changes.
 */
export interface Port<T> {
  channels: T[]
}

/**
 * A module in the rack.
 *
 * This is a *generic* interface: `In` and `Out` are type parameters, like
 * function parameters but for types. They name the module's ports, so a VCO is
 * a `SynthModule<'pitch', 'out'>` and TypeScript knows that `vco.outputs.out`
 * exists while `vco.outputs.foo` doesn't.
 *
 * `In extends string` is a constraint (port names must be strings), and
 * `= string` is a default, so a plain `SynthModule` means "any module".
 */
export interface SynthModule<In extends string = string, Out extends string = string> {
  /** Unique id, e.g. "vco-1". The patch model refers to modules by id. */
  readonly id: string
  /** Registry key, e.g. "vco" (see registry.ts). */
  readonly type: string
  /** Name shown on the panel. */
  readonly title: string
  /** `Record<K, V>` is the type of an object whose keys are K and values are V. */
  readonly inputs: Readonly<Record<In, Port<Input>>>
  readonly outputs: Readonly<Record<Out, Port<Output>>>
  readonly controls: readonly Control[]
  /**
   * Rebuild per-voice nodes for `count` voices. Mono modules ignore it.
   * Only the Patch calls this: it unplugs every cable first and replugs after.
   */
  setVoices(count: number): void
  /** Stop and disconnect everything. The module can't be used afterwards. */
  dispose(): void
}

/** A port with a single channel, for mono modules. */
export function monoPort<T>(node: T): Port<T> {
  return { channels: [node] }
}

// `AudioNode.connect` and `disconnect` each have one overload for nodes and
// one for params, so TypeScript needs to know which one we have. `instanceof`
// narrows the union type `Input` down to one of its members in each branch.

export function connectNodes(from: Output, to: Input): void {
  if (to instanceof AudioParam) {
    from.connect(to)
  } else {
    from.connect(to)
  }
}

export function disconnectNodes(from: Output, to: Input): void {
  if (to instanceof AudioParam) {
    from.disconnect(to)
  } else {
    from.disconnect(to)
  }
}

/** Build `count` items by calling `make(index)`: times(3, i => i * 2) is [0, 2, 4]. */
export function times<T>(count: number, make: (index: number) => T): T[] {
  return Array.from({ length: count }, (_, i) => make(i))
}

// Per-type counters for readable ids: "vco-1", "vco-2", "vca-1", ...
const counters = new Map<string, number>()

export function makeId(type: string): string {
  const n = (counters.get(type) ?? 0) + 1 // `??` = "use 0 if undefined"
  counters.set(type, n)
  return `${type}-${n}`
}
