import { format, isToday } from 'date-fns'
import type { CalendarEvent } from '../../api/types'
import { useEventColor } from '../../components/eventColor'
import { overlapsDay } from './overlap'

interface Props {
  days: Date[]
  events: CalendarEvent[]
  use24h: boolean
  onSelectEvent: (event: CalendarEvent) => void
  onSelectSlot: (date: Date) => void
}

export function WeekCardsView({ days, events, use24h, onSelectEvent, onSelectSlot }: Props) {
  const fill = useEventColor()
  return (
    <div className="week-cards">
      {days.map((day) => {
        const items = events.filter((event) => overlapsDay(event, day)).sort((a, b) =>
          Number(b.all_day) - Number(a.all_day) || a.start_at.localeCompare(b.start_at))
        return (
          <section className="week-cards__day" key={day.toISOString()} data-today={isToday(day)}>
            <header className="week-cards__heading">
              <span>{format(day, 'EEE')}</span>
              <strong aria-current={isToday(day) ? 'date' : undefined}>{format(day, 'd')}</strong>
            </header>
            <div className="week-cards__events">
              {items.map((event) => (
                <button key={event.id} className="week-cards__event" onClick={() => onSelectEvent(event)}
                  style={{ background: fill(event.color), borderLeftColor: event.color }}>
                  <span>{event.all_day ? 'All day' : format(new Date(event.start_at), use24h ? 'H:mm' : 'h:mm a')}</span>
                  <strong>{event.title}</strong>
                  {event.location && <small>{event.location}</small>}
                </button>
              ))}
              {items.length === 0 && <p className="week-cards__empty">Nothing planned</p>}
              <button className="week-cards__add" aria-label={`Add event on ${format(day, 'EEEE, MMMM d')}`}
                onClick={() => { const start = new Date(day); start.setHours(9, 0, 0, 0); onSelectSlot(start) }}>+</button>
            </div>
          </section>
        )
      })}
    </div>
  )
}
