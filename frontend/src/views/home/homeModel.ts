import { takeSseFrames } from '../../live/sse'

/* Pure helpers for Home Control: what a tile says, what a tap does, what a live update
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
  /** From HA's device registry, when known. Used to pick a TV silhouette. */
  manufacturer?: string | null
  model?: string | null
  model_id?: string | null
  device_class?: string | null
  /** HA's entity_picture, if it provided one. The access token is never included. */
  entity_picture?: string | null
  /** Read-only room status (motion, occupancy, temperature, humidity). Not a tile. */
  readonly?: boolean
  kind?: 'sensor'
  last_changed?: string | null
  unit_of_measurement?: string | null
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
  last_changed?: string | null
  unit_of_measurement?: string | null
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
    case 'media_player': {
      if (!e.on) return 'Off'
      const source = typeof e.attrs.source === 'string' ? e.attrs.source : ''
      const lead = source || (e.state === 'on' ? 'On' : cap(e.state))
      return e.attrs.muted === true ? `${lead} · Muted` : lead
    }
    case 'scene':
    case 'script':
      return ''
    default:
      if (isRoomSensor(e)) return describeSensor(e).text
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
  // A TV that can't be switched from here still has its volume and inputs in the sheet.
  if (e.domain === 'media_player' && e.attrs.can_power === false) return { kind: 'sheet' }
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
      // A TV's level is its volume: turning it down to 0 does not turn the TV off.
      if (e.domain === 'media_player') return { level }
      return { level, on: level > 0, state: e.domain === 'cover' ? (level > 0 ? 'open' : 'closed') : level > 0 ? 'on' : 'off' }
    }
    case 'mute':
      return { attrs: { muted: true } }
    case 'unmute':
      return { attrs: { muted: false } }
    case 'lock':
      return { on: false, state: 'locked' }
    case 'unlock':
      return { on: true, state: 'unlocked' }
    default:
      return {}
  }
}

// ----------------------------------------------------------------------- layout

/** How the family arranged the page: the household-wide `home_layout` setting. It only
 *  records choices. Anything not listed (a new light, a new room) simply follows the things
 *  that were arranged, in the usual order. Rooms are keyed by `roomKey`. */
export interface HomeLayoutPrefs {
  rooms: string[]
  hidden_rooms: string[]
  wide_rooms: string[]
  devices: Record<string, string[]>
  scenes: string[]
}

export const DEFAULT_PREFS: HomeLayoutPrefs = { rooms: [], hidden_rooms: [], wide_rooms: [], devices: {}, scenes: [] }

export const roomKey = (room: { area_id: string | null }): string => room.area_id ?? 'other'

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** Whatever the server sent, as something safe to use: never throws, never undefined. */
export function normalizePrefs(raw: unknown): HomeLayoutPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const devices: Record<string, string[]> = {}
  if (r.devices && typeof r.devices === 'object' && !Array.isArray(r.devices)) {
    for (const [room, ids] of Object.entries(r.devices)) devices[room] = strings(ids)
  }
  return {
    rooms: strings(r.rooms),
    hidden_rooms: strings(r.hidden_rooms),
    wide_rooms: strings(r.wide_rooms),
    devices,
    scenes: strings(r.scenes),
  }
}

/** Listed items first, in the listed order; everything else after, in its own order. A
 *  listed id that no longer exists is ignored. */
export function orderBy<T>(items: T[], idOf: (item: T) => string, order: string[] | undefined): T[] {
  if (!order || order.length === 0) return items
  const rank = new Map(order.map((id, i) => [id, i]))
  const listed = items.filter((item) => rank.has(idOf(item)))
  const rest = items.filter((item) => !rank.has(idOf(item)))
  return [...listed.sort((a, b) => rank.get(idOf(a))! - rank.get(idOf(b))!), ...rest]
}

export interface HomeLayout {
  favorites: HomeEntity[]
  rooms: (HomeRoom & { key: string; wide: boolean })[]
  actions: HomeEntity[]
  hiddenCount: number
  /** Whole rooms switched off in Edit mode (Settings can't bring these back). */
  hiddenRooms: number
}

/** Favorites float to the top as their own card (still listed in their room); hidden
 *  devices disappear everywhere but the Settings checklist; empty and hidden rooms are
 *  dropped; rooms, the devices in them and the scene row follow the saved arrangement. */
export function layoutHome(
  data: HomeData,
  favorites: string[],
  hidden: string[],
  prefs: HomeLayoutPrefs = DEFAULT_PREFS,
): HomeLayout {
  const gone = new Set(hidden)
  const switchedOff = new Set(prefs.hidden_rooms)
  const wide = new Set(prefs.wide_rooms)
  const all = data.rooms.flatMap((room) => room.entities)
  const shown = data.rooms
    .map((room) => ({
      ...room,
      key: roomKey(room),
      wide: wide.has(roomKey(room)),
      entities: orderBy(
        room.entities.filter((e) => !gone.has(e.entity_id)),
        (e) => e.entity_id,
        prefs.devices[roomKey(room)],
      ),
    }))
    .filter((room) => room.entities.length > 0)
  const rooms = orderBy(shown, (r) => r.key, prefs.rooms).filter((r) => !switchedOff.has(r.key))
  const byId = new Map(all.map((e) => [e.entity_id, e]))
  // Sensors are status, not favorites: even if an old list still names one, leave it out.
  const pinned = favorites.flatMap((id) => {
    const e = byId.get(id)
    return e && !gone.has(id) && !isRoomSensor(e) ? [e] : []
  })
  return {
    favorites: pinned,
    rooms,
    actions: orderBy(
      data.actions.filter((e) => !gone.has(e.entity_id)),
      (e) => e.entity_id,
      prefs.scenes,
    ),
    hiddenCount: all.filter((e) => gone.has(e.entity_id)).length + data.actions.filter((e) => gone.has(e.entity_id)).length,
    hiddenRooms: shown.filter((r) => switchedOff.has(r.key)).length,
  }
}

// ----------------------------------------------------------------------- editing the layout

export interface EditItem {
  entity: HomeEntity
  hidden: boolean
}

export interface EditRoom {
  key: string
  name: string
  wide: boolean
  hidden: boolean
  items: EditItem[]
}

export interface EditView {
  rooms: EditRoom[]
  scenes: EditItem[]
}

/** Everything, in the order it shows now, with hidden things still present (dimmed) so
 *  they can be brought back. */
export function editView(data: HomeData, hidden: string[], prefs: HomeLayoutPrefs): EditView {
  const gone = new Set(hidden)
  const off = new Set(prefs.hidden_rooms)
  const wide = new Set(prefs.wide_rooms)
  const item = (entity: HomeEntity): EditItem => ({ entity, hidden: gone.has(entity.entity_id) })
  const rooms = data.rooms.map((room) => {
    const key = roomKey(room)
    return {
      key,
      name: room.name,
      wide: wide.has(key),
      hidden: off.has(key),
      items: orderBy(room.entities, (e) => e.entity_id, prefs.devices[key]).map(item),
    }
  })
  return {
    rooms: orderBy(rooms, (r) => r.key, prefs.rooms),
    scenes: orderBy(data.actions, (e) => e.entity_id, prefs.scenes).map(item),
  }
}

/** Swap one id with its neighbour. Stays put at either end. */
export function moveItem(ids: string[], id: string, delta: -1 | 1): string[] {
  const from = ids.indexOf(id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= ids.length) return ids
  const next = [...ids]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

export function moveRoom(data: HomeData, hidden: string[], prefs: HomeLayoutPrefs, key: string, delta: -1 | 1): HomeLayoutPrefs {
  const order = editView(data, hidden, prefs).rooms.map((r) => r.key)
  return { ...prefs, rooms: moveItem(order, key, delta) }
}

export function moveDevice(
  data: HomeData,
  hidden: string[],
  prefs: HomeLayoutPrefs,
  key: string,
  id: string,
  delta: -1 | 1,
): HomeLayoutPrefs {
  const room = editView(data, hidden, prefs).rooms.find((r) => r.key === key)
  if (!room) return prefs
  const order = moveItem(room.items.map((i) => i.entity.entity_id), id, delta)
  return { ...prefs, devices: { ...prefs.devices, [key]: order } }
}

export function moveScene(data: HomeData, hidden: string[], prefs: HomeLayoutPrefs, id: string, delta: -1 | 1): HomeLayoutPrefs {
  const order = editView(data, hidden, prefs).scenes.map((i) => i.entity.entity_id)
  return { ...prefs, scenes: moveItem(order, id, delta) }
}

/** Drag and drop hands over the whole new order of one group at once. */
export const setRoomOrder = (prefs: HomeLayoutPrefs, keys: string[]): HomeLayoutPrefs => ({ ...prefs, rooms: keys })

export const setDeviceOrder = (prefs: HomeLayoutPrefs, roomKey: string, ids: string[]): HomeLayoutPrefs => ({
  ...prefs,
  devices: { ...prefs.devices, [roomKey]: ids },
})

export const setSceneOrder = (prefs: HomeLayoutPrefs, ids: string[]): HomeLayoutPrefs => ({ ...prefs, scenes: ids })

const toggled = (ids: string[], id: string): string[] => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])

export const toggleRoomHidden = (prefs: HomeLayoutPrefs, key: string): HomeLayoutPrefs => ({
  ...prefs,
  hidden_rooms: toggled(prefs.hidden_rooms, key),
})

export const toggleRoomWide = (prefs: HomeLayoutPrefs, key: string): HomeLayoutPrefs => ({
  ...prefs,
  wide_rooms: toggled(prefs.wide_rooms, key),
})

export const toggleHidden = (hidden: string[], id: string): string[] => toggled(hidden, id)

/** What gets saved: the arrangement without ids of rooms and devices Home Assistant no
 *  longer has, so the setting can't grow forever. */
export function pruneLayout(data: HomeData, prefs: HomeLayoutPrefs): HomeLayoutPrefs {
  const keys = new Set(data.rooms.map(roomKey))
  const devices: Record<string, string[]> = {}
  for (const room of data.rooms) {
    const key = roomKey(room)
    const have = new Set(room.entities.map((e) => e.entity_id))
    const kept = (prefs.devices[key] ?? []).filter((id) => have.has(id))
    if (kept.length) devices[key] = kept
  }
  const scenes = new Set(data.actions.map((e) => e.entity_id))
  return {
    rooms: prefs.rooms.filter((k) => keys.has(k)),
    hidden_rooms: prefs.hidden_rooms.filter((k) => keys.has(k)),
    wide_rooms: prefs.wide_rooms.filter((k) => keys.has(k)),
    devices,
    scenes: prefs.scenes.filter((id) => scenes.has(id)),
  }
}

export function roomSummary(room: HomeRoom): string {
  const countable = room.entities.filter(
    (e) => !isRoomSensor(e) && e.domain !== 'lock' && e.domain !== 'climate',
  )
  // A thermostat or a sensors-only room has nothing that is meaningfully "on" or "off".
  if (countable.length === 0) return ''
  const on = countable.filter((e) => e.on && e.available).length
  return on === 0 ? 'All off' : `${on} on`
}

export const STATUS_HELP: Record<string, string> = {
  not_configured: 'Home control is not set up yet.',
  unreachable: "Homie can't reach Home Assistant.",
  invalid_token: 'Home Assistant rejected the access token.',
  error: 'Home Assistant had a problem.',
}

// ----------------------------------------------------------------------- tile slider (lights and fans)

/** Movement under this (in CSS pixels) is still a tap, not a drag. */
export const SLIDER_TAP_PX = 8
/** Arrow keys change brightness or speed by this much. */
export const SLIDER_STEP = 10
/** How often a drag is sent to Home Assistant before the finger lifts, in ms. */
export const SLIDER_THROTTLE_MS = 300

/** A dimmable light or a fan with a percentage speed: the tile itself is the slider. */
export function isLevelSlider(e: HomeEntity): boolean {
  return e.adjustable && (e.domain === 'light' || e.domain === 'fan')
}

/** Map a pointer's X position across the tile to 0–100. */
export function levelFromX(x: number, left: number, width: number): number {
  if (width <= 0) return 0
  return Math.max(0, Math.min(100, Math.round(((x - left) / width) * 100)))
}

/** The level the tile should show: the in-progress drag, or the live value, or 0 when off. */
export function shownLevel(e: HomeEntity, draft: number | null): number {
  if (draft !== null) return draft
  return e.on && e.level !== null ? e.level : 0
}

/** Arrow-key adjustment. An off light starts at 0, so the first Right lands on 10%. */
export function nudgeLevel(level: number | null, on: boolean | null, delta: number): number {
  const base = on && level !== null ? level : 0
  return Math.max(0, Math.min(100, Math.round(base + delta)))
}

export type PointerIntent = 'pending' | 'slide' | 'scroll'

/** Decide whether a move is still a tap, a horizontal slide, or a vertical page scroll.
 *  Horizontal must strictly dominate before the tile claims the gesture. */
export function classifyPointerMove(dx: number, dy: number, slop = SLIDER_TAP_PX): PointerIntent {
  if (Math.hypot(dx, dy) < slop) return 'pending'
  return Math.abs(dx) > Math.abs(dy) ? 'slide' : 'scroll'
}

// ----------------------------------------------------------------------- room sensors

/** Motion, occupancy, temperature and humidity chips — never tiles. */
export function isRoomSensor(e: Pick<HomeEntity, 'readonly' | 'kind' | 'domain'>): boolean {
  return e.readonly === true || e.kind === 'sensor' || e.domain === 'sensor' || e.domain === 'binary_sensor'
}

const SENSOR_CHIP_ORDER = ['motion', 'occupancy', 'presence', 'temperature', 'humidity', 'carbon_dioxide']

export function sortRoomSensors(entities: HomeEntity[]): HomeEntity[] {
  const rank = new Map(SENSOR_CHIP_ORDER.map((c, i) => [c, i]))
  return [...entities].sort((a, b) => {
    const da = rank.get(a.device_class ?? '') ?? 99
    const db = rank.get(b.device_class ?? '') ?? 99
    if (da !== db) return da - db
    return a.name.localeCompare(b.name)
  })
}

/** "12 min ago" for a last_changed timestamp. Null if the stamp is missing or unreadable.
 *  Under a minute is "<1 min ago" so an off motion chip never says "just now". */
export function sensorAgo(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return null
  const ms = Math.max(0, now - then)
  if (ms < 60_000) return '<1 min ago'
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}

const BINARY_WORDS: Record<string, { now: string; ago: (when: string) => string; none: string; noun: string }> = {
  motion: { now: 'Motion now', ago: (when) => `Motion ${when}`, none: 'No motion', noun: 'Motion' },
  occupancy: { now: 'Occupied now', ago: (when) => `Occupied ${when}`, none: 'Empty', noun: 'Occupancy' },
  presence: { now: 'Present now', ago: (when) => `Present ${when}`, none: 'Away', noun: 'Presence' },
}

export interface SensorChip {
  id: string
  text: string
  /** Screen-reader label, includes the sensor name. */
  label: string
  /** Currently detecting motion/occupancy/presence. */
  active: boolean
  /** Show the small status dot (binary sensors). */
  dot: boolean
}

export function describeSensor(e: HomeEntity, now: number = Date.now()): SensorChip {
  const name = e.name
  const cls = e.device_class ?? ''
  const words = BINARY_WORDS[cls]
  if (!e.available) {
    const text = words ? `${words.noun} unavailable` : 'Unavailable'
    return { id: e.entity_id, text, label: `${name}: unavailable`, active: false, dot: Boolean(words) }
  }
  if (words) {
    if (e.state === 'on') {
      return { id: e.entity_id, text: words.now, label: `${name}: ${words.now}`, active: true, dot: true }
    }
    const ago = sensorAgo(e.last_changed, now)
    const text = ago ? words.ago(ago) : words.none
    return { id: e.entity_id, text, label: `${name}: ${text}`, active: false, dot: true }
  }
  const n = Number(e.state)
  if (!Number.isFinite(n)) {
    return { id: e.entity_id, text: '—', label: `${name}: unavailable`, active: false, dot: false }
  }
  let text: string
  if (cls === 'temperature') text = `${Math.round(n)}°`
  else if (cls === 'humidity') text = `${Math.round(n)}%`
  else if (cls === 'carbon_dioxide') text = `${Math.round(n)} ${e.unit_of_measurement?.trim() || 'ppm'}`
  else {
    const unit = e.unit_of_measurement ? ` ${e.unit_of_measurement}` : ''
    text = `${Number.isInteger(n) ? n : Math.round(n * 10) / 10}${unit}`
  }
  return { id: e.entity_id, text, label: `${name}: ${text}`, active: false, dot: false }
}

// ----------------------------------------------------------------------- TV silhouettes

export type TvStyle = 'frame' | 'serif' | 'sero' | 'flat' | 'generic'

/** Pick a TV silhouette from the manufacturer/model (or a generic set if we don't know it). */
export function tvStyle(
  manufacturer?: string | null,
  model?: string | null,
  modelId?: string | null,
  deviceClass?: string | null,
): TvStyle {
  const blob = `${manufacturer ?? ''} ${model ?? ''} ${modelId ?? ''}`.toLowerCase()
  if (/\bthe frame\b|\bls03\b|ls03[a-z]|\bframe\b/.test(blob)) return 'frame'
  if (/\bthe serif\b|\bls01\b|ls01[a-z]|\bserif\b/.test(blob)) return 'serif'
  if (/\bthe sero\b|\bls05\b|ls05[a-z]|\bsero\b/.test(blob)) return 'sero'
  // Crystal UHD / CU7000 / typical flat Samsung (and most other modern sets).
  if (
    /cu[0-9]{4}|crystal|qn[0-9]{2}|un[0-9]{2}|ue[0-9]{2}|au[0-9]{4}|bu[0-9]{4}|du[0-9]{4}/.test(blob) ||
    deviceClass === 'tv'
  ) {
    return 'flat'
  }
  return 'generic'
}

/** Only a real http(s) image is safe to show in the browser; a relative HA path would
 *  need the access token, which stays on the server. */
export function publicEntityPicture(url?: string | null): string | null {
  if (!url || url.length > 500) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return url
  } catch {
    return null
  }
}
