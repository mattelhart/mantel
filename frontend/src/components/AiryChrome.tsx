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
  { to: '/dashboard', label: 'Today', icon: 'today' },
  { to: '/chores', label: 'Chores', icon: 'chores' },
  { to: '/lists', label: 'Lists', icon: 'lists' },
  { to: '/home', label: 'Home', icon: 'home' },
  { to: '/photos', label: 'Photos', icon: 'photos' },
  { to: '/games', label: 'Games', icon: 'games' },
  { to: '/cameras', label: 'Cameras', icon: 'cameras' },
  { to: '/meals', label: 'Meals', icon: 'meals' },
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
    case 'today':
      // A sun, so Today never reads as a second Calendar button.
      return (
        <>
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" />
        </>
      )
    case 'meals':
      return (
        <>
          <path d="M7 3.5v17M4.5 3.5v5a2.5 2.5 0 0 0 5 0v-5" />
          <path d="M17 20.5v-17c-2.2 1.2-3.5 3.6-3.5 6.5v4h3.5" />
        </>
      )
    case 'sleep':
      return <path d="M20 14.5A7.5 7.5 0 1 1 9.5 4 6 6 0 0 0 20 14.5z" />
    case 'games':
      return (
        <>
          <rect x="3.5" y="8" width="17" height="12" rx="3" />
          <circle cx="8.5" cy="14" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="15.5" cy="14" r="1.2" fill="currentColor" stroke="none" />
          <path d="M9.5 14h5M8.5 11v6M15.5 12.5v3" />
        </>
      )
    case 'cameras':
      return (
        <>
          <path d="M4 9.5h3l1.6-2h6.8l1.6 2H20a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 20.5H4A1.5 1.5 0 0 1 2.5 19v-8A1.5 1.5 0 0 1 4 9.5z" />
          <circle cx="12" cy="15" r="3.2" />
        </>
      )
    default:
      // Settings: sliders, so it can't be mistaken for Today's sun.
      return (
        <>
          <path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1" />
          <circle cx="15" cy="6.5" r="2" />
          <circle cx="9" cy="12" r="2" />
          <circle cx="17" cy="17.5" r="2" />
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
