import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../../theme'
import { PASTEL_FOR, eventFill, soften } from './palette'

describe('eventFill', () => {
  it('leaves colours alone outside the airy theme', () => {
    expect(eventFill('#3b82f6', false)).toBe('#3b82f6')
  })

  it('maps each built-in person colour to a pastel with readable dark ink', () => {
    for (const [from, to] of Object.entries(PASTEL_FOR)) {
      expect(eventFill(from.toUpperCase(), true)).toBe(to)
      expect(contrastRatio('#0b1220', to), to).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('softens an unknown colour instead of painting it saturated', () => {
    expect(eventFill('#112233', true)).toBe(soften('#112233'))
    expect(eventFill('#112233', true)).not.toBe('#112233')
    expect(contrastRatio('#0b1220', soften('#000000'))).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#0b1220', soften('#112233'))).toBeGreaterThanOrEqual(4.5)
  })
})
