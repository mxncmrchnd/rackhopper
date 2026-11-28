import type { SynthModule } from '../modules/synth-module.ts'
import { GRID, samePort, type GridPosition, type Patch, type PortRef } from '../patch.ts'
import { t, tDynamic } from '../i18n.ts'
import { renderControl, type ControlStyle } from './controls.ts'
import { el } from './dom.ts'

// The rack view: a grid of module panels, plus an SVG layer on top for cables.
//
// Modules:
//   - drag a module by its title bar to move it to another empty slot
//   - the x button removes it (and unplugs its cables)
//
// Cables:
//   - drag from an output jack to an input jack (or the other way) to add a cable
//   - drag from an input jack that has a cable to pick that cable up; drop it on
//     another input to move it, or anywhere else to remove it

type Direction = 'in' | 'out'

/** A jack on the panel: a port plus which side of the module it's on. */
// `extends` on an interface copies in all the fields of PortRef.
interface JackRef extends PortRef {
  dir: Direction
}

interface Point {
  x: number
  y: number
}

/**
 * What the current pointer press is dragging: a discriminated union again.
 * One `drag` field with two variants is tidier than two nullable fields that
 * must never both be set.
 */
type Drag =
  | {
      kind: 'cable'
      /** The plugged-in end; the other end follows the pointer. */
      fixed: JackRef
      pointer: Point
    }
  | {
      kind: 'module'
      moduleId: string
      panel: HTMLElement
      /** Pointer position when the drag started. */
      start: Point
      /** Where in the panel it was grabbed, relative to the panel's corner. */
      grab: Point
      /** The slot it would land in, or null if outside the grid. */
      target: GridPosition | null
    }

const SVG_NS = 'http://www.w3.org/2000/svg'

export class RackView {
  /** Called after the user removes a module. */
  onModuleRemoved: (module: SynthModule) => void = () => {}

  private readonly container: HTMLElement
  private readonly patch: Patch
  private readonly svg: SVGSVGElement
  private readonly ghost: HTMLElement // highlights the target slot while moving a module
  private controlStyle: ControlStyle
  private drag: Drag | null = null

  constructor(container: HTMLElement, patch: Patch, controlStyle: ControlStyle) {
    this.container = container
    this.patch = patch
    this.controlStyle = controlStyle

    container.style.setProperty('--cols', String(GRID.cols))
    container.style.setProperty('--rows', String(GRID.rows))
    this.svg = document.createElementNS(SVG_NS, 'svg')
    this.svg.classList.add('cables')
    this.ghost = el('div', 'slot-ghost')
    this.ghost.hidden = true
    this.refresh()

    // One set of listeners on the container handles every jack and title bar
    // ("event delegation").
    container.addEventListener('pointerdown', (e) => this.onPointerDown(e))
    container.addEventListener('pointermove', (e) => this.onPointerMove(e))
    container.addEventListener('pointerup', (e) => this.onPointerUp(e))
    container.addEventListener('pointercancel', () => this.cancelDrag())
    container.addEventListener('click', (e) => this.onClick(e))

    // Jack positions change when the web font finishes loading.
    new ResizeObserver(() => this.drawCables()).observe(container)
    void document.fonts.ready.then(() => this.drawCables())
  }

  /** Switch between knobs and sliders (redraws every panel). */
  setControlStyle(style: ControlStyle): void {
    this.controlStyle = style
    this.refresh()
  }

  /** Show a module that was just added to the patch. */
  addPanel(module: SynthModule): void {
    this.container.insertBefore(this.renderPanel(module), this.ghost)
    this.drawCables()
  }

  /** Redraw every panel and cable from the patch (e.g. after loading a project). */
  refresh(): void {
    this.container.replaceChildren(...this.patch.modules.map((m) => this.renderPanel(m)))
    this.container.append(this.ghost, this.svg)
    this.drawCables()
  }

  // --- Pointer handling -------------------------------------------------------

  private onPointerDown(event: PointerEvent): void {
    const target = event.target
    if (!(target instanceof Element)) return

    const jack = jackAt(target)
    if (jack) {
      this.startCableDrag(jack, event)
      return
    }
    // Title bar (but not its remove button): move the module.
    const header = target.closest('.module-header')
    const panel = target.closest<HTMLElement>('.module')
    if (header && panel && !target.closest('button')) {
      this.startModuleDrag(panel, event)
    }
  }

  private startCableDrag(jack: JackRef, event: PointerEvent): void {
    event.preventDefault()
    let fixed = jack
    if (jack.dir === 'in') {
      // Pulling on a patched input picks up its most recent cable.
      const existing = this.patch.connections.findLast((c) => samePort(c.to, jack))
      if (existing) {
        this.patch.disconnect(existing)
        fixed = { ...existing.from, dir: 'out' }
      }
    }
    this.drag = { kind: 'cable', fixed, pointer: this.toLocal(event) }
    // Keep getting pointer events even when the pointer leaves the container.
    this.container.setPointerCapture(event.pointerId)
    this.drawCables()
  }

  private startModuleDrag(panel: HTMLElement, event: PointerEvent): void {
    const moduleId = panel.dataset.moduleId
    if (!moduleId) return
    event.preventDefault()
    const pointer = this.toLocal(event)
    const corner = this.toLocal({
      clientX: panel.getBoundingClientRect().left,
      clientY: panel.getBoundingClientRect().top,
    })
    this.drag = {
      kind: 'module',
      moduleId,
      panel,
      start: pointer,
      grab: { x: pointer.x - corner.x, y: pointer.y - corner.y },
      target: null,
    }
    panel.classList.add('lifted')
    this.container.setPointerCapture(event.pointerId)
  }

  private onPointerMove(event: PointerEvent): void {
    const drag = this.drag
    if (!drag) return
    const pointer = this.toLocal(event)

    if (drag.kind === 'cable') {
      drag.pointer = pointer
    } else {
      // The panel follows the pointer (CSS `translate` doesn't disturb the grid)...
      drag.panel.style.translate = `${pointer.x - drag.start.x}px ${pointer.y - drag.start.y}px`
      // ...and the ghost shows the slot it would drop into.
      drag.target = this.slotAt(pointer.x - drag.grab.x, pointer.y - drag.grab.y, drag.panel)
      if (drag.target) {
        placeInGrid(this.ghost, drag.target)
        this.ghost.classList.toggle('blocked', !this.patch.isFree(drag.target, drag.moduleId))
      }
      this.ghost.hidden = drag.target === null
    }
    this.drawCables()
  }

  private onPointerUp(event: PointerEvent): void {
    const drag = this.drag
    if (!drag) return

    if (drag.kind === 'cable') {
      // What's under the pointer? (The cable layer ignores pointer events, so
      // this finds the jack underneath, not the cable being dragged.)
      const target = jackAt(document.elementFromPoint(event.clientX, event.clientY))
      const { fixed } = drag
      if (target && target.dir !== fixed.dir) {
        // Cables are always stored output -> input, whichever end was dragged.
        const [from, to] = fixed.dir === 'out' ? [fixed, target] : [target, fixed]
        this.patch.connectRefs(from, to)
      }
    } else if (drag.target && this.patch.move(drag.moduleId, drag.target)) {
      placeInGrid(drag.panel, drag.target)
    }
    // Firefox has no Web Audio graph inspector, so log the patch model instead.
    console.log('patch:', this.patch.toJSON())
    this.cancelDrag()
  }

  private cancelDrag(): void {
    if (this.drag?.kind === 'module') {
      this.drag.panel.style.translate = ''
      this.drag.panel.classList.remove('lifted')
    }
    this.drag = null
    this.ghost.hidden = true
    this.drawCables()
  }

  private onClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return
    const button = event.target.closest<HTMLElement>('.module-remove')
    const panel = button?.closest<HTMLElement>('.module')
    const moduleId = panel?.dataset.moduleId
    if (!panel || !moduleId) return
    const module = this.patch.modules.find((m) => m.id === moduleId)
    if (!module) return
    this.patch.remove(moduleId)
    panel.remove()
    this.drawCables()
    this.onModuleRemoved(module)
    console.log('patch:', this.patch.toJSON())
  }

  /** The grid slot whose corner is nearest to (x, y), or null if outside the grid. */
  private slotAt(x: number, y: number, panel: HTMLElement): GridPosition | null {
    const style = getComputedStyle(this.container)
    // offsetWidth/offsetHeight ignore the drag `translate`, so they give the slot size.
    const stepX = panel.offsetWidth + parseFloat(style.columnGap)
    const stepY = panel.offsetHeight + parseFloat(style.rowGap)
    const col = Math.round((x - parseFloat(style.paddingLeft)) / stepX)
    const row = Math.round((y - parseFloat(style.paddingTop)) / stepY)
    if (col < 0 || row < 0 || col >= GRID.cols || row >= GRID.rows) return null
    return { col, row }
  }

  // --- Cables -----------------------------------------------------------------

  /** Redraw every cable from the patch model. */
  private drawCables(): void {
    this.svg.replaceChildren()

    for (const c of this.patch.connections) {
      const a = this.jackCenter({ ...c.from, dir: 'out' })
      const b = this.jackCenter({ ...c.to, dir: 'in' })
      if (a && b) this.svg.append(cable(a, b))
    }

    if (this.drag?.kind === 'cable') {
      const a = this.jackCenter(this.drag.fixed)
      if (a) this.svg.append(cable(a, this.drag.pointer, 'dragging'))
    }

    // Mark jacks that have a cable plugged in.
    for (const jackEl of this.container.querySelectorAll<HTMLElement>('.jack')) {
      const jack = jackAt(jackEl)
      const patched =
        jack !== null &&
        this.patch.connections.some((c) => samePort(jack.dir === 'out' ? c.from : c.to, jack))
      jackEl.classList.toggle('patched', patched)
    }
  }

  /** Center of a jack's hole, relative to the container. */
  private jackCenter(jack: JackRef): Point | null {
    const hole = this.container.querySelector(
      `.jack[data-module="${jack.moduleId}"][data-port="${jack.port}"][data-dir="${jack.dir}"] .jack-hole`,
    )
    if (!hole) return null
    const r = hole.getBoundingClientRect()
    return this.toLocal({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })
  }

  /** Viewport coordinates -> coordinates relative to the container. */
  // `Pick<PointerEvent, 'clientX' | 'clientY'>` is a utility type: an object with
  // just those two properties. A real PointerEvent fits, and so does a plain
  // `{ clientX, clientY }` object.
  private toLocal(p: Pick<PointerEvent, 'clientX' | 'clientY'>): Point {
    const origin = this.container.getBoundingClientRect()
    return { x: p.clientX - origin.left, y: p.clientY - origin.top }
  }

  // --- Panels -----------------------------------------------------------------

  private renderPanel(module: SynthModule): HTMLElement {
    const panel = el('section', 'module')
    panel.dataset.moduleId = module.id
    placeInGrid(panel, this.patch.positionOf(module.id))

    // Translated title, looked up by module type (falls back to the module's own title).
    const title = tDynamic(`module.${module.type}`, module.title)
    const header = el('header', 'module-header')
    const remove = el('button', 'module-remove', '×')
    remove.type = 'button'
    remove.title = t('rack.remove', { name: title })
    remove.setAttribute('aria-label', remove.title)
    header.append(el('h2', '', title), remove)

    const controls = el('div', `controls controls-${this.controlStyle}`)
    controls.append(...module.controls.map((c) => renderControl(c, this.controlStyle)))

    const inputs = el('div', 'jacks-group')
    inputs.append(...Object.keys(module.inputs).map((port) => renderJack(module.id, port, 'in')))
    const outputs = el('div', 'jacks-group')
    outputs.append(...Object.keys(module.outputs).map((port) => renderJack(module.id, port, 'out')))
    const jacks = el('div', 'jacks')
    jacks.append(inputs, outputs)

    panel.append(header, controls, jacks)
    return panel
  }
}

/** Put an element in a grid slot (CSS grid lines are numbered from 1). */
function placeInGrid(element: HTMLElement, position: GridPosition): void {
  element.style.gridColumn = String(position.col + 1)
  element.style.gridRow = String(position.row + 1)
}

/** Find the jack an element belongs to, if any, from its data-* attributes. */
function jackAt(target: EventTarget | null): JackRef | null {
  if (!(target instanceof Element)) return null
  const jackEl = target.closest<HTMLElement>('.jack')
  if (!jackEl) return null
  const { module, port, dir } = jackEl.dataset
  if (!module || !port || (dir !== 'in' && dir !== 'out')) return null
  return { moduleId: module, port, dir }
}

function renderJack(moduleId: string, port: string, dir: Direction): HTMLElement {
  const jack = el('div', 'jack')
  jack.dataset.module = moduleId
  jack.dataset.port = port
  jack.dataset.dir = dir
  jack.title = t(dir === 'in' ? 'jack.input' : 'jack.output', { port })
  jack.append(el('span', 'jack-hole'), el('span', 'jack-label', port))
  return jack
}

/** An SVG cable from a to b that sags under its own weight. */
function cable(a: Point, b: Point, extraClass?: string): SVGGElement {
  const sag = 30 + Math.hypot(b.x - a.x, b.y - a.y) * 0.25
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', `M ${a.x} ${a.y} C ${a.x} ${a.y + sag}, ${b.x} ${b.y + sag}, ${b.x} ${b.y}`)

  const group = document.createElementNS(SVG_NS, 'g')
  group.classList.add('cable')
  if (extraClass) group.classList.add(extraClass)
  group.append(path, plug(a), plug(b))
  return group
}

function plug(p: Point): SVGCircleElement {
  const circle = document.createElementNS(SVG_NS, 'circle')
  circle.setAttribute('cx', String(p.x))
  circle.setAttribute('cy', String(p.y))
  circle.setAttribute('r', '6')
  return circle
}
