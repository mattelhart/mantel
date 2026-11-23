import { describe as suite, expect, it } from 'vitest'
import {
  applyState,
  describe,
  layoutHome,
  parseHomeFrames,
  predict,
  roomSummary,
  tapResult,
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
