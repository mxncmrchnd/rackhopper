import { tDynamic } from '../i18n.ts'
import type { ScopeControl } from '../modules/controls.ts'
import { el } from './dom.ts'

// The oscilloscope screen: a small canvas redrawn on every animation frame.
//
// Triggering: to keep a repeating wave still instead of scrolling, each frame
// starts drawing at the most recent point where the signal crosses zero going
// up. If there's no such point (silence, a slow envelope), it just shows the
// latest samples.

const HEIGHT = 80 // CSS pixels

export function renderScope(control: ScopeControl): HTMLElement {
  const wrapper = el('div', 'scope')
  const canvas = el('canvas')
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', tDynamic(`control.${control.id}`, control.label))
  wrapper.append(canvas)

  const g = canvas.getContext('2d')
  if (!g) return wrapper

  // Stop animating once the panel is removed (module deleted, or panels
  // redrawn). `wasConnected` avoids stopping on the very first frame if it
  // happens to run before the panel is added to the page.
  let wasConnected = false
  const frame = (): void => {
    if (canvas.isConnected) {
      wasConnected = true
      draw(canvas, g, control)
    } else if (wasConnected) {
      return
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  return wrapper
}

function draw(canvas: HTMLCanvasElement, g: CanvasRenderingContext2D, control: ScopeControl): void {
  // Match the canvas bitmap to its displayed size (sharp on high-DPI screens).
  const dpr = window.devicePixelRatio || 1
  const width = canvas.clientWidth
  if (width === 0) return // not laid out yet
  if (canvas.width !== Math.round(width * dpr)) {
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(HEIGHT * dpr)
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0)

  const css = getComputedStyle(canvas)
  const color = (name: string): string => css.getPropertyValue(name).trim()

  // Which samples to show.
  const data = control.samples()
  const count = Math.min(Math.floor(data.length / 2), Math.round(control.window() * control.sampleRate))
  let start = data.length - count
  for (let i = start; i > 0; i--) {
    if (data[i - 1] < 0 && data[i] >= 0) {
      start = i
      break
    }
  }

  // Background and grid: centre line, and lines at half range.
  const range = control.range()
  const yOf = (v: number): number => HEIGHT / 2 - (v / range) * (HEIGHT / 2)
  g.fillStyle = color('--bg')
  g.fillRect(0, 0, width, HEIGHT)
  g.strokeStyle = color('--border')
  g.lineWidth = 1
  for (const v of [-range / 2, 0, range / 2]) {
    const y = Math.round(yOf(v)) + 0.5
    g.beginPath()
    g.moveTo(0, y)
    g.lineTo(width, y)
    g.stroke()
  }

  // The trace, and the highest and lowest values along the way.
  let min = Infinity
  let max = -Infinity
  g.strokeStyle = color('--accent')
  g.lineWidth = 1.5
  g.beginPath()
  for (let i = 0; i < count; i++) {
    const v = data[start + i]
    min = Math.min(min, v)
    max = Math.max(max, v)
    const x = (i / (count - 1)) * width
    if (i === 0) g.moveTo(x, yOf(v))
    else g.lineTo(x, yOf(v))
  }
  g.stroke()

  // Readouts: max/min top-left, the range top-right. Arrows instead of words,
  // so there's nothing to translate.
  g.font = '600 9px Inter, system-ui, sans-serif'
  g.textBaseline = 'top'
  g.fillStyle = color('--text-muted')
  g.textAlign = 'left'
  g.fillText(`↑${max.toFixed(2)}  ↓${min.toFixed(2)}`, 4, 3)
  g.textAlign = 'right'
  g.fillText(`±${range.toPrecision(2)}`, width - 4, 3)
}
