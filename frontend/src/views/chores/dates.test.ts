import { describe, expect, it } from 'vitest'
import { formatBoardDay, shiftDay, weekdayLabel } from './dates'

describe('shiftDay', () => {
  it('steps a calendar date without borrowing the browser timezone', () => {
    expect(shiftDay('2026-11-15', 1)).toBe('2026-11-16')
    expect(shiftDay('2026-11-15', -1)).toBe('2026-11-14')
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('leaves a nonsense value alone', () => {
    expect(shiftDay('tomorrow', 1)).toBe('tomorrow')
  })
})

describe('formatBoardDay', () => {
  it('names the weekday of the date itself', () => {
    // 15 Nov 2026 is a Sunday. A browser west of UTC must not call it Saturday.
    expect(formatBoardDay('2026-11-15')).toBe('Sunday, November 15')
  })
})

describe('weekdayLabel', () => {
  it('numbers Sunday as 0, matching the API', () => {
    expect(weekdayLabel(0)).toBe('Sun')
    expect(weekdayLabel(1)).toBe('Mon')
  })
})
