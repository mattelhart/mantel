// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import * as pushEffects from './homiePush'
import { Homie, outingInterval } from './Homie'
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
  expect(host.querySelector('.homie-letter')).toBeNull()
  click(host.querySelector('.homie-friend')!)
  expect(host.querySelector('.homie-jump[data-jump="true"]')).toBeTruthy()
  expect(yard.getAttribute('data-hello')).toBe('true')
})

it('stays put during a dialog and strolls again after it closes', () => {
  vi.useFakeTimers()
  const host = mount(<><Homie /><dialog open>Editing</dialog></>)
  const yard = host.querySelector('.homie-yard')!
  act(() => vi.advanceTimersByTime(outingInterval))
  expect(yard.getAttribute('data-right')).toBe('false')
  host.querySelector('dialog')!.removeAttribute('open')
  act(() => vi.advanceTimersByTime(outingInterval))
  expect(yard.getAttribute('data-right')).toBe('true')
})

it('cycles through bike rides, plane throws, gardening and beetle chases', () => {
  vi.useFakeTimers()
  const host = mount(<Homie />)
  act(() => vi.advanceTimersByTime(outingInterval))
  expect(host.querySelector('.homie-bike')).toBeTruthy()
  act(() => vi.advanceTimersByTime(3400))
  expect(host.querySelector('.homie-bike')).toBeNull()
  act(() => vi.advanceTimersByTime(outingInterval - 3400))
  expect(host.querySelector('.homie-plane')).toBeTruthy()
  act(() => vi.advanceTimersByTime(3400))
  expect(host.querySelector('.homie-plane')).toBeNull()
  act(() => vi.advanceTimersByTime(outingInterval - 3400))
  expect(host.querySelector('.homie-sprout')).toBeTruthy()
  act(() => vi.advanceTimersByTime(3400))
  expect(host.querySelector('.homie-sprout')).toBeNull()
  act(() => vi.advanceTimersByTime(outingInterval - 3400))
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
  vi.spyOn(host.querySelector('.homie-friend')!, 'getBoundingClientRect').mockReturnValue(rect(120, 58))
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  Object.defineProperty(document, 'elementFromPoint', { value: () => main, configurable: true })
  try {
    act(() => vi.advanceTimersByTime(outingInterval))
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
  const host = mount(<Homie mailFrom="Sam" />)
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

it('welcomes alternating garden visitors and clears the visit on interaction', () => {
  vi.useFakeTimers()
  const host = mount(<Homie />)
  act(() => vi.advanceTimersByTime(5 * outingInterval))
  expect(host.querySelector('.homie-visitor')?.getAttribute('data-guest')).toBe('robin')
  act(() => { document.dispatchEvent(new Event('pointerdown')) })
  expect(host.querySelector('.homie-visitor')).toBeNull()
  act(() => vi.advanceTimersByTime(8 * outingInterval))
  expect(host.querySelector('.homie-visitor')?.getAttribute('data-guest')).toBe('neighbour')
  act(() => vi.advanceTimersByTime(5600))
  expect(host.querySelector('.homie-visitor')).toBeNull()
})

it('perches on a visible profile and leaves the profile action available', () => {
  vi.useFakeTimers()
  const select = vi.fn()
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  try {
    const host = mount(<><Homie /><button className="airy-avatar" onClick={select}>Dad</button></>)
    const profile = host.querySelector('.airy-avatar')!
    vi.spyOn(profile, 'getBoundingClientRect').mockReturnValue(new DOMRect(200, 60, 64, 60))
    act(() => vi.advanceTimersByTime(5 * outingInterval))
    const perch = document.querySelector<HTMLElement>('.homie-perch')!
    expect(perch.style.left).toBe('243px')
    expect(perch.querySelector('[data-guest="robin"]')).toBeTruthy()
    click(profile)
    expect(select).toHaveBeenCalledOnce()
    expect(document.querySelector('.homie-perch')).toBeNull()
  } finally { vi.unstubAllGlobals(); vi.restoreAllMocks() }
})

it('returns the borrowed digit on touch and straightens the letter when the visit ends', () => {
  vi.useFakeTimers()
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  try {
    const host = mount(<><Homie /><span data-homie-glyph="digit">7</span><span data-homie-glyph="letter">s</span></>)
    const [digit, letter] = host.querySelectorAll('[data-homie-glyph]')
    for (const el of [digit, letter]) vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(55, 45, 12, 20))
    for (let i = 0; i < 21; i++) act(() => vi.advanceTimersByTime(outingInterval))
    expect(digit.textContent).toBe('7')
    expect(digit.classList.contains('homie-glyph-away')).toBe(true)
    expect(document.querySelector('.homie-loose-glyph')?.textContent).toBe('7')
    click(digit)
    expect(digit.classList.contains('homie-glyph-away')).toBe(false)
    for (let i = 0; i < 8; i++) act(() => vi.advanceTimersByTime(outingInterval))
    expect(letter.classList.contains('homie-glyph-away')).toBe(true)
    act(() => vi.advanceTimersByTime(5600))
    expect(letter.classList.contains('homie-glyph-away')).toBe(false)
    expect(document.querySelector('.homie-glyph-scene')).toBeNull()
  } finally { vi.unstubAllGlobals(); vi.restoreAllMocks() }
})

it.each([true, false])('carries one letter on the actual gnome and restores it (interrupted: %s)', interrupted => {
  vi.useFakeTimers()
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  try {
    const host = mount(<><Homie /><span data-homie-glyph="letter">s</span></>)
    const letter = host.querySelector('[data-homie-glyph]')!
    vi.spyOn(letter, 'getBoundingClientRect').mockReturnValue(new DOMRect(55, 45, 12, 20))
    for (let i = 0; i < 5; i++) act(() => vi.advanceTimersByTime(outingInterval))
    vi.spyOn(host.querySelector('.homie-friend')!, 'getBoundingClientRect').mockReturnValue(new DOMRect(100,20,58,58))
    act(() => vi.advanceTimersByTime(outingInterval))
    expect(letter.classList.contains('homie-glyph-away')).toBe(false)
    act(() => vi.advanceTimersByTime(1700))
    expect(document.querySelector('.homie-gnome .homie-carried')?.textContent).toBe('s')
    expect(document.querySelectorAll('.homie-gnome')).toHaveLength(1)
    if (interrupted) click(letter)
    else act(() => vi.advanceTimersByTime(10000))
    expect(document.querySelector('.homie-carried')).toBeNull()
    expect(letter.classList.contains('homie-glyph-away')).toBe(false)
    expect(document.querySelector('.homie-glyph-scene')).toBeNull()
  } finally {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  }
})
