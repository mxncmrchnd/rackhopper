// Knobs and switches on a module's front panel, described as plain data.
//
// Modules list their controls; the UI (src/ui/controls.ts) turns each one into
// a knob, a slider or a dropdown. The module doesn't know anything about the
// DOM, and the UI doesn't know anything about the module's audio nodes: they
// meet at get/set.
//
// `Control` is a *discriminated union*: several object types that share one
// property (`kind`) with a different literal value in each. Checking `kind`
// tells TypeScript which member you have:
//
//   if (control.kind === 'slider') {
//     control.min // OK: TypeScript now knows it's a SliderControl
//   }

/** A continuous value. Drawn as a knob or a slider, depending on the UI setting. */
export interface SliderControl {
  kind: 'slider'
  /** Stable name for saving, e.g. 'cutoff'. Unlike `label`, it never gets translated. */
  id: string
  label: string
  min: number
  max: number
  /** If set, values are rounded to multiples of this (e.g. 1 for whole numbers). */
  step?: number
  /**
   * 'linear': equal moves add equal amounts.
   * 'log': equal moves multiply by equal amounts. Right for frequencies
   * and times, where 20 -> 40 Hz matters as much as 2000 -> 4000 Hz.
   * Needs `min` > 0.
   */
  scale: 'linear' | 'log'
  /** For ranges centred on zero (e.g. -15..+15 dB): the knob's arc starts from the top. */
  bipolar?: boolean
  format: (value: number) => string
  get: () => number
  set: (value: number) => void
}

export interface SelectControl {
  kind: 'select'
  id: string
  label: string
  options: readonly string[]
  get: () => string
  set: (value: string) => void
}

/**
 * A display rather than an input: an oscilloscope screen. It has no value to
 * set or save; the UI just asks for fresh samples on every animation frame.
 */
export interface ScopeControl {
  kind: 'scope'
  id: string
  label: string
  sampleRate: number
  /** The latest samples, oldest first. */
  samples: () => Float32Array
  /** How much time to show, in seconds. */
  window: () => number
  /** The screen shows -range..+range vertically. */
  range: () => number
}

export type Control = SliderControl | SelectControl | ScopeControl

/** The controls that hold a value (and get saved): everything except displays. */
export type ValueControl = SliderControl | SelectControl

/** Type predicate: narrows a Control to a ValueControl, e.g. in `controls.filter(isValueControl)`. */
export function isValueControl(control: Control): control is ValueControl {
  return control.kind !== 'scope'
}

export const WAVEFORMS: readonly OscillatorType[] = ['sine', 'triangle', 'sawtooth', 'square']

// Value formatters for readouts.
export const format = {
  hz: (v: number): string => (v < 1000 ? `${v.toPrecision(3)} Hz` : `${(v / 1000).toPrecision(3)} kHz`),
  seconds: (v: number): string => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`),
  percent: (v: number): string => `${Math.round(v * 100)} %`,
  octaves: (v: number): string => `${v.toFixed(1)} oct`,
  cents: (v: number): string => `${Math.round(v)} ct`,
  number: (v: number): string => v.toPrecision(2),
  integer: (v: number): string => String(Math.round(v)),
  bpm: (v: number): string => `${Math.round(v)} BPM`,
  // Signed, so boosts read "+3.0 dB". (-0.04 rounds to "-0.0", hence the fix-up.)
  db: (v: number): string => `${v > 0 ? '+' : ''}${v.toFixed(1).replace('-0.0', '0.0')} dB`,
  ratio: (v: number): string => `${v.toFixed(1)}:1`,
}
