import type { Control, SelectControl, SliderControl } from '../modules/controls.ts'
import { t, tDynamic } from '../i18n.ts'
import { el } from './dom.ts'

/** A control's label in the current language, looked up by its stable id. */
function labelOf(control: Control): string {
  return tDynamic(`control.${control.id}`, control.label)
}

// Turns a module's Control descriptions into DOM elements.
// A SliderControl is drawn as a knob or as a slider, depending on the style
// picked in the top bar. Both work the same way: double-click resets to the
// starting value, arrow keys nudge (hold Shift for bigger steps).

/** A *string literal union* type: only these two strings are allowed. */
export type ControlStyle = 'knob' | 'slider'

export function renderControl(control: Control, style: ControlStyle): HTMLElement {
  // Switching on the discriminant (`kind`) narrows `control` in each case.
  switch (control.kind) {
    case 'slider': // control is a SliderControl here
      return style === 'knob' ? renderKnob(control) : renderSlider(control)
    case 'select': // ...and a SelectControl here
      return renderSelect(control)
    default: {
      // Exhaustiveness check: if a new kind is added to the Control union and
      // not handled above, `control` isn't `never` any more and this line
      // stops compiling, pointing you to the switch that needs updating.
      const unhandled: never = control
      throw new Error(`Unknown control: ${JSON.stringify(unhandled)}`)
    }
  }
}

// --- Value <-> position -------------------------------------------------------

// Knobs and sliders work on a "unit" position from 0 to 1; these map it to the
// control's real value, taking 'log' scales and steps into account.

function toUnit(c: SliderControl, value: number): number {
  const t =
    c.scale === 'log'
      ? Math.log(value / c.min) / Math.log(c.max / c.min)
      : (value - c.min) / (c.max - c.min)
  return clamp(t, 0, 1)
}

function fromUnit(c: SliderControl, t: number): number {
  const value = c.scale === 'log' ? c.min * (c.max / c.min) ** t : c.min + (c.max - c.min) * t
  return c.step ? Math.round(value / c.step) * c.step : value
}

// The value each control had when first drawn, for double-click reset.
// A WeakMap holds its keys "weakly": entries vanish when the control object
// is garbage-collected (e.g. after its module is removed), so it can't leak.
const defaults = new WeakMap<SliderControl, number>()

function rememberDefault(c: SliderControl): number {
  const existing = defaults.get(c)
  if (existing !== undefined) return existing
  const value = c.get()
  defaults.set(c, value)
  return value
}

/** Shared keyboard handling: returns the new unit position, or null to ignore the key. */
function nudge(event: KeyboardEvent, t: number): number | null {
  const step = event.shiftKey ? 0.1 : 0.01
  switch (event.key) {
    case 'ArrowUp':
    case 'ArrowRight':
      return clamp(t + step, 0, 1)
    case 'ArrowDown':
    case 'ArrowLeft':
      return clamp(t - step, 0, 1)
    case 'Home':
      return 0
    case 'End':
      return 1
    default:
      return null
  }
}

// --- Typing a value -----------------------------------------------------------

// Right-click on a knob or slider swaps its readout for a text box. The value
// can be typed with or without a unit: "350 ms", "0.35 s", "1.2k", "440 Hz",
// "60 %". Without a unit, it's read in the unit currently shown, so typing
// "350" into an attack showing "200 ms" means 350 ms. A comma works as the
// decimal separator too ("1,5").

/** How many base units one of each typed unit is worth. `Record<string, number>` = any string key. */
const UNIT_FACTORS: Record<string, number> = {
  '': 1,
  ms: 0.001,
  s: 1,
  hz: 1,
  k: 1000,
  khz: 1000,
  '%': 0.01,
  ct: 1,
  oct: 1,
  bpm: 1,
}

/** The unit at the end of a formatted value: "200 ms" -> "ms", "0.25" -> "". */
function unitOf(formatted: string): string {
  // `?.` and `??`: no match -> undefined -> ''.
  return /[a-z%]+\s*$/i.exec(formatted)?.[0].trim().toLowerCase() ?? ''
}

/** Parse typed text into a value for `control`, or null if it doesn't make sense. */
export function parseValue(text: string, control: SliderControl): number | null {
  // A number (optional minus, "." or "," decimals), then an optional unit.
  const match = /^\s*(-?\d*[.,]?\d+)\s*([a-z%]*)\s*$/i.exec(text)
  if (!match) return null
  const number = parseFloat(match[1].replace(',', '.'))
  const unit = match[2].toLowerCase() || unitOf(control.format(control.get()))
  // Indexing a Record with an unknown key gives undefined at runtime, but
  // TypeScript types it as plain `number`; the annotation makes us check.
  const factor: number | undefined = UNIT_FACTORS[unit]
  if (factor === undefined) return null
  const value = clamp(number * factor, control.min, control.max)
  return control.step ? Math.round(value / control.step) * control.step : value
}

/**
 * Replace `readout` with a text box until Enter (apply), Escape (cancel), or
 * clicking elsewhere (apply). `refresh` redraws the control afterwards.
 */
function typeValue(control: SliderControl, readout: HTMLElement, refresh: () => void): void {
  const input = el('input', 'value-input')
  input.type = 'text'
  input.value = control.format(control.get())
  input.setAttribute('aria-label', t('control.valueOf', { label: labelOf(control) }))
  readout.replaceWith(input)
  input.focus()
  input.select()

  let finished = false // guards against finishing twice (Enter, then the blur it causes)
  const finish = (apply: boolean): void => {
    if (finished) return
    finished = true
    if (apply) {
      const value = parseValue(input.value, control)
      if (value !== null) control.set(value) // nonsense input is just ignored
    }
    input.replaceWith(readout)
    refresh()
  }
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') finish(true)
    else if (event.key === 'Escape') finish(false)
  })
  input.addEventListener('blur', () => finish(true))
}

// --- Knob ---------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg'
const KNOB_SIZE = 40
const SWEEP = 135 // degrees either side of straight up
const DRAG_PIXELS = 150 // vertical drag distance for the full range (x10 with Shift)

function renderKnob(control: SliderControl): HTMLElement {
  const initial = rememberDefault(control)
  const wrapper = el('div', 'knob')
  const output = el('output')

  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', `0 0 ${KNOB_SIZE} ${KNOB_SIZE}`)
  svg.setAttribute('width', String(KNOB_SIZE))
  svg.setAttribute('height', String(KNOB_SIZE))
  // Screen readers announce it as a slider; tabindex makes it focusable.
  svg.setAttribute('role', 'slider')
  svg.setAttribute('tabindex', '0')
  svg.setAttribute('aria-label', labelOf(control))
  svg.setAttribute('aria-valuemin', '0')
  svg.setAttribute('aria-valuemax', '100')
  const tooltip = document.createElementNS(SVG_NS, 'title') // SVG's version of the title attribute
  tooltip.textContent = t('control.knobHint')

  const track = svgEl('path', 'knob-track')
  const value = svgEl('path', 'knob-value')
  const body = svgEl('circle', 'knob-body')
  body.setAttribute('cx', '20')
  body.setAttribute('cy', '20')
  body.setAttribute('r', '11')
  const pointer = svgEl('line', 'knob-pointer')
  track.setAttribute('d', arc(-SWEEP, SWEEP))
  svg.append(tooltip, track, value, body, pointer)

  const redraw = (): void => {
    const t = toUnit(control, control.get())
    const angle = -SWEEP + t * 2 * SWEEP
    value.setAttribute('d', arc(-SWEEP, angle))
    const inner = polar(angle, 4)
    const outer = polar(angle, 10)
    pointer.setAttribute('x1', String(inner.x))
    pointer.setAttribute('y1', String(inner.y))
    pointer.setAttribute('x2', String(outer.x))
    pointer.setAttribute('y2', String(outer.y))
    output.textContent = control.format(control.get())
    svg.setAttribute('aria-valuenow', String(Math.round(t * 100)))
    svg.setAttribute('aria-valuetext', control.format(control.get()))
  }
  const setUnit = (t: number): void => {
    control.set(fromUnit(control, t))
    redraw()
  }

  // Drag up/down to turn. We track the drag from where it started, not
  // incrementally, so the knob doesn't drift when values get rounded to steps.
  let dragStart: { y: number; t: number } | null = null
  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return // right-click is for typing a value
    svg.setPointerCapture(event.pointerId)
    dragStart = { y: event.clientY, t: toUnit(control, control.get()) }
    event.preventDefault() // no text selection while dragging
    svg.focus()
  })
  svg.addEventListener('pointermove', (event) => {
    if (!dragStart) return
    const pixels = event.shiftKey ? DRAG_PIXELS * 10 : DRAG_PIXELS
    setUnit(clamp(dragStart.t + (dragStart.y - event.clientY) / pixels, 0, 1))
  })
  const endDrag = (): void => {
    dragStart = null
  }
  svg.addEventListener('pointerup', endDrag)
  svg.addEventListener('pointercancel', endDrag)
  svg.addEventListener('dblclick', () => {
    control.set(initial)
    redraw()
  })
  svg.addEventListener('contextmenu', (event) => {
    event.preventDefault() // our text box instead of the browser's menu
    typeValue(control, output, redraw)
  })
  svg.addEventListener('keydown', (event) => {
    const t = nudge(event, toUnit(control, control.get()))
    if (t === null) return
    event.preventDefault()
    setUnit(t)
  })

  redraw()
  wrapper.append(el('span', 'control-label', labelOf(control)), svg, output)
  return wrapper
}

/** Point at `angle` degrees (0 = up, clockwise) and `radius` from the knob centre. */
function polar(angle: number, radius: number): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180
  return { x: 20 + radius * Math.sin(rad), y: 20 - radius * Math.cos(rad) }
}

/** SVG path for a circular arc from angle a0 to a1 (degrees), radius 16. */
function arc(a0: number, a1: number): string {
  if (a1 - a0 < 0.5) return '' // too short to draw
  const start = polar(a0, 16)
  const end = polar(a1, 16)
  const largeArc = a1 - a0 > 180 ? 1 : 0
  return `M ${start.x} ${start.y} A 16 16 0 ${largeArc} 1 ${end.x} ${end.y}`
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, className: string): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag)
  element.classList.add(className)
  return element
}

// --- Slider -------------------------------------------------------------------

const SLIDER_STEPS = 1000

function renderSlider(control: SliderControl): HTMLElement {
  const initial = rememberDefault(control)
  const label = el('label', 'slider')
  const output = el('output', '', control.format(control.get()))
  const input = el('input')
  input.type = 'range'
  input.min = '0'
  input.max = String(SLIDER_STEPS)

  const sync = (): void => {
    input.value = String(Math.round(toUnit(control, control.get()) * SLIDER_STEPS))
    output.textContent = control.format(control.get())
  }
  input.addEventListener('input', () => {
    control.set(fromUnit(control, input.valueAsNumber / SLIDER_STEPS))
    output.textContent = control.format(control.get())
  })
  input.addEventListener('dblclick', () => {
    control.set(initial)
    sync()
  })
  label.addEventListener('contextmenu', (event) => {
    // The text box's own right-click (e.g. to paste) keeps the browser menu.
    if (event.target instanceof HTMLInputElement && event.target.type === 'text') return
    event.preventDefault()
    typeValue(control, output, sync)
  })
  input.title = t('control.sliderHint')
  sync()
  label.append(el('span', 'control-label', labelOf(control)), output, input)
  return label
}

// --- Select -------------------------------------------------------------------

function renderSelect(control: SelectControl): HTMLElement {
  const label = el('label', 'select')
  const select = el('select')
  for (const option of control.options) {
    // new Option(text shown, value): the value stays e.g. 'sawtooth', only the text is translated.
    select.append(new Option(tDynamic(`option.${option}`, option), option))
  }
  select.value = control.get()
  select.addEventListener('change', () => control.set(select.value))
  label.append(el('span', 'control-label', labelOf(control)), select)
  return label
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
