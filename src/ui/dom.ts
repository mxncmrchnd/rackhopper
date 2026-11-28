// Small DOM helpers.

/**
 * querySelector that throws instead of returning null.
 *
 * Generic: `mustFind<HTMLButtonElement>('#gate')` returns an HTMLButtonElement.
 * `T extends Element` means T can be any element type, but must be one.
 */
export function mustFind<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector)
  if (!element) throw new Error(`Element not found: ${selector}`)
  return element
}

/** Create an element with an optional class and text. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  // `HTMLElementTagNameMap` is a built-in type mapping tag names to element
  // types ('button' -> HTMLButtonElement, ...). Indexing it with K means
  // el('select') is typed as HTMLSelectElement.
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}
