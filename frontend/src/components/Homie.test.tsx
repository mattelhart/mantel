// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import * as pushEffects from './homiePush'
import { Homie } from './Homie'
import { click, mount, unmount } from './testDom'

afterEach(() => {
  unmount()
  vi.useRealTimers()
})

it('greets taps without consuming the family control and rests again', () => {
  vi.useFakeTimers()
  const select = vi.fn()
  const host = mount(<><Homie /><button onClick={select}>Dad</button></>)
  const yard = host.querySelector('.homie-yard')!
  click(host.querySelectorAll('button')[1])
  expect(select).toHaveBeenCalledOnce()
  expect(yard.getAttribute('data-hello')).toBe('true')
  act(() => vi.advanceTimersByTime(1800))
  expect(yard.getAttribute('data-hello')).toBe('false')
  click(host.querySelector('.homie-friend')!)
  expect(yard.getAttribute('data-hello')).toBe('true')
})

it('stays put during a dialog and strolls again after it closes', () => {
  vi.useFakeTimers()
  const host = mount(<><Homie /><dialog open>Editing</dialog></>)
  const yard = host.querySelector('.homie-yard')!
  act(() => vi.advanceTimersByTime(75000))
  expect(yard.getAttribute('data-right')).toBe('false')
  host.querySelector('dialog')!.removeAttribute('open')
  act(() => vi.advanceTimersByTime(75000))
  expect(yard.getAttribute('data-right')).toBe('true')
})

it('cycles through bike rides, plane throws, gardening and beetle chases', () => {
  vi.useFakeTimers()
  const host = mount(<Homie />)
  act(() => vi.advanceTimersByTime(75000))
  expect(host.querySelector('.homie-bike')).toBeTruthy()
  act(() => vi.advanceTimersByTime(3400))
  expect(host.querySelector('.homie-bike')).toBeNull()
  act(() => vi.advanceTimersByTime(71600))
  expect(host.querySelector('.homie-plane')).toBeTruthy()
  act(() => vi.advanceTimersByTime(3400))
  expect(host.querySelector('.homie-plane')).toBeNull()
  act(() => vi.advanceTimersByTime(71600))
  expect(host.querySelector('.homie-sprout')).toBeTruthy()
  act(() => vi.advanceTimersByTime(3400))
  expect(host.querySelector('.homie-sprout')).toBeNull()
  act(() => vi.advanceTimersByTime(71600))
  expect(host.querySelector('.homie-beetle')).toBeTruthy()
  act(() => vi.advanceTimersByTime(3400))
  expect(host.querySelector('.homie-beetle')).toBeNull()
})

it('visits an open patch and retreats on the first pointer press without consuming it', () => {
  vi.useFakeTimers()
  const select = vi.fn()
  const host = mount(<><Homie /><main><button onPointerDown={select} /></main></>)
  const rect = (width: number, height: number) => new DOMRect(0, 0, width, height)
  const main = host.querySelector('main')!
  vi.spyOn(main, 'getBoundingClientRect').mockReturnValue(rect(600, 400))
  vi.spyOn(host.querySelector('.homie-dock')!, 'getBoundingClientRect').mockReturnValue(rect(120, 58))
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  Object.defineProperty(document, 'elementFromPoint', { value: () => main, configurable: true })
  try {
    act(() => vi.advanceTimersByTime(75000))
    expect(document.querySelector('[data-away="true"]')).toBeTruthy()
    act(() => main.querySelector('button')!.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(select).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-retreat="true"]')).toBeTruthy()
    act(() => vi.advanceTimersByTime(280))
    expect(host.querySelector('.homie-friend')).toBeTruthy()
  } finally {
    Reflect.deleteProperty(document, 'elementFromPoint')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  }
})

it('drops one envelope after a hard push and retrieves it before returning home', () => {
  vi.useFakeTimers()
  const host = mount(<Homie />)
  const watch = vi.spyOn(pushEffects, 'watchForPush').mockImplementation((_button, react) => {
    react({ kind: 'roll', direction: 'right' }, new DOMRect(20, 20, 58, 58))
    return () => {}
  })
  try {
    act(() => { document.dispatchEvent(new Event('pointerdown')) })
    expect(document.querySelector('.homie-dropped-letter')).toBeTruthy()
    expect(document.querySelector('.homie-grumble')).toBeTruthy()
    act(() => vi.advanceTimersByTime(1200))
    expect(document.querySelector('.homie-dropped-letter')).toBeTruthy()
    act(() => vi.advanceTimersByTime(800))
    expect(document.querySelector('.homie-dropped-letter')).toBeNull()
    expect(host.querySelector('.homie-hand .homie-letter')).toBeTruthy()
  } finally {
    watch.mockRestore()
  }
})
