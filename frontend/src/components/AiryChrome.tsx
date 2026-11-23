import { format } from 'date-fns'
import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useSettings, useUsers, useWeather } from '../api/hooks'
import { personFilterApplies, usePersonFilter } from '../hooks/usePersonFilter'
import { useEventColor } from './eventColor'

/** Ask the screensaver to come forward. The same control Skylight puts on the
 *  rail: one tap and the display rests on photos, or a dim clock. */
export function showScreensaver(): void {
  window.dispatchEvent(new Event('mantel:show-saver'))
}

export function AiryBar({
  bookmark,
  bookmarkText,
}: {
  bookmark: string | null
  bookmarkText: string
}) {
  const { pathname } = useLocation()
  const { data: settings } = useSettings()
  const { data: weather } = useWeather()
  const { data: users = [] } = useUsers()
  const { toggle, showEveryone, isVisible, anyHidden } = usePersonFilter()
  const fill = useEventColor()
  const showPeople = personFilterApplies(pathname)
  const now = useClock()
  const time = format(now, settings?.time_format_24h ? 'H:mm' : 'h:mm a')
  const current = weather?.current
  const showWeather =
    settings?.weather_enabled !== false && weather?.available && current?.temp != null

  return (
    <header className="airybar">
      <div className="airybar__when">
        <div className="airybar__date">{format(now, 'EEEE, MMMM d')}</div>
        <div className="airybar__meta">
          <span className="airybar__time">{time}</span>
          {showWeather && (
            <span className="airybar__wx" title={current?.short ?? undefined}>
              <span aria-hidden>{weatherGlyph(current?.short, current?.is_daytime)}</span>
              <span>
                {Math.round(current?.temp ?? 0)}°
              </span>
            </span>
          )}
        </div>
      </div>
      {bookmark && (
        <a className="airybar__bookmark" href={bookmark} rel="noreferrer">
          {bookmarkText}
        </a>
      )}
      <div className="airybar__spacer" />
      {showPeople && users.length > 0 && (
        <div className="airybar__people" role="group" aria-label="Family">
          {users.map((u) => {
            const shown = isVisible(u.id)
            const letter = u.name.trim().charAt(0).toUpperCase() || '?'
            return (
              <button
                key={u.id}
                type="button"
                className="airy-avatar"
                data-off={!shown}
                aria-pressed={shown}
                aria-label={shown ? `Hide ${u.name}'s events` : `Show ${u.name}'s events`}
                style={{ background: fill(u.color) }}
                onClick={() => toggle(u.id)}
              >
                <span aria-hidden>{u.avatar_emoji || letter}</span>
                <span className="airy-avatar__name">{u.name}</span>
              </button>
            )
          })}
          {anyHidden && (
            <button type="button" className="airybar__everyone" onClick={showEveryone}>
              Everyone
            </button>
          )}
        </div>
      )}
    </header>
  )
}

const NAV = [
  { to: '/dashboard', label: 'Today', icon: 'calendar' },
  { to: '/chores', label: 'Chores', icon: 'chores' },
  { to: '/lists', label: 'Lists', icon: 'lists' },
  { to: '/home', label: 'Home', icon: 'home' },
  { to: '/photos', label: 'Photos', icon: 'photos' },
  { to: '/meals', label: 'Meals', icon: 'lists' },
  { to: '/show-on-tv', label: 'Show on TV', icon: 'calendar' },
] as const

export function AiryNav({ onCalendar }: { onCalendar: boolean }) {
  const { pathname } = useLocation()
  // Tapping Calendar should not throw you back to Week when you were on Month.
  const calendarTo = pathname.startsWith('/calendar') ? pathname : '/calendar/week'

  return (
    <>
      <NavLink
        to={calendarTo}
        className="navbtn"
        aria-current={onCalendar ? 'page' : undefined}
      >
        <NavIcon name="calendar" />
        <span className="navbtn__label">Calendar</span>
      </NavLink>
      {NAV.map((item) => (
        <NavLink key={item.to} to={item.to} className="navbtn">
          <NavIcon name={item.icon} />
          <span className="navbtn__label">{item.label}</span>
        </NavLink>
      ))}
      <button type="button" className="navbtn" onClick={showScreensaver}>
        <NavIcon name="sleep" />
        <span className="navbtn__label">Sleep</span>
      </button>
      <NavLink to="/settings" className="navbtn">
        <NavIcon name="settings" />
        <span className="navbtn__label">Settings</span>
      </NavLink>
    </>
  )
}

function NavIcon({ name }: { name: string }) {
  return (
    <svg className="navbtn__icon" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      {paths(name)}
    </svg>
  )
}

function paths(name: string): ReactNode {
  switch (name) {
    case 'calendar':
      return (
        <>
          <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
          <path d="M3.5 10h17M8 3.5V7M16 3.5V7" />
        </>
      )
    case 'chores':
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M8.5 12.2l2.2 2.2 4.8-5" />
        </>
      )
    case 'lists':
      return (
        <>
          <path d="M9 7h11M9 12h11M9 17h11" />
          <circle cx="5" cy="7" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="5" cy="17" r="1.2" fill="currentColor" stroke="none" />
        </>
      )
    case 'photos':
      return (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <circle cx="9" cy="10" r="1.4" fill="currentColor" stroke="none" />
          <path d="M21 16.5l-5-4.5L7 19" />
        </>
      )
    case 'home':
      return (
        <>
          <path d="M4 11.2L12 4l8 7.2" />
          <path d="M6 10v9.5h12V10" />
          <path d="M10 19.5v-5h4v5" />
        </>
      )
    case 'sleep':
      return <path d="M20 14.5A7.5 7.5 0 1 1 9.5 4 6 6 0 0 0 20 14.5z" />
    default:
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
        </>
      )
  }
}

function useClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

function weatherGlyph(short: string | null | undefined, daytime = true): string {
  const t = (short ?? '').toLowerCase()
  if (t.includes('thunder')) return '⛈️'
  if (t.includes('snow') || t.includes('flurr')) return '🌨️'
  if (t.includes('sleet') || t.includes('freezing')) return '🧊'
  if (t.includes('rain') || t.includes('shower') || t.includes('drizzle')) return '🌧️'
  if (t.includes('fog') || t.includes('haze') || t.includes('mist')) return '🌫️'
  if (t.includes('wind')) return '💨'
  if (t.includes('cloud') || t.includes('overcast')) return '☁️'
  if (t.includes('partly')) return daytime ? '⛅' : '☁️'
  if (t.includes('clear') || t.includes('sunny') || t.includes('fair')) return daytime ? '☀️' : '🌙'
  return daytime ? '🌤️' : '🌙'
}
