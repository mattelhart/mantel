import { describe, expect, it } from 'vitest'
import { directionalScore } from './navigation'

const origin = { left: 100, top: 100, width: 50, height: 50 }
describe('TV directional navigation', () => {
  it('never moves backwards or to itself', () => {
    expect(directionalScore(origin, origin, 'ArrowRight')).toBe(Infinity)
    expect(directionalScore(origin, { ...origin, left: 0 }, 'ArrowRight')).toBe(Infinity)
  })
  it('prefers a nearby aligned control over a diagonal one', () => {
    const aligned = directionalScore(origin, { ...origin, left: 200 }, 'ArrowRight')
    const diagonal = directionalScore(origin, { ...origin, left: 150, top: 200 }, 'ArrowRight')
    expect(aligned).toBeLessThan(diagonal)
  })
  it('handles all four directions', () => {
    expect(directionalScore(origin, { ...origin, top: 0 }, 'ArrowUp')).toBe(100)
    expect(directionalScore(origin, { ...origin, top: 200 }, 'ArrowDown')).toBe(100)
    expect(directionalScore(origin, { ...origin, left: 0 }, 'ArrowLeft')).toBe(100)
  })
})
