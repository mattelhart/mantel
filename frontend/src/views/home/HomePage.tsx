import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import { sendHomeAction, useHome, useHomeLive } from '../../api/home'
import { useSettings } from '../../api/hooks'
import type { AppSettings } from '../../api/types'
import { swallowTapThrough, useDismissGuard } from '../../components/dismissGuard'
import { HomeEditor } from './HomeEditor'
import { MasonryGrid } from './MasonryGrid'
import { DeviceIcon } from './homeIcons'
import {
  DEFAULT_PREFS,
  SLIDER_STEP,
  SLIDER_THROTTLE_MS,
  STATUS_HELP,
  classifyPointerMove,
  describe,
  describeSensor,
  editView,
  isLevelSlider,
  isRoomSensor,
  layoutHome,
  levelFromX,
  moveDevice,
  moveRoom,
  moveScene,
  normalizePrefs,
  nudgeLevel,
  pruneLayout,
  roomSummary,
  sortRoomSensors,
  setDeviceOrder,
  setRoomOrder,
  setSceneOrder,
  shownLevel,
  tapResult,
  toggleHidden,
  toggleRoomHidden,
  toggleRoomWide,
  type HomeEntity,
  type HomeLayoutPrefs,
  type HomeStatus,
  type PointerIntent,
} from './homeModel'

const LONG_PRESS_MS = 500
const LONG_PRESS_SLOP_PX = 12

type Run = (entity: HomeEntity, action: string, value?: number | string, confirm?: boolean) => Promise<boolean>

export function HomePage() {
  const qc = useQueryClient()
  const live = useHomeLive()
  const { data, isLoading, isError, refetch } = useHome(live)
  const { data: settings } = useSettings()
  const [sheetId, setSheetId] = useState<string | null>(null)
  const [lockId, setLockId] = useState<{ id: string; action: 'lock' | 'unlock' } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  // Edit mode works on a copy and only saves on Done, so Cancel really does cancel.
  const [draft, setDraft] = useState<{ prefs: HomeLayoutPrefs; hidden: string[] } | null>(null)
  const [saving, setSaving] = useState(false)

  const favorites = settings?.home_favorites ?? []
  const hidden = settings?.home_hidden ?? []
  const prefs = normalizePrefs(settings?.home_layout)

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const run: Run = useCallback(
    async (entity, action, value, confirm) => {
      try {
        await sendHomeAction(qc, entity, action, value, confirm)
        setNotice(null)
        return true
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "That didn't work.")
        return false
      }
    },
    [qc],
  )

  const saveList = useCallback(
    async (key: 'home_favorites' | 'home_hidden', next: string[]) => {
      qc.setQueryData<AppSettings>(['settings'], (s) => (s ? { ...s, [key]: next } : s))
      try {
        await api.patch<AppSettings>('/settings', { [key]: next })
      } catch {
        setNotice("Couldn't save that.")
      } finally {
        void qc.invalidateQueries({ queryKey: ['settings'] })
      }
    },
    [qc],
  )

  if (isLoading) return <div className="home"><p className="home__empty">Loading…</p></div>
  if (isError || !data) {
    return (
      <div className="home">
        <p className="home__empty" role="alert">
          Can't load Home Control.{' '}
          <button className="btn" onClick={() => void refetch()}>Try again</button>
        </p>
      </div>
    )
  }

  const status: HomeStatus = data.status !== 'ok' ? data.status : live === 'ok' || live === 'connecting' ? 'ok' : live
  const layout = layoutHome(data, favorites, hidden, prefs)
  const all = [...data.rooms.flatMap((r) => r.entities), ...data.actions]
  const sheet = all.find((e) => e.entity_id === sheetId) ?? null
  const lock = lockId ? (all.find((e) => e.entity_id === lockId.id) ?? null) : null

  if (data.status !== 'ok') {
    return (
      <div className="home">
        <header className="home__bar"><h1 className="home__title">Home Control</h1></header>
        <div className="home__setup" role="status">
          <h2>{STATUS_HELP[data.status] ?? 'Home control is unavailable.'}</h2>
          <p>
            {data.status === 'not_configured'
              ? 'Connect Homie to Home Assistant to control lights, fans, shades, locks and scenes from here.'
              : data.message}
          </p>
          <div className="home__setupactions">
            <Link className="btn btn--primary" to="/settings?tab=home">
              {data.status === 'not_configured' ? 'Set up Home control' : 'Check the settings'}
            </Link>
            {data.status !== 'not_configured' && (
              <button className="btn" onClick={() => void refetch()}>Try again</button>
            )}
          </div>
        </div>
      </div>
    )
  }

  const empty = layout.rooms.length === 0 && layout.actions.length === 0 && layout.hiddenRooms === 0

  const startEdit = () => setDraft({ prefs, hidden: [...hidden] })
  const saveEdit = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const updated = await api.patch<AppSettings>('/settings', {
        home_layout: pruneLayout(data, draft.prefs),
        home_hidden: draft.hidden,
      })
      qc.setQueryData<AppSettings>(['settings'], updated)
      setDraft(null)
      setNotice(null)
    } catch {
      setNotice("Couldn't save the layout. Nothing was changed. Try Done again.")
    } finally {
      setSaving(false)
      void qc.invalidateQueries({ queryKey: ['settings'] })
    }
  }
  const change = (next: Partial<{ prefs: HomeLayoutPrefs; hidden: string[] }>) =>
    setDraft((d) => (d ? { ...d, ...next } : d))
  const view = draft ? editView(data, draft.hidden, draft.prefs) : null

  return (
    <div className="home" data-editing={draft ? 'true' : undefined}>
      <header className="home__bar">
        <h1 className="home__title">{draft ? 'Edit Home Control' : 'Home Control'}</h1>
        {!draft && layout.hiddenCount > 0 && (
          <Link className="home__hidden" to="/settings?tab=home">{layout.hiddenCount} hidden</Link>
        )}
        {!draft && layout.hiddenRooms > 0 && (
          <button type="button" className="home__hidden home__hidden--link" onClick={startEdit}>
            {layout.hiddenRooms} hidden {layout.hiddenRooms === 1 ? 'room' : 'rooms'}
          </button>
        )}
        {!draft && all.length > 0 && (
          <button type="button" className="btn home__edit" onClick={startEdit}>
            ✎ Edit
          </button>
        )}
        {draft && (
          <div className="home__editbar" role="group" aria-label="Edit layout">
            <button type="button" className="btn" disabled={saving} onClick={() => change({ prefs: DEFAULT_PREFS, hidden: [] })}>
              Reset to default
            </button>
            <button type="button" className="btn" disabled={saving} onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" disabled={saving} onClick={() => void saveEdit()}>
              {saving ? 'Saving…' : 'Done'}
            </button>
          </div>
        )}
      </header>

      {draft && (
        <p className="home__banner" role="status">
          Drag a room, device or scene by its ⠿ handle (or press and hold) to move it. Rooms fill in around each other.
          The small ◀ ▶ buttons move one step, and Hide takes one off Home Control. Done saves it for every screen in
          the house. Nothing changes until then.
        </p>
      )}

      {status !== 'ok' && (
        <p className="home__banner" role="status">
          {STATUS_HELP[status] ?? 'Lost the connection.'} Showing what it looked like a moment ago.
        </p>
      )}
      {notice && <p className="home__banner home__banner--error" role="alert">{notice}</p>}

      {!view && layout.actions.length > 0 && (
        <section className="home__scenes" aria-label="Scenes">
          {layout.actions.map((scene) => (
            <button
              key={scene.entity_id}
              className="home-scene"
              aria-label={scene.name}
              data-done={done === scene.entity_id}
              disabled={!scene.available}
              onClick={async () => {
                if (await run(scene, 'activate')) {
                  setDone(scene.entity_id)
                  window.setTimeout(() => setDone((d) => (d === scene.entity_id ? null : d)), 1500)
                }
              }}
            >
              <DeviceIcon entity={scene} /> {scene.name}
              {done === scene.entity_id && <span className="home-scene__ok"> ✓</span>}
            </button>
          ))}
        </section>
      )}

      {!view && empty && (
        <p className="home__empty">
          Home Assistant is connected, but it has no lights, switches, fans, shades, TVs, locks or scenes to show.
          {layout.hiddenCount > 0 && ' Some are hidden.'}
        </p>
      )}

      {view && draft && (
        <HomeEditor
          view={view}
          on={{
            moveRoom: (key, delta) => change({ prefs: moveRoom(data, draft.hidden, draft.prefs, key, delta) }),
            setRoomOrder: (keys) => change({ prefs: setRoomOrder(draft.prefs, keys) }),
            toggleRoom: (key) => change({ prefs: toggleRoomHidden(draft.prefs, key) }),
            toggleWide: (key) => change({ prefs: toggleRoomWide(draft.prefs, key) }),
            moveDevice: (key, id, delta) => change({ prefs: moveDevice(data, draft.hidden, draft.prefs, key, id, delta) }),
            setDeviceOrder: (key, ids) => change({ prefs: setDeviceOrder(draft.prefs, key, ids) }),
            toggleDevice: (id) => change({ hidden: toggleHidden(draft.hidden, id) }),
            moveScene: (id, delta) => change({ prefs: moveScene(data, draft.hidden, draft.prefs, id, delta) }),
            setSceneOrder: (ids) => change({ prefs: setSceneOrder(draft.prefs, ids) }),
          }}
        />
      )}

      {!view && (
        <MasonryGrid
          entries={[
            ...(layout.favorites.length > 0
              ? [
                  {
                    key: 'favorites',
                    node: (
                      <RoomCard title="Favorites" summary="" entities={layout.favorites} run={run} onOpen={setSheetId} onLock={setLockId} />
                    ),
                  },
                ]
              : []),
            ...layout.rooms.map((room) => ({
              key: `room:${room.key}`,
              wide: room.wide,
              node: (
                <RoomCard
                  title={room.name}
                  summary={roomSummary(room)}
                  entities={room.entities}
                  wide={room.wide}
                  run={run}
                  onOpen={setSheetId}
                  onLock={setLockId}
                />
              ),
            })),
          ]}
        />
      )}

      {sheet && (
        <DeviceSheet
          entity={sheet}
          favorite={favorites.includes(sheet.entity_id)}
          run={run}
          onClose={() => setSheetId(null)}
          onFavorite={() =>
            void saveList(
              'home_favorites',
              favorites.includes(sheet.entity_id)
                ? favorites.filter((id) => id !== sheet.entity_id)
                : [...favorites, sheet.entity_id],
            )
          }
          onHide={() => {
            void saveList('home_hidden', [...hidden, sheet.entity_id])
            setSheetId(null)
          }}
        />
      )}
      {lock && lockId && (
        <ConfirmLock
          entity={lock}
          action={lockId.action}
          onCancel={() => setLockId(null)}
          onConfirm={async () => {
            setLockId(null)
            await run(lock, lockId.action, undefined, true)
          }}
        />
      )}
    </div>
  )
}

/** Tick once a minute so "Motion 12 min ago" stays honest without a live event. */
function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

/** A compact, non-interactive status line. Spans, not buttons: no hover, no press, no focus. */
export function RoomSensorStrip({ sensors }: { sensors: HomeEntity[] }) {
  const now = useNow()
  const chips = sortRoomSensors(sensors).map((e) => describeSensor(e, now))
  if (chips.length === 0) return null
  return (
    <ul className="home-room__sensors" aria-label="Room sensors">
      {chips.map((chip) => (
        <li
          key={chip.id}
          className="home-sensor"
          data-active={chip.active || undefined}
          aria-label={chip.label}
        >
          {chip.dot && <span className="home-sensor__dot" aria-hidden="true" />}
          {chip.text}
        </li>
      ))}
    </ul>
  )
}

function RoomCard({
  title,
  summary,
  entities,
  wide = false,
  run,
  onOpen,
  onLock,
}: {
  title: string
  summary: string
  entities: HomeEntity[]
  wide?: boolean
  run: Run
  onOpen: (id: string) => void
  onLock: (v: { id: string; action: 'lock' | 'unlock' }) => void
}) {
  const controls = entities.filter((e) => !isRoomSensor(e))
  const sensors = entities.filter(isRoomSensor)
  return (
    <section className={wide ? 'home-room home-room--wide' : 'home-room'} aria-label={title}>
      <header className="home-room__head">
        <h2 className="home-room__title">{title}</h2>
        {summary && <span className="home-room__sum">{summary}</span>}
      </header>
      {sensors.length > 0 && <RoomSensorStrip sensors={sensors} />}
      {controls.length > 0 && (
        <div className="home-room__tiles">
          {controls.map((e) => (
            <Tile key={e.entity_id} entity={e} run={run} onOpen={onOpen} onLock={onLock} />
          ))}
        </div>
      )}
    </section>
  )
}

/** A tap does the obvious thing. On a dimmable light or a speed-adjustable fan, a
 *  horizontal drag across the tile sets the level; a vertical move still scrolls the
 *  page. Press-and-hold, or the small button beside it (which is how a remote reaches
 *  it), opens the controls. */
function Tile({
  entity,
  run,
  onOpen,
  onLock,
}: {
  entity: HomeEntity
  run: Run
  onOpen: (id: string) => void
  onLock: (v: { id: string; action: 'lock' | 'unlock' }) => void
}) {
  const slider = isLevelSlider(entity)
  const timer = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number; left: number; width: number } | null>(null)
  const intent = useRef<PointerIntent>('pending')
  const held = useRef(false)
  const skipClick = useRef(false)
  const lastSent = useRef<number | null>(null)
  const lastSentAt = useRef(0)
  const draftRef = useRef<number | null>(null)
  const [draft, setDraft] = useState<number | null>(null)
  draftRef.current = draft

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => clearTimer, [])

  const sendLevel = (value: number, force = false) => {
    if (!force && value === lastSent.current) return
    lastSent.current = value
    lastSentAt.current = Date.now()
    void run(entity, 'set_level', value)
  }

  const down = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    held.current = false
    skipClick.current = false
    intent.current = 'pending'
    lastSent.current = shownLevel(entity, null)
    lastSentAt.current = 0
    const rect = event.currentTarget.getBoundingClientRect()
    start.current = { x: event.clientX, y: event.clientY, left: rect.left, width: rect.width }
    timer.current = window.setTimeout(() => {
      if (intent.current !== 'pending') return
      held.current = true
      skipClick.current = true
      timer.current = null
      onOpen(entity.entity_id)
      const release = () => {
        window.removeEventListener('pointerup', release, true)
        window.removeEventListener('pointercancel', release, true)
        swallowTapThrough()
      }
      window.addEventListener('pointerup', release, true)
      window.addEventListener('pointercancel', release, true)
    }, LONG_PRESS_MS)
  }

  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const from = start.current
    if (!from || held.current) return
    const dx = event.clientX - from.x
    const dy = event.clientY - from.y
    if (intent.current === 'pending') {
      const next = slider ? classifyPointerMove(dx, dy) : classifyPointerMove(dx, dy, LONG_PRESS_SLOP_PX)
      if (next === 'pending') return
      clearTimer()
      intent.current = next
      if (next === 'scroll' || !slider) {
        skipClick.current = next === 'scroll'
        return
      }
      // Horizontal drag has taken over: the tile claims this pointer so a finger
      // leaving the card mid-slide still updates the level.
      skipClick.current = true
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        /* jsdom and a few older browsers have no capture; the slide still works
           while the pointer stays on the tile. */
      }
    }
    if (intent.current !== 'slide' || !slider) return
    event.preventDefault()
    const value = levelFromX(event.clientX, from.left, from.width)
    setDraft(value)
    if (lastSentAt.current && Date.now() - lastSentAt.current >= SLIDER_THROTTLE_MS) {
      sendLevel(value)
    } else if (!lastSentAt.current) {
      lastSentAt.current = Date.now()
    }
  }

  const up = (event: ReactPointerEvent<HTMLButtonElement>) => {
    clearTimer()
    const from = start.current
    start.current = null
    const was = intent.current
    intent.current = 'pending'
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      /* ignore */
    }
    if (was === 'slide' && slider) {
      const value = draftRef.current ?? (from ? levelFromX(event.clientX, from.left, from.width) : shownLevel(entity, null))
      sendLevel(value, true)
      setDraft(null)
    }
  }

  const cancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    clearTimer()
    start.current = null
    intent.current = 'pending'
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      /* ignore */
    }
    setDraft(null)
  }

  const leave = () => {
    // Don't kill a slide, but a long-press should not fire after the finger leaves.
    if (intent.current !== 'slide') clearTimer()
  }

  const tap = () => {
    if (held.current) {
      held.current = false
      return
    }
    if (skipClick.current) {
      skipClick.current = false
      return
    }
    const result = tapResult(entity)
    if (result.kind === 'sheet') onOpen(entity.entity_id)
    else if (result.kind === 'confirm') onLock({ id: entity.entity_id, action: result.action })
    else void run(entity, result.action)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!slider || !entity.available) return
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? SLIDER_STEP
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -SLIDER_STEP
          : event.key === 'Home'
            ? -100
            : event.key === 'End'
              ? 100
              : 0
    if (!delta && event.key !== 'Home') return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 100 : nudgeLevel(entity.level, entity.on, delta)
    if (next === shownLevel(entity, null)) return
    void run(entity, 'set_level', next)
  }

  // A TV's level is its volume: a bar on the tile would read like "how on" it is.
  const level = slider ? shownLevel(entity, draft) : entity.adjustable && entity.on && entity.level !== null && entity.domain !== 'media_player' ? entity.level : null
  const sliding = draft !== null
  return (
    <div
      className="home-tile"
      data-on={!!entity.on}
      data-unavailable={!entity.available}
      data-domain={entity.domain}
      data-slider={slider || undefined}
      data-sliding={sliding || undefined}
      style={slider ? ({ '--level': level } as CSSProperties) : undefined}
    >
      <button
        type="button"
        className="home-tile__main"
        role={slider ? 'slider' : undefined}
        aria-valuemin={slider ? 0 : undefined}
        aria-valuemax={slider ? 100 : undefined}
        aria-valuenow={slider ? level ?? 0 : undefined}
        aria-valuetext={slider ? `${level ?? 0}%` : undefined}
        aria-orientation={slider ? 'horizontal' : undefined}
        aria-label={slider ? entity.name : undefined}
        aria-pressed={slider || entity.domain === 'lock' || entity.domain === 'climate' ? undefined : !!entity.on}
        disabled={!entity.available}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        onPointerLeave={leave}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => event.preventDefault()}
        onClick={tap}
      >
        {slider && <span className="home-tile__fill" aria-hidden />}
        <span className="home-tile__icon">
          <DeviceIcon entity={entity} />
        </span>
        <span className="home-tile__name" title={entity.name}>{entity.name}</span>
        <span className="home-tile__state" data-drag={sliding || undefined}>
          {sliding ? `${draft}%` : describe(entity)}
        </span>
        {!slider && level !== null && (
          <span className="home-tile__bar" aria-hidden>
            <span style={{ width: `${level}%` }} />
          </span>
        )}
      </button>
      <button
        type="button"
        className="home-tile__more"
        aria-label={`${entity.name} controls`}
        onClick={() => onOpen(entity.entity_id)}
      >
        ⋯
      </button>
    </div>
  )
}

/** Trailing debounce for sliders, flushed when the sheet closes so the last position is
 *  never lost. */
function useDebouncedSend(send: (value: number) => void, ms = 250) {
  const pending = useRef<number | null>(null)
  const timer = useRef<number | null>(null)
  const latest = useRef(send)
  latest.current = send
  const flush = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    if (pending.current !== null) {
      const value = pending.current
      pending.current = null
      latest.current(value)
    }
  }, [])
  useEffect(() => flush, [flush])
  return useCallback(
    (value: number) => {
      pending.current = value
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(flush, ms)
    },
    [flush, ms],
  )
}

const LEVEL_LABEL: Record<string, string> = { light: 'Brightness', fan: 'Speed', cover: 'Position', media_player: 'Volume' }

function DeviceSheet({
  entity,
  favorite,
  run,
  onClose,
  onFavorite,
  onHide,
}: {
  entity: HomeEntity
  favorite: boolean
  run: Run
  onClose: () => void
  onFavorite: () => void
  onHide: () => void
}) {
  // Nothing here is a draft: every change is already sent, so closing never asks.
  const guard = useDismissGuard({ dirty: false, onClose })
  const [draft, setDraft] = useState<number | null>(null)
  const sendLevel = useDebouncedSend((value) => void run(entity, 'set_level', value))
  const attrs = entity.attrs
  const temp = typeof attrs.temperature === 'number' ? attrs.temperature : null
  const [target, setTarget] = useState<number | null>(null)
  const sendTemp = useDebouncedSend((value) => void run(entity, 'set_temperature', value))
  const min = typeof attrs.min_temp === 'number' ? attrs.min_temp : 45
  const max = typeof attrs.max_temp === 'number' ? attrs.max_temp : 95
  const step = typeof attrs.step === 'number' ? attrs.step : 1
  const modes = Array.isArray(attrs.hvac_modes) ? (attrs.hvac_modes as string[]) : []
  const shownTarget = target ?? temp
  const tv = entity.domain === 'media_player'
  const muted = attrs.muted === true
  const sources = Array.isArray(attrs.sources) ? (attrs.sources as string[]) : []

  // Let go of the draft shortly after the last change so the live value takes over again.
  useEffect(() => {
    if (draft === null) return
    const timer = window.setTimeout(() => setDraft(null), 1500)
    return () => window.clearTimeout(timer)
  }, [draft])
  useEffect(() => {
    if (target === null) return
    const timer = window.setTimeout(() => setTarget(null), 2500)
    return () => window.clearTimeout(timer)
  }, [target])

  const level = draft ?? entity.level ?? 0
  const first = tapResult(entity)
  const toggleAction = first.kind === 'action' ? first.action : 'turn_on'
  const nudge = (delta: number) => {
    const base = shownTarget ?? 68
    const next = Math.min(max, Math.max(min, Math.round((base + delta) / step) * step))
    setTarget(next)
    sendTemp(next)
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={entity.name} {...guard.backdropProps}>
      <div className="modal__card home-sheet">
        <h2 className="modal__title">{entity.name}</h2>
        <p className="home-sheet__state">{describe(entity)}</p>

        {entity.domain !== 'climate' && entity.domain !== 'lock' && !(tv && attrs.can_power === false) && (
          <button
            className="btn btn--primary home-sheet__toggle"
            disabled={!entity.available}
            onClick={() => void run(entity, toggleAction)}
          >
            {entity.domain === 'cover' ? (entity.on ? 'Close' : 'Open') : entity.on ? 'Turn off' : 'Turn on'}
          </button>
        )}

        {tv && entity.on && (attrs.can_volume_step === true || attrs.can_mute === true) && (
          <div className="home-sheet__volume" role="group" aria-label="Volume">
            {attrs.can_volume_step === true && (
              <button className="btn" aria-label="Volume down" onClick={() => void run(entity, 'volume_down')}>
                −
              </button>
            )}
            {attrs.can_mute === true && (
              <button
                className="btn"
                aria-pressed={muted}
                onClick={() => void run(entity, muted ? 'unmute' : 'mute')}
              >
                {muted ? '🔇 Muted' : '🔈 Mute'}
              </button>
            )}
            {attrs.can_volume_step === true && (
              <button className="btn" aria-label="Volume up" onClick={() => void run(entity, 'volume_up')}>
                +
              </button>
            )}
          </div>
        )}

        {(!tv || entity.on) && entity.adjustable && entity.domain !== 'climate' && (
          <label className="home-sheet__slider">
            <span>
              {LEVEL_LABEL[entity.domain] ?? 'Level'} <strong>{level}%</strong>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={level}
              disabled={!entity.available}
              aria-label={LEVEL_LABEL[entity.domain] ?? 'Level'}
              onChange={(event) => {
                const value = Number(event.target.value)
                setDraft(value)
                sendLevel(value)
              }}
            />
          </label>
        )}

        {tv && entity.on && attrs.can_source === true && sources.length > 0 && (
          <div className="home-sheet__modes" role="group" aria-label="Input">
            {sources.map((source) => (
              <button
                key={source}
                className="btn"
                aria-pressed={attrs.source === source}
                onClick={() => void run(entity, 'select_source', source)}
              >
                {source}
              </button>
            ))}
          </div>
        )}

        {entity.domain === 'climate' && (
          <>
            <div className="home-sheet__temp">
              <button className="btn" aria-label="Cooler" onClick={() => nudge(-step)}>−</button>
              <span className="home-sheet__degrees" aria-live="polite">
                {shownTarget === null ? '—' : `${Math.round(shownTarget)}°`}
              </span>
              <button className="btn" aria-label="Warmer" onClick={() => nudge(step)}>+</button>
            </div>
            <div className="home-sheet__modes" role="group" aria-label="Mode">
              {modes.map((mode) => (
                <button
                  key={mode}
                  className="btn"
                  aria-pressed={attrs.hvac_mode === mode}
                  onClick={() => void run(entity, 'set_hvac_mode', mode)}
                >
                  {mode.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="home-sheet__more">
          <button className="btn" aria-pressed={favorite} onClick={onFavorite}>
            {favorite ? '★ Favorite' : '☆ Add to favorites'}
          </button>
          <button className="btn" onClick={onHide}>Hide from Home</button>
        </div>
        <div className="modal__actions">
          <div className="modal__spacer" />
          <button className="btn" onClick={guard.requestClose}>Done</button>
        </div>
      </div>
    </div>
  )
}

function ConfirmLock({
  entity,
  action,
  onCancel,
  onConfirm,
}: {
  entity: HomeEntity
  action: 'lock' | 'unlock'
  onCancel: () => void
  onConfirm: () => void
}) {
  const guard = useDismissGuard({ dirty: false, onClose: onCancel })
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => first.current?.focus({ preventScroll: true }), [])
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={`${action} ${entity.name}`} {...guard.backdropProps}>
      <div className="modal__card">
        <h2 className="modal__title">{action === 'unlock' ? 'Unlock' : 'Lock'} {entity.name}?</h2>
        <p className="modal__note">
          {action === 'unlock' ? 'Anyone nearby can walk in once it is unlocked.' : 'It will lock right away.'}
        </p>
        <div className="modal__actions">
          <button ref={first} className={`btn ${action === 'unlock' ? 'btn--danger' : 'btn--primary'}`} onClick={onConfirm}>
            {action === 'unlock' ? 'Unlock' : 'Lock'}
          </button>
          <div className="modal__spacer" />
          <button className="btn" onClick={guard.requestClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
