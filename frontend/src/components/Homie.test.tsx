// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
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
