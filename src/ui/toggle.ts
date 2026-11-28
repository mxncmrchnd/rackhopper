import { el } from './dom.ts'

// A two-way (or more) segmented toggle that shows every option at once, with
// the active one highlighted:  [ moon | sun ]   [ FR | EN ]
//
// Built as a radio group for screen readers: each segment is a button with
// role="radio" and aria-checked. Clicking a segment selects it.

export interface ToggleOption<T extends string> {
  value: T
  /** Accessible name (also the tooltip), e.g. "Dark theme". A function, so it can follow the language. */
  label: () => string
  /** What's drawn: plain text ("FR") or an SVG icon (markup from ICONS below). */
  content: string
  /** True if `content` is SVG markup rather than text. */
  icon?: boolean
}

/**
 * A *generic class*: `T` is the union of allowed values, e.g. 'dark' | 'light'.
 * The constructor infers it from the options, so `onChange` receives a T, and
 * `toggle.value = 'blue'` would be a compile error.
 */
export class SegmentedToggle<T extends string> {
  readonly element: HTMLElement
  private readonly options: readonly ToggleOption<T>[]
  private readonly groupLabel: () => string
  private readonly buttons: HTMLButtonElement[]
  private current: T

  constructor(
    options: readonly ToggleOption<T>[],
    initial: T,
    groupLabel: () => string,
    onChange: (value: T) => void,
  ) {
    this.options = options
    this.current = initial
    this.groupLabel = groupLabel
    this.element = el('div', 'segmented')
    this.element.setAttribute('role', 'radiogroup')

    this.buttons = options.map((option) => {
      const button = el('button')
      button.type = 'button'
      button.setAttribute('role', 'radio')
      if (option.icon) {
        // Safe: `content` is one of our own constant SVG strings, never user input.
        button.innerHTML = option.content
      } else {
        button.textContent = option.content
      }
      button.addEventListener('click', () => {
        if (option.value === this.current) return
        this.value = option.value
        onChange(option.value)
      })
      return button
    })
    this.element.append(...this.buttons)
    this.refresh()
  }

  get value(): T {
    return this.current
  }

  set value(value: T) {
    this.current = value
    this.refresh()
  }

  /** Update the highlight and the (translated) labels. */
  refresh(): void {
    this.element.setAttribute('aria-label', this.groupLabel())
    this.options.forEach((option, i) => {
      const button = this.buttons[i]
      button.setAttribute('aria-checked', String(option.value === this.current))
      button.setAttribute('aria-label', option.label())
      button.title = option.label()
    })
  }
}

// Small line icons, 16x16, drawn with the current text colour.
const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

export const ICONS = {
  moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  sun: svg(
    '<circle cx="12" cy="12" r="4"/>' +
      '<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  ),
  // A horizontal slider: track with a filled part and a thumb.
  slider: svg(
    '<path d="M3 12h18" opacity="0.45"/>' +
      '<path d="M3 12h8"/>' +
      '<rect x="10" y="7.5" width="4" height="9" rx="1.5" fill="currentColor"/>',
  ),
  // A knob: an open arc (the travel) around a dial with a pointer.
  knob: svg(
    '<path d="M6.3 18.4A8.5 8.5 0 1 1 17.7 18.4" opacity="0.45"/>' +
      '<circle cx="12" cy="12" r="4.5"/>' +
      '<path d="M12 12l2.6-2.6"/>',
  ),
}
