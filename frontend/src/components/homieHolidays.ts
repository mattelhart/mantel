import type { CalendarEvent } from '../api/types'

const annual: Record<string, string> = {
  '01-01': "New Year’s Day", '02-14': "Valentine’s Day", '03-17': "St. Patrick’s Day",
  '06-19': 'Juneteenth', '07-04': 'Independence Day', '10-31': 'Halloween',
  '11-11': 'Veterans Day', '12-24': 'Christmas Eve', '12-25': 'Christmas', '12-31': 'New Year’s Eve',
}
const weekdays: Record<string, string> = {
  '1-1-3': 'Martin Luther King Jr. Day', '2-1-3': 'Presidents’ Day', '5-0-2': 'Mother’s Day',
  '6-0-3': 'Father’s Day', '9-1-1': 'Labor Day', '10-1-2': 'Indigenous Peoples’ Day',
  '11-4-4': 'Thanksgiving',
}

export function holidaysOn(day: string, events: CalendarEvent[]) {
  const date = new Date(day + 'T12:00:00Z')
  const month = date.getUTCMonth() + 1, weekday = date.getUTCDay(), n = date.getUTCDate()
  const names = new Set<string>()
  for (const event of events) {
    if (!event.all_day || event.start_at.slice(0,10) > day || event.end_at.slice(0,10) <= day) continue
    if (/holiday|observance/i.test(event.calendar_name) || /#holiday\b/i.test(event.title + ' ' + (event.description ?? ''))) {
      const title = event.title.replace(/#holiday\b/ig, '').trim()
      if (title) names.add(title)
    }
  }
  const fallback = annual[day.slice(5)] ?? weekdays[[month, weekday, Math.ceil(n / 7)].join('-')]
    ?? (month === 5 && weekday === 1 && n >= 25 ? 'Memorial Day' : '')
  if (fallback && !Array.from(names).some(name => name.localeCompare(fallback, undefined, {sensitivity:'base',ignorePunctuation:true}) === 0)) names.add(fallback)
  return [...names]
}
