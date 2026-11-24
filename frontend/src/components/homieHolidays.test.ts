import { expect, it } from 'vitest'
import type { CalendarEvent } from '../api/types'
import { holidaysOn } from './homieHolidays'

it('recognizes a moving holiday, custom observances and exclusive all-day ends', () => {
  const event = { all_day: true, calendar_name: 'Family', title: 'Lantern Night #holiday',
    start_at: '2026-11-25', end_at: '2026-11-27' } as CalendarEvent
  expect(holidaysOn('2026-11-26', [event])).toEqual(['Lantern Night', 'Thanksgiving'])
  expect(holidaysOn('2026-11-27', [event])).toEqual([])
  expect(holidaysOn('2026-11-25', [{ ...event, calendar_name: 'Holidays', title: 'Family Feast' }])).toEqual(['Family Feast'])
})
