import { useDisplayReceiver } from './HouseholdDisplay'
import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ApiError } from './api/client'
import { useSettings } from './api/hooks'
import { AiryBar, AiryNav } from './components/AiryChrome'
import { AuthGate } from './components/AuthGate'
import { bookmarkLabel, safeBookmarkUrl } from './components/bookmark'
import { EventColorProvider } from './components/eventColor'
import { Screensaver } from './components/Screensaver'
import { VersionBadge } from './components/VersionBadge'
import { useBurnInShift } from './hooks/useIdle'
import { useOnline } from './hooks/useOnline'
import { useViewportFit } from './hooks/useViewportFit'
import { useLiveUpdates, useOfflineReplay } from './live/useLive'
import { lastSyncedLabel } from './offline/board'
import { useLastSynced } from './offline/useLastSynced'
import { applyTheme, isThemeId } from './theme'

/** The calendar views, each its own destination. A phone shows one entry for all of
 *  them instead — so many items plus a version badge do not fit across 390px, and the
 *  last one (Settings) was falling off the end. */
const CALENDAR_VIEWS = [
  { to: '/calendar/week', label: 'Week' },
  { to: '/calendar/month', label: 'Month' },
]

const NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/lists', label: 'Lists' },
  { to: '/messages', label: 'Messages' },
  { to: '/home', label: 'Home' },
  { to: '/games', label: 'Games' },
  { to: '/cameras', label: 'Cameras' },
  { to: '/meals', label: 'Meals' },
  { to: '/chores', label: 'Chores' },
  { to: '/settings', label: 'Settings' },
]

export function App() {
  const settingsQuery = useSettings()
  const settings = settingsQuery.data
  useDisplayReceiver(settingsQuery.isSuccess)
  const onCalendar = useLocation().pathname.startsWith('/calendar')

  // Keeps the app the height of the space actually available, so a phone keyboard
  // never covers the nav or a modal's Save button.
  useViewportFit()
  useLiveUpdates()
  useOfflineReplay()

  const shift = useBurnInShift(settings?.burn_in_shift ?? false)
  const online = useOnline()
  const syncedAt = useLastSynced()

  // Optional shortcut to somewhere else in the house. No bookmark, no bar --
  // the grid row collapses, so nobody pays vertical space for a feature they
  // haven't set up. That matters on a wall display.
  const bookmark = safeBookmarkUrl(settings?.bookmark_url)
  const remembered = typeof document === 'undefined' ? undefined : document.documentElement.dataset.theme
  const theme = isThemeId(settings?.theme) ? settings.theme : isThemeId(remembered) ? remembered : undefined
  const airy = theme === 'airy'

  useEffect(() => {
    document.documentElement.dataset.scale = settings?.display_scale ?? 'normal'
  }, [settings?.display_scale])

  useEffect(() => {
    // An unrecognised value (a newer server, a hand-edited row) keeps whatever is
    // already showing rather than blanking every token.
    if (isThemeId(settings?.theme)) applyTheme(settings.theme)
  }, [settings?.theme])

  // Hooks above always run. This is the one place a browser that is not on the
  // trusted network lands; the kiosk on the Pi never gets a 401.
  if (settingsQuery.error instanceof ApiError && settingsQuery.error.status === 401) {
    return <AuthGate />
  }

  return (
    <EventColorProvider airy={airy}>
    <div
      className="shell"
      data-airy={airy ? 'true' : undefined}
      style={{ transform: `translate(${shift.x}px, ${shift.y}px)`, transition: 'transform 2s ease-in-out' }}
    >
      {airy ? (
        <AiryBar
          bookmark={bookmark}
          bookmarkText={bookmark ? bookmarkLabel(settings?.bookmark_label, bookmark) : ''}
        />
      ) : (
        bookmark && (
          <div className="topbar">
            <a className="topbar__link" href={bookmark} rel="noreferrer">
              <span aria-hidden>🔗</span>
              {bookmarkLabel(settings?.bookmark_label, bookmark)}
            </a>
          </div>
        )
      )}
      <main className="shell__main">
        <Outlet />
      </main>
      <nav className="shell__nav">
        {airy ? (
          <AiryNav onCalendar={onCalendar} />
        ) : (
          <>
            {/* One entry on a phone, two on anything larger. Both are rendered and the
                stylesheet picks -- a JS breakpoint would disagree with the CSS one that
                already decides whether this nav is a side rail or a bottom bar. */}
            <NavLink
              to="/calendar/week"
              className="navbtn navbtn--calendar"
              // Stays lit on every calendar view, since it is the way back to both.
              aria-current={onCalendar ? 'page' : undefined}
            >
              <span>Calendar</span>
            </NavLink>

            <span className="navviews">
              {CALENDAR_VIEWS.map((item) => (
                <NavLink key={item.to} to={item.to} className="navbtn">
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </span>

            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} className="navbtn">
                <span>{item.label}</span>
              </NavLink>
            ))}
          </>
        )}
        <VersionBadge />
      </nav>
      {!online && (
        <div className="offline" role="status">
          Offline, last synced {lastSyncedLabel(syncedAt)}
        </div>
      )}
    </div>
    {/* Outside the shifted shell on purpose: a transformed ancestor becomes the
        containing block for position: fixed, so the saver would slide with the
        burn-in nudge and leave bare strips along two edges. */}
    <Screensaver />
    </EventColorProvider>
  )
}
