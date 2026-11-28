import type { Note } from '../notes.ts'
import { Adsr } from './adsr.ts'
import { Filter } from './filter.ts'
import { Lfo } from './lfo.ts'
import { Output } from './output.ts'
import { Sequencer } from './sequencer.ts'
import type { SynthModule } from './synth-module.ts'
import { Vca } from './vca.ts'
import { Vco } from './vco.ts'

// Every module type, by name. Used by the "Add module" menu, and later by
// save/load to rebuild modules from their saved type name.

/** What a module needs to be built. */
export interface ModuleEnv {
  ctx: BaseAudioContext
  notes: Note[]
}

export interface ModuleInfo {
  title: string
  /** Only one allowed in the rack. */
  singleton?: boolean
  create: (env: ModuleEnv) => SynthModule
}

// `satisfies` checks that the object matches `Record<string, ModuleInfo>`
// *without* changing its inferred type. So TypeScript still knows the exact
// keys ('sequencer' | 'vco' | ...), which `ModuleType` below relies on. With a
// plain type annotation (`: Record<string, ModuleInfo>`), the keys would widen
// to just `string`.
export const MODULE_TYPES = {
  sequencer: {
    title: 'Sequencer',
    singleton: true,
    create: ({ ctx, notes }) => new Sequencer(ctx, notes),
  },
  vco: { title: 'VCO', create: ({ ctx }) => new Vco(ctx) },
  lfo: { title: 'LFO', create: ({ ctx }) => new Lfo(ctx) },
  filter: { title: 'Filter', create: ({ ctx }) => new Filter(ctx) },
  vca: { title: 'VCA', create: ({ ctx }) => new Vca(ctx) },
  adsr: { title: 'ADSR', create: ({ ctx }) => new Adsr(ctx) },
  output: { title: 'Output', create: ({ ctx }) => new Output(ctx) },
} satisfies Record<string, ModuleInfo>

/** 'sequencer' | 'vco' | 'lfo' | ... : derived from the object's keys. */
export type ModuleType = keyof typeof MODULE_TYPES

/** Narrow an arbitrary string (e.g. from a <select>) to a ModuleType. */
// `type is ModuleType` is a *type predicate*: when this returns true,
// TypeScript treats the argument as a ModuleType from then on.
export function isModuleType(type: string): type is ModuleType {
  return Object.hasOwn(MODULE_TYPES, type)
}
