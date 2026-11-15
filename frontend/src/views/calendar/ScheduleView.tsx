import { format, isToday } from 'date-fns'
import type { CalendarEvent } from '../../api/types'
import { useEventColor } from '../../components/eventColor'
import { overlapsDay } from './overlap'

/** Agenda for a fortnight: one row per day, events as full-width pastel pills.
 *  This is the Schedule control on the segmented switcher. */
export function ScheduleView({
  days,
  events,
  use24h,
  onSelectEvent,
  onSelectSlot,
}: {
  days: Date[]
  events: CalendarEvent[]
  use24h: boolean
  onSelectEvent: (e: CalendarEvent) => void
  onSelectSlot: (start: Date) => void
}) {
  const fill = useEventColor()

  return (
    <div className="schedule">
      {days.map((day) => {
        const mine = events
          .filter((e) => overlapsDay(e, day))
          .sort((a, b) => {
            if (a.all_day !== b.all_day) return a.all_day ? -1 : 1
            return a.start_at.localeCompare(b.start_at)
          })
        return (
          <section key={day.toISOString()} className="schedule__day" data-today={isToday(day)}>
            <button
              type="button"
              className="schedule__date"
              data-today={isToday(day)}
              onClick={() => onSelectSlot(atNine(day))}
              aria-label={`Add event on ${format(day, 'EEEE, MMMM d')}`}
            >
              <span className="timegrid__dayname">{format(day, 'EEE')}</span>
              <span className="timegrid__daynum">{format(day, 'd')}</span>
            </button>
            <div className="schedule__events">
              {mine.length === 0 && <p className="schedule__empty">Nothing planned</p>}
              {mine.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className="schedule__event"
                  style={{ background: fill(e.color) }}
                  onClick={() => onSelectEvent(e)}
                >
                  <span className="schedule__time">
                    {e.all_day ? 'All day' : format(new Date(e.start_at), use24h ? 'H:mm' : 'h:mm a')}
                  </span>
                  <span className="schedule__title">{e.title}</span>
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function atNine(day: Date): Date {
  const d = new Date(day)
  d.setHours(9, 0, 0, 0)
  return d
}
