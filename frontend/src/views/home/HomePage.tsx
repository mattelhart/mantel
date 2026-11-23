import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import { sendHomeAction, useHome, useHomeLive } from '../../api/home'
import { useSettings } from '../../api/hooks'
import type { AppSettings } from '../../api/types'
import { swallowTapThrough, useDismissGuard } from '../../components/dismissGuard'
import {
  STATUS_HELP,
  describe,
  layoutHome,
  roomSummary,
  tapResult,
  type HomeEntity,
  type HomeStatus,
} from './homeModel'

const LONG_PRESS_MS = 500
const LONG_PRESS_SLOP_PX = 12

const ICONS: Record<string, string> = {
  light: '💡',
  fan: '🌀',
  switch: '🔌',
  input_boolean: '🔘',
  cover: '🪟',
  climate: '🌡️',
  scene: '✨',
  script: '▶️',
}

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

  const favorites = settings?.home_favorites ?? []
  const hidden = settings?.home_hidden ?? []

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
          Can't load Home.{' '}
          <button className="btn" onClick={() => void refetch()}>Try again</button>
        </p>
      </div>
    )
  }

  const status: HomeStatus = data.status !== 'ok' ? data.status : live === 'ok' || live === 'connecting' ? 'ok' : live
  const layout = layoutHome(data, favorites, hidden)
  const all = [...data.rooms.flatMap((r) => r.entities), ...data.actions]
  const sheet = all.find((e) => e.entity_id === sheetId) ?? null
  const lock = lockId ? (all.find((e) => e.entity_id === lockId.id) ?? null) : null

  if (data.status !== 'ok') {
    return (
      <div className="home">
        <header className="home__bar"><h1 className="home__title">Home</h1></header>
        <div className="home__setup" role="status">
          <h2>{STATUS_HELP[data.status] ?? 'Home control is unavailable.'}</h2>
          <p>
            {data.status === 'not_configured'
              ? 'Connect Mantel to Home Assistant to control lights, fans, shades, locks and scenes from here.'
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

  const empty = layout.rooms.length === 0 && layout.actions.length === 0

  return (
    <div className="home">
      <header className="home__bar">
        <h1 className="home__title">Home</h1>
        {layout.hiddenCount > 0 && (
          <Link className="home__hidden" to="/settings?tab=home">{layout.hiddenCount} hidden</Link>
        )}
      </header>

      {status !== 'ok' && (
        <p className="home__banner" role="status">
          {STATUS_HELP[status] ?? 'Lost the connection.'} Showing what it looked like a moment ago.
        </p>
      )}
      {notice && <p className="home__banner home__banner--error" role="alert">{notice}</p>}

      {layout.actions.length > 0 && (
        <section className="home__scenes" aria-label="Scenes">
          {layout.actions.map((scene) => (
            <button
              key={scene.entity_id}
              className="home-scene"
              data-done={done === scene.entity_id}
              disabled={!scene.available}
              onClick={async () => {
                if (await run(scene, 'activate')) {
                  setDone(scene.entity_id)
                  window.setTimeout(() => setDone((d) => (d === scene.entity_id ? null : d)), 1500)
                }
              }}
            >
              <span aria-hidden>{ICONS[scene.domain]}</span> {scene.name}
              {done === scene.entity_id && <span className="home-scene__ok"> ✓</span>}
            </button>
          ))}
        </section>
      )}

      {empty && (
        <p className="home__empty">
          Home Assistant is connected, but it has no lights, switches, fans, shades, locks or scenes to show.
          {layout.hiddenCount > 0 && ' Some are hidden.'}
        </p>
      )}

      <div className="home__rooms">
        {layout.favorites.length > 0 && (
          <RoomCard title="Favorites" summary="" entities={layout.favorites} run={run} onOpen={setSheetId} onLock={setLockId} />
        )}
        {layout.rooms.map((room) => (
          <RoomCard
            key={room.area_id ?? 'other'}
            title={room.name}
            summary={roomSummary(room)}
            entities={room.entities}
            run={run}
            onOpen={setSheetId}
            onLock={setLockId}
          />
        ))}
      </div>

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

function RoomCard({
  title,
  summary,
  entities,
  run,
  onOpen,
  onLock,
}: {
  title: string
  summary: string
  entities: HomeEntity[]
  run: Run
  onOpen: (id: string) => void
  onLock: (v: { id: string; action: 'lock' | 'unlock' }) => void
}) {
  return (
    <section className="home-room" aria-label={title}>
      <header className="home-room__head">
        <h2 className="home-room__title">{title}</h2>
        {summary && <span className="home-room__sum">{summary}</span>}
      </header>
      <div className="home-room__tiles">
        {entities.map((e) => (
          <Tile key={e.entity_id} entity={e} run={run} onOpen={onOpen} onLock={onLock} />
        ))}
      </div>
    </section>
  )
}

/** A tap does the obvious thing. Press-and-hold, or the small button beside it (which is
 *  how a remote reaches it), opens the controls. */
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
  const timer = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const held = useRef(false)

  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    start.current = null
  }
  useEffect(() => cancel, [])

  const down = (event: ReactPointerEvent<HTMLButtonElement>) => {
    held.current = false
    start.current = { x: event.clientX, y: event.clientY }
    timer.current = window.setTimeout(() => {
      held.current = true
      timer.current = null
      onOpen(entity.entity_id)
      // The sheet now sits under the held finger. Lifting it would "tap" the dimmed area
      // and close the sheet straight away, so eat the click that comes with the release.
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
    if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > LONG_PRESS_SLOP_PX) cancel()
  }

  const tap = () => {
    if (held.current) {
      held.current = false
      return
    }
    const result = tapResult(entity)
    if (result.kind === 'sheet') onOpen(entity.entity_id)
    else if (result.kind === 'confirm') onLock({ id: entity.entity_id, action: result.action })
    else void run(entity, result.action)
  }

  const level = entity.adjustable && entity.on && entity.level !== null ? entity.level : null
  return (
    <div className="home-tile" data-on={!!entity.on} data-unavailable={!entity.available}>
      <button
        type="button"
        className="home-tile__main"
        aria-pressed={entity.domain === 'lock' || entity.domain === 'climate' ? undefined : !!entity.on}
        disabled={!entity.available}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onPointerLeave={cancel}
        onContextMenu={(event) => event.preventDefault()}
        onClick={tap}
      >
        <span className="home-tile__icon" aria-hidden>
          {entity.domain === 'lock' ? (entity.on ? '🔓' : '🔒') : (ICONS[entity.domain] ?? '•')}
        </span>
        <span className="home-tile__name">{entity.name}</span>
        <span className="home-tile__state">{describe(entity)}</span>
        {level !== null && (
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

const LEVEL_LABEL: Record<string, string> = { light: 'Brightness', fan: 'Speed', cover: 'Position' }

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

        {entity.domain !== 'climate' && entity.domain !== 'lock' && (
          <button
            className="btn btn--primary home-sheet__toggle"
            disabled={!entity.available}
            onClick={() => void run(entity, toggleAction)}
          >
            {entity.domain === 'cover' ? (entity.on ? 'Close' : 'Open') : entity.on ? 'Turn off' : 'Turn on'}
          </button>
        )}

        {entity.adjustable && entity.domain !== 'climate' && (
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
