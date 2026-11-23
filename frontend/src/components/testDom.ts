import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactNode } from 'react'

/** Minimal DOM test helpers (no testing-library dependency). Import only from jsdom tests. */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null

export function mount(node: ReactNode): HTMLElement {
  unmount()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(node))
  return host
}

export function unmount() {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
}

export function pointer(target: Element, type: 'pointerdown' | 'pointerup' | 'pointercancel', x = 10, y = 10, id = 1) {
  act(() => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, clientX: x, clientY: y }))
  })
}

/** A finger tap: down and up (no click -- the browser sends none when the finger slid). */
export function tapPointer(target: Element, slide = 0) {
  pointer(target, 'pointerdown', 10, 10)
  pointer(target, 'pointerup', 10 + slide, 10)
}

export function click(target: Element) {
  act(() => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

export function key(k: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  })
}

export function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const set = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  act(() => {
    set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

export const byText = (text: string, scope: ParentNode = document) =>
  Array.from(scope.querySelectorAll<HTMLElement>('button')).find((b) => b.textContent?.trim() === text)

export async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}
