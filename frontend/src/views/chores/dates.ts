/** Calendar-day arithmetic that does not consult the browser's timezone.

The board's `on` is a household date (`YYYY-MM-DD`). Adding a day with
`Date` in local time would skip or repeat a date for anyone off UTC.
 */

export function shiftDay(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function weekdayLabel(index: number): string {
  return WEEKDAYS[index] ?? ''
}

/** A heading for a `YYYY-MM-DD` board date. Formatted in UTC so the weekday
 *  matches the date string rather than the machine the browser is on. */
export function formatBoardDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const dt = new Date(Date.UTC(y, m - 1, d))
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(dt)
}
