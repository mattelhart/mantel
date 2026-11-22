import { describe as suite, expect, it } from 'vitest'
import {
  DEFAULT_PREFS,
  applyState,
  describe,
  editView,
  layoutHome,
  moveDevice,
  moveItem,
  moveRoom,
  moveScene,
  normalizePrefs,
  orderBy,
  parseHomeFrames,
  predict,
  pruneLayout,
  roomSummary,
  tapResult,
  toggleRoomHidden,
  toggleRoomWide,
  type HomeData,
  type HomeEntity,
} from './homeModel'

const ent = (over: Partial<HomeEntity>): HomeEntity => ({
  entity_id: 'light.lamp',
  domain: 'light',
  name: 'Lamp',
  area_id: 'den',
  state: 'on',
  available: true,
  on: true,
  level: 50,
  adjustable: true,
  attrs: {},
  ...over,
})

const data = (): HomeData => ({
  status: 'ok',
  message: '',
  rooms: [
    { area_id: 'den', name: 'Den', entities: [ent({}), ent({ entity_id: 'switch.fan', domain: 'switch', name: 'Fan', adjustable: false, level: null })] },
    { area_id: 'hall', name: 'Hall', entities: [ent({ entity_id: 'light.hall', name: 'Hall', on: false, state: 'off', level: 0 })] },
  ],
  actions: [ent({ entity_id: 'scene.movie', domain: 'scene', name: 'Movie', on: null, level: null, adjustable: false })],
})

suite('live updates', () => {
  it('replaces only the changing fields of one device, wherever it is', () => {
    const next = applyState(data(), { entity_id: 'light.lamp', state: 'off', available: true, on: false, level: 0, attrs: {} })
    const lamp = next.rooms[0].entities[0]
    expect(lamp).toMatchObject({ on: false, level: 0, state: 'off', name: 'Lamp', adjustable: true })
  })

  it('keeps a thermostat\'s limits while its readings change', () => {
    const t = ent({ entity_id: 'climate.up', domain: 'climate', attrs: { min_temp: 50, max_temp: 85, temperature: 70 } })
    const d: HomeData = { ...data(), rooms: [{ area_id: 'den', name: 'Den', entities: [t] }] }
    const next = applyState(d, { entity_id: 'climate.up', state: 'cool', available: true, on: true, level: null, attrs: { temperature: 72 } })
    expect(next.rooms[0].entities[0].attrs).toMatchObject({ min_temp: 50, max_temp: 85, temperature: 72 })
  })

  it('ignores a device it has never heard of', () => {
    const before = data()
    const next = applyState(before, { entity_id: 'light.nope', state: 'on', available: true, on: true, level: 1, attrs: {} })
    expect(next.rooms.map((r) => r.entities.length)).toEqual([2, 1])
  })
})

suite('stream frames', () => {
  it('reads whole frames and hands back the unfinished tail', () => {
    const text =
      'event: status\ndata: {"status":"ok","message":""}\n\n: keepalive\n\nevent: state\ndata: {"entity_id":"light.a","state":"on","available":true,"on":true,"level":10,"attrs":{}}\n\nevent: sta'
    const { frames, rest } = parseHomeFrames(text)
    expect(frames.map((f) => f.event)).toEqual(['status', 'state'])
    expect(rest).toBe('event: sta')
    const done = parseHomeFrames(rest + 'te\ndata: {}\n\n')
    expect(done.frames).toHaveLength(1)
  })

  it('skips a broken frame without losing the next', () => {
    const { frames } = parseHomeFrames('event: state\ndata: {oops\n\nevent: refresh\ndata: {}\n\n')
    expect(frames.map((f) => f.event)).toEqual(['refresh'])
  })
})

suite('tiles', () => {
  it('says what each device is doing', () => {
    expect(describe(ent({}))).toBe('50%')
    expect(describe(ent({ on: false, state: 'off', level: 0 }))).toBe('Off')
    expect(describe(ent({ adjustable: false }))).toBe('On')
    expect(describe(ent({ available: false }))).toBe('Unavailable')
    expect(describe(ent({ domain: 'cover', state: 'open', level: 80 }))).toBe('Open 80%')
    expect(describe(ent({ domain: 'cover', state: 'closed', on: false, level: 0 }))).toBe('Closed')
    expect(describe(ent({ domain: 'lock', state: 'locked', on: false }))).toBe('Locked')
    expect(describe(ent({ domain: 'climate', state: 'heat', attrs: { current_temperature: 68.4, hvac_mode: 'heat' } }))).toBe('68° · Heat')
  })

  it('knows what a tap should do', () => {
    expect(tapResult(ent({}))).toEqual({ kind: 'action', action: 'turn_off' })
    expect(tapResult(ent({ on: false }))).toEqual({ kind: 'action', action: 'turn_on' })
    expect(tapResult(ent({ domain: 'cover', on: true }))).toEqual({ kind: 'action', action: 'close' })
    expect(tapResult(ent({ domain: 'lock', on: false }))).toEqual({ kind: 'confirm', action: 'unlock' })
    expect(tapResult(ent({ domain: 'lock', on: true }))).toEqual({ kind: 'confirm', action: 'lock' })
    expect(tapResult(ent({ domain: 'climate' }))).toEqual({ kind: 'sheet' })
  })

  it('shows the expected result before Home Assistant confirms it', () => {
    expect(predict(ent({}), 'turn_off')).toMatchObject({ on: false, level: 0, state: 'off' })
    expect(predict(ent({ on: false, level: 0 }), 'turn_on')).toMatchObject({ on: true, level: null })
    expect(predict(ent({}), 'set_level', 130)).toMatchObject({ level: 100, on: true })
    expect(predict(ent({}), 'set_level', 0)).toMatchObject({ level: 0, on: false })
    expect(predict(ent({ domain: 'lock' }), 'unlock')).toMatchObject({ state: 'unlocked', on: true })
  })
})

suite('layout', () => {
  it('pins favorites in the order chosen, and still lists them in their room', () => {
    const out = layoutHome(data(), ['light.hall', 'light.lamp', 'light.gone'], [])
    expect(out.favorites.map((e) => e.entity_id)).toEqual(['light.hall', 'light.lamp'])
    expect(out.rooms[0].entities.map((e) => e.entity_id)).toContain('light.lamp')
  })

  it('hides devices everywhere and drops rooms left empty', () => {
    const out = layoutHome(data(), ['light.hall'], ['light.hall', 'scene.movie'])
    expect(out.rooms.map((r) => r.name)).toEqual(['Den'])
    expect(out.favorites).toEqual([])
    expect(out.actions).toEqual([])
    expect(out.hiddenCount).toBe(2)
  })

  it('summarises a room', () => {
    expect(roomSummary(data().rooms[0])).toBe('2 on')
    expect(roomSummary(data().rooms[1])).toBe('All off')
  })
})

const tv = (over: Partial<HomeEntity> = {}) =>
  ent({
    entity_id: 'media_player.tv',
    domain: 'media_player',
    name: 'TV',
    state: 'on',
    level: 25,
    attrs: { can_power: true, can_volume_step: true, can_mute: true, can_source: true, source: 'HDMI1', sources: ['HDMI1', 'Netflix'], muted: false },
    ...over,
  })

suite('TVs', () => {
  it('says whether it is on, and what it is showing', () => {
    expect(describe(tv())).toBe('HDMI1')
    expect(describe(tv({ attrs: { muted: true, source: 'HDMI1' } }))).toBe('HDMI1 · Muted')
    expect(describe(tv({ attrs: {}, state: 'playing' }))).toBe('Playing')
    expect(describe(tv({ attrs: {} }))).toBe('On')
    expect(describe(tv({ on: false, state: 'off' }))).toBe('Off')
    expect(describe(tv({ on: false, state: 'standby' }))).toBe('Off')
    expect(describe(tv({ available: false }))).toBe('Unavailable')
  })

  it('a tap switches it; one that cannot be switched opens its controls instead', () => {
    expect(tapResult(tv())).toEqual({ kind: 'action', action: 'turn_off' })
    expect(tapResult(tv({ on: false }))).toEqual({ kind: 'action', action: 'turn_on' })
    expect(tapResult(tv({ attrs: { can_power: false } }))).toEqual({ kind: 'sheet' })
  })

  it('turning the volume to 0 is not turning the TV off', () => {
    expect(predict(tv(), 'set_level', 0)).toEqual({ level: 0 })
    expect(predict(tv(), 'turn_off')).toMatchObject({ on: false, state: 'off', level: 25 })
    expect(predict(tv(), 'mute')).toEqual({ attrs: { muted: true } })
  })

  it('a live update keeps its inputs when HA leaves them out', () => {
    const d: HomeData = { ...data(), rooms: [{ area_id: 'den', name: 'Den', entities: [tv()] }] }
    const next = applyState(d, { entity_id: 'media_player.tv', state: 'off', available: true, on: false, level: null, attrs: { can_power: true } })
    expect(next.rooms[0].entities[0].attrs).toMatchObject({ sources: ['HDMI1', 'Netflix'], can_power: true })
    expect(next.rooms[0].entities[0].on).toBe(false)
  })
})

const bigHome = (): HomeData => ({
  status: 'ok',
  message: '',
  rooms: [
    { area_id: 'basement', name: 'Basement', entities: [ent({ entity_id: 'light.b1', name: 'B1' }), ent({ entity_id: 'light.b2', name: 'B2' }), ent({ entity_id: 'light.b3', name: 'B3' })] },
    { area_id: 'kitchen', name: 'Kitchen', entities: [ent({ entity_id: 'light.k1', name: 'K1' })] },
    { area_id: 'den', name: 'Den', entities: [ent({ entity_id: 'light.d1', name: 'D1' })] },
    { area_id: null, name: 'Other', entities: [ent({ entity_id: 'switch.o1', domain: 'switch', name: 'O1' })] },
  ],
  actions: [
    ent({ entity_id: 'scene.a', domain: 'scene', name: 'A' }),
    ent({ entity_id: 'scene.b', domain: 'scene', name: 'B' }),
    ent({ entity_id: 'scene.c', domain: 'scene', name: 'C' }),
  ],
})
const ids = (xs: { entity_id: string }[]) => xs.map((x) => x.entity_id)
const keys = (l: { rooms: { key: string }[] }) => l.rooms.map((r) => r.key)

suite('arranging the page', () => {
  it('with nothing chosen it is the usual order', () => {
    const out = layoutHome(bigHome(), [], [], DEFAULT_PREFS)
    expect(keys(out)).toEqual(['basement', 'kitchen', 'den', 'other'])
    expect(out.rooms.every((r) => !r.wide)).toBe(true)
    expect(out.hiddenRooms).toBe(0)
  })

  it('puts chosen rooms first, in order, and new rooms after them', () => {
    const prefs = { ...DEFAULT_PREFS, rooms: ['den', 'ghost', 'basement'] }
    expect(keys(layoutHome(bigHome(), [], [], prefs))).toEqual(['den', 'basement', 'kitchen', 'other'])
  })

  it('a device added later lands at the end of its room', () => {
    const prefs = { ...DEFAULT_PREFS, devices: { basement: ['light.b3', 'light.b1'] } }
    const home = bigHome()
    home.rooms[0].entities.push(ent({ entity_id: 'light.b4', name: 'B4' }))
    const out = layoutHome(home, [], [], prefs)
    expect(ids(out.rooms[0].entities)).toEqual(['light.b3', 'light.b1', 'light.b2', 'light.b4'])
  })

  it('orders scene chips, and hidden ones stay hidden', () => {
    const prefs = { ...DEFAULT_PREFS, scenes: ['scene.c', 'scene.a'] }
    expect(ids(layoutHome(bigHome(), [], [], prefs).actions)).toEqual(['scene.c', 'scene.a', 'scene.b'])
    expect(ids(layoutHome(bigHome(), [], ['scene.c'], prefs).actions)).toEqual(['scene.a', 'scene.b'])
  })

  it('hides a room without losing its devices, and counts it', () => {
    const out = layoutHome(bigHome(), [], [], { ...DEFAULT_PREFS, hidden_rooms: ['kitchen'], wide_rooms: ['den'] })
    expect(keys(out)).toEqual(['basement', 'den', 'other'])
    expect(out.hiddenRooms).toBe(1)
    expect(out.rooms.find((r) => r.key === 'den')?.wide).toBe(true)
  })

  it('a room with every device hidden is dropped, not counted as a hidden room', () => {
    const out = layoutHome(bigHome(), [], ['light.k1'], DEFAULT_PREFS)
    expect(keys(out)).not.toContain('kitchen')
    expect(out.hiddenRooms).toBe(0)
  })

  it('moves one step and stops at the ends', () => {
    expect(moveItem(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveItem(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c'])
    expect(moveItem(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(moveItem(['a', 'b', 'c'], 'zzz', 1)).toEqual(['a', 'b', 'c'])
  })

  it('moving a room writes down the whole order it now has', () => {
    const next = moveRoom(bigHome(), [], DEFAULT_PREFS, 'den', -1)
    expect(next.rooms).toEqual(['basement', 'den', 'kitchen', 'other'])
    expect(keys(layoutHome(bigHome(), [], [], next))).toEqual(['basement', 'den', 'kitchen', 'other'])
  })

  it('moving a device or a scene works from the order on screen', () => {
    const d = moveDevice(bigHome(), [], DEFAULT_PREFS, 'basement', 'light.b3', -1)
    expect(d.devices.basement).toEqual(['light.b1', 'light.b3', 'light.b2'])
    const again = moveDevice(bigHome(), [], d, 'basement', 'light.b3', -1)
    expect(again.devices.basement).toEqual(['light.b3', 'light.b1', 'light.b2'])
    expect(moveDevice(bigHome(), [], d, 'nowhere', 'x', 1)).toBe(d)
    expect(moveScene(bigHome(), [], DEFAULT_PREFS, 'scene.a', 1).scenes).toEqual(['scene.b', 'scene.a', 'scene.c'])
  })

  it('edit view keeps hidden rooms and devices visible so they can come back', () => {
    const view = editView(bigHome(), ['light.b2'], { ...DEFAULT_PREFS, hidden_rooms: ['kitchen'] })
    expect(view.rooms.map((r) => [r.key, r.hidden])).toEqual([['basement', false], ['kitchen', true], ['den', false], ['other', false]])
    expect(view.rooms[0].items.map((i) => [i.entity.entity_id, i.hidden])).toEqual([['light.b1', false], ['light.b2', true], ['light.b3', false]])
    expect(view.scenes).toHaveLength(3)
  })

  it('toggles room size and visibility both ways', () => {
    const wide = toggleRoomWide(DEFAULT_PREFS, 'den')
    expect(wide.wide_rooms).toEqual(['den'])
    expect(toggleRoomWide(wide, 'den').wide_rooms).toEqual([])
    expect(toggleRoomHidden(toggleRoomHidden(DEFAULT_PREFS, 'den'), 'den').hidden_rooms).toEqual([])
  })

  it('forgets rooms, devices and scenes Home Assistant no longer has', () => {
    const prefs = {
      rooms: ['den', 'gone'],
      hidden_rooms: ['gone'],
      wide_rooms: ['den', 'gone'],
      devices: { basement: ['light.b2', 'light.old'], gone: ['light.x'] },
      scenes: ['scene.a', 'scene.old'],
    }
    expect(pruneLayout(bigHome(), prefs)).toEqual({
      rooms: ['den'],
      hidden_rooms: [],
      wide_rooms: ['den'],
      devices: { basement: ['light.b2'] },
      scenes: ['scene.a'],
    })
  })

  it('reads whatever the server sent without throwing', () => {
    expect(normalizePrefs(undefined)).toEqual(DEFAULT_PREFS)
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS)
    expect(normalizePrefs('x')).toEqual(DEFAULT_PREFS)
    expect(normalizePrefs({ rooms: ['a', 3], devices: { r: ['x', null] }, scenes: 'no' })).toEqual({
      ...DEFAULT_PREFS,
      rooms: ['a'],
      devices: { r: ['x'] },
    })
    expect(normalizePrefs({ devices: ['x'] }).devices).toEqual({})
  })

  it('orderBy leaves things alone when nothing was chosen', () => {
    const list = [{ id: 'a' }, { id: 'b' }]
    expect(orderBy(list, (x) => x.id, [])).toBe(list)
    expect(orderBy(list, (x) => x.id, undefined)).toBe(list)
  })
})
