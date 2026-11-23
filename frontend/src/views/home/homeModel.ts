import { takeSseFrames } from '../../live/sse'

/* Pure helpers for the Home page: what a tile says, what a tap does, what a live update
 * changes, how rooms are laid out. No React in here, so all of it is tested directly. */

export type HomeStatus = 'ok' | 'not_configured' | 'unreachable' | 'invalid_token' | 'error' | 'connecting'

export interface HomeEntity {
  entity_id: string
  domain: string
  name: string
  area_id: string | null
  state: string
  available: boolean
  on: boolean | null
  /** 0-100: brightness, fan speed or shade position. Null when the device has none. */
  level: number | null
  adjustable: boolean
  attrs: Record<string, unknown>
}

export interface HomeRoom {
  area_id: string | null
  name: string
  entities: HomeEntity[]
}

export interface HomeData {
  status: HomeStatus
  message: string
  rooms: HomeRoom[]
  actions: HomeEntity[]
}

/** The fields a live update replaces. The rest (name, room) only change on `refresh`. */
export interface HomeStatePatch {
  entity_id: string
  state: string
  available: boolean
  on: boolean | null
  level: number | null
  attrs: Record<string, unknown>
}

export type HomeFrame =
  | { event: 'status'; data: { status: HomeStatus; message: string } }
  | { event: 'state'; data: HomeStatePatch }
  | { event: 'refresh'; data: Record<string, never> }

/** Change one device wherever it appears. */
export function patchEntity(data: HomeData, entityId: string, patch: Partial<HomeEntity>): HomeData {
  const merge = (e: HomeEntity): HomeEntity =>
    e.entity_id === entityId ? { ...e, ...patch, attrs: { ...e.attrs, ...patch.attrs } } : e
  return {
    ...data,
    rooms: data.rooms.map((room) =>
      room.entities.some((e) => e.entity_id === entityId)
        ? { ...room, entities: room.entities.map(merge) }
        : room,
    ),
    actions: data.actions.map(merge),
  }
}

export function applyState(data: HomeData, patch: HomeStatePatch): HomeData {
  const { entity_id, ...fields } = patch
  return patchEntity(data, entity_id, fields)
}

/** One SSE chunk in, whole frames out; `rest` is the unfinished tail for the next chunk. */
export function parseHomeFrames(buffer: string): { frames: HomeFrame[]; rest: string } {
  const { frames: blocks, rest } = takeSseFrames(buffer)
  const frames: HomeFrame[] = []
  for (const block of blocks) {
    let event = ''
    const data: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (event !== 'status' && event !== 'state' && event !== 'refresh') continue
    try {
      frames.push({ event, data: JSON.parse(data.join('\n') || '{}') } as HomeFrame)
    } catch {
      /* a malformed frame is skipped, the next one still lands */
    }
  }
  return { frames, rest }
}

// ----------------------------------------------------------------------- what a tile says

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, ' ') : s)

export function describe(e: HomeEntity): string {
  if (!e.available) return 'Unavailable'
  switch (e.domain) {
    case 'light':
    case 'fan':
      if (!e.on) return 'Off'
      return e.level !== null && e.adjustable ? `${e.level}%` : 'On'
    case 'cover':
      if (e.state === 'opening' || e.state === 'closing') return cap(e.state)
      if (e.state === 'closed') return 'Closed'
      return e.level !== null && e.level < 100 ? `Open ${e.level}%` : 'Open'
    case 'lock':
      return cap(e.state)
    case 'climate': {
      const now = e.attrs.current_temperature
      const mode = cap(String(e.attrs.hvac_mode ?? e.state))
      return typeof now === 'number' ? `${Math.round(now)}° · ${mode}` : mode
    }
    case 'scene':
    case 'script':
      return ''
    default:
      return e.on ? 'On' : 'Off'
  }
}

export type TapResult =
  | { kind: 'action'; action: string }
  | { kind: 'confirm'; action: 'lock' | 'unlock' }
  | { kind: 'sheet' }

/** What tapping a tile does. A thermostat has no sensible "toggle", so it opens its
 *  controls; a lock always asks first. */
export function tapResult(e: HomeEntity): TapResult {
  if (e.domain === 'lock') return { kind: 'confirm', action: e.on ? 'lock' : 'unlock' }
  if (e.domain === 'climate') return { kind: 'sheet' }
  if (e.domain === 'cover') return { kind: 'action', action: e.on ? 'close' : 'open' }
  return { kind: 'action', action: e.on ? 'turn_off' : 'turn_on' }
}

/** Show the result before HA has confirmed it; the live update then overwrites this. */
export function predict(e: HomeEntity, action: string, value?: number): Partial<HomeEntity> {
  switch (action) {
    case 'turn_on':
    case 'open':
      return { on: true, state: e.domain === 'cover' ? 'open' : 'on', level: e.level === 0 ? null : e.level }
    case 'turn_off':
    case 'close':
      return {
        on: false,
        state: e.domain === 'cover' ? 'closed' : 'off',
        level: e.domain === 'light' || e.domain === 'fan' ? 0 : e.level,
      }
    case 'set_level': {
      const level = Math.max(0, Math.min(100, Math.round(value ?? 0)))
      return { level, on: level > 0, state: e.domain === 'cover' ? (level > 0 ? 'open' : 'closed') : level > 0 ? 'on' : 'off' }
    }
    case 'lock':
      return { on: false, state: 'locked' }
    case 'unlock':
      return { on: true, state: 'unlocked' }
    default:
      return {}
  }
}

// ----------------------------------------------------------------------- layout

export interface HomeLayout {
  favorites: HomeEntity[]
  rooms: HomeRoom[]
  actions: HomeEntity[]
  hiddenCount: number
}

/** Favorites float to the top as their own card (still listed in their room); hidden
 *  devices disappear everywhere but the Settings checklist; empty rooms are dropped. */
export function layoutHome(data: HomeData, favorites: string[], hidden: string[]): HomeLayout {
  const gone = new Set(hidden)
  const all = data.rooms.flatMap((room) => room.entities)
  const rooms = data.rooms
    .map((room) => ({ ...room, entities: room.entities.filter((e) => !gone.has(e.entity_id)) }))
    .filter((room) => room.entities.length > 0)
  const byId = new Map(all.map((e) => [e.entity_id, e]))
  const pinned = favorites.flatMap((id) => (byId.has(id) && !gone.has(id) ? [byId.get(id)!] : []))
  return {
    favorites: pinned,
    rooms,
    actions: data.actions.filter((e) => !gone.has(e.entity_id)),
    hiddenCount: all.filter((e) => gone.has(e.entity_id)).length + data.actions.filter((e) => gone.has(e.entity_id)).length,
  }
}

export function roomSummary(room: HomeRoom): string {
  const on = room.entities.filter((e) => e.on && e.available && e.domain !== 'lock' && e.domain !== 'climate').length
  return on === 0 ? 'All off' : `${on} on`
}

export const STATUS_HELP: Record<string, string> = {
  not_configured: 'Home control is not set up yet.',
  unreachable: "Mantel can't reach Home Assistant.",
  invalid_token: 'Home Assistant rejected the access token.',
  error: 'Home Assistant had a problem.',
}
