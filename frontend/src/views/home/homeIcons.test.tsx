// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { mount, unmount } from '../../components/testDom'
import { DeviceIcon, climateTone, lightFillOpacity } from './homeIcons'
import type { HomeEntity } from './homeModel'

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

const icon = (e: Partial<HomeEntity>) => {
  mount(<DeviceIcon entity={ent(e)} />)
  return document.querySelector('svg, .home-icon') as SVGElement | HTMLElement
}

describe('lightFillOpacity', () => {
  it('is unset when the light is off, and scales from dim to full when on', () => {
    expect(lightFillOpacity(false, 80)).toBeUndefined()
    expect(lightFillOpacity(null, 80)).toBeUndefined()
    expect(lightFillOpacity(true, null)).toBe(0.9)
    expect(lightFillOpacity(true, 0)).toBe(0.3)
    expect(lightFillOpacity(true, 40)).toBe(0.58)
    expect(lightFillOpacity(true, 100)).toBe(1)
  })
})

describe('climateTone', () => {
  const climate = (attrs: Record<string, unknown>, state = 'off', available = true) =>
    ({ available, attrs, state }) as Pick<HomeEntity, 'available' | 'attrs' | 'state'>

  it('prefers the current action over the mode', () => {
    expect(climateTone(climate({ hvac_mode: 'heat', hvac_action: 'cooling' }, 'heat'))).toBe('cool')
    expect(climateTone(climate({ hvac_mode: 'cool', hvac_action: 'heating' }, 'cool'))).toBe('heat')
    expect(climateTone(climate({ hvac_action: 'drying' }, 'auto'))).toBe('cool')
  })

  it('falls back to the mode, and is unset when the thermostat is off or unavailable', () => {
    expect(climateTone(climate({ hvac_mode: 'heat' }, 'heat'))).toBe('heat')
    expect(climateTone(climate({ hvac_mode: 'heat_cool' }, 'heat_cool'))).toBe('heat')
    expect(climateTone(climate({ hvac_mode: 'cool' }, 'cool'))).toBe('cool')
    expect(climateTone(climate({ hvac_mode: 'dry' }, 'dry'))).toBe('cool')
    expect(climateTone(climate({ hvac_mode: 'off' }, 'off'))).toBeNull()
    expect(climateTone(climate({ hvac_mode: 'auto' }, 'auto'))).toBeNull()
    expect(climateTone(climate({ hvac_mode: 'heat' }, 'heat', false))).toBeNull()
  })
})

describe('DeviceIcon', () => {
  afterEach(() => unmount())

  it('renders a duotone glyph (fill + stroke) for each device kind', () => {
    const cases: [Partial<HomeEntity>, string][] = [
      [{ domain: 'light' }, 'light'],
      [{ domain: 'fan', entity_id: 'fan.one' }, 'fan'],
      [{ domain: 'switch', entity_id: 'switch.plug' }, 'switch'],
      [{ domain: 'input_boolean', entity_id: 'input_boolean.guest' }, 'input_boolean'],
      [{ domain: 'cover', entity_id: 'cover.shade' }, 'cover'],
      [{ domain: 'climate', entity_id: 'climate.up', attrs: { hvac_mode: 'cool' } }, 'climate'],
      [{ domain: 'lock', entity_id: 'lock.front', on: false }, 'lock'],
      [{ domain: 'lock', entity_id: 'lock.front', on: true }, 'lock-open'],
      [{ domain: 'scene', entity_id: 'scene.movie' }, 'scene'],
      [{ domain: 'script', entity_id: 'script.goodnight' }, 'script'],
      [{ domain: 'binary_sensor', entity_id: 'binary_sensor.motion' }, 'sensor'],
      [{ domain: 'sensor', entity_id: 'sensor.temp' }, 'sensor'],
      [{ domain: 'vacuum', entity_id: 'vacuum.bot' }, 'unknown'],
    ]
    for (const [over, kind] of cases) {
      const el = icon(over)
      expect(el.getAttribute('data-icon'), kind).toBe(kind)
      expect(el.querySelector('.home-icon__fill'), kind).toBeTruthy()
      expect(el.querySelector('.home-icon__stroke, .home-icon__solid'), kind).toBeTruthy()
      unmount()
    }
  })

  it('a lit bulb scales its fill with brightness, an off bulb does not', () => {
    let el = icon({ on: true, level: 40 })
    expect(el.getAttribute('data-icon')).toBe('light')
    expect((el as SVGElement).style.getPropertyValue('--icon-fill-opacity')).toBe('0.58')
    unmount()
    el = icon({ on: false, state: 'off', level: 0 })
    expect((el as SVGElement).style.getPropertyValue('--icon-fill-opacity')).toBe('')
  })

  it('a running fan marks its blades to spin, an off or unavailable fan does not', () => {
    expect(icon({ domain: 'fan', entity_id: 'fan.one', on: true }).classList.contains('home-icon--spin')).toBe(true)
    unmount()
    expect(icon({ domain: 'fan', entity_id: 'fan.one', on: false }).classList.contains('home-icon--spin')).toBe(false)
    unmount()
    expect(
      icon({ domain: 'fan', entity_id: 'fan.one', on: true, available: false }).classList.contains('home-icon--spin'),
    ).toBe(false)
  })

  it('a thermostat carries a heat or cool tone from its action or mode', () => {
    const heat = icon({
      domain: 'climate',
      entity_id: 'climate.up',
      attrs: { hvac_mode: 'heat', hvac_action: 'heating' },
    })
    expect(heat.getAttribute('data-tone')).toBe('heat')
    unmount()
    const cool = icon({ domain: 'climate', entity_id: 'climate.up', attrs: { hvac_mode: 'cool' }, state: 'cool' })
    expect(cool.getAttribute('data-tone')).toBe('cool')
    unmount()
    const off = icon({ domain: 'climate', entity_id: 'climate.up', attrs: { hvac_mode: 'off' }, state: 'off', on: false })
    expect(off.getAttribute('data-tone')).toBeNull()
  })

  it('keeps the TV silhouettes already chosen from the model and manufacturer', () => {
    const tvs: [Partial<HomeEntity>, string][] = [
      [
        {
          domain: 'media_player',
          entity_id: 'media_player.den',
          manufacturer: 'Samsung Electronics',
          model: 'UN55CU7000FXZA',
          model_id: 'UN55CU7000FXZA',
          device_class: 'tv',
        },
        'tv-flat',
      ],
      [
        { domain: 'media_player', entity_id: 'media_player.frame', manufacturer: 'Samsung', model: 'The Frame' },
        'tv-frame',
      ],
      [
        { domain: 'media_player', entity_id: 'media_player.serif', manufacturer: 'Samsung', model: 'The Serif' },
        'tv-serif',
      ],
      [
        { domain: 'media_player', entity_id: 'media_player.sero', manufacturer: 'Samsung', model: 'The Sero' },
        'tv-sero',
      ],
      [{ domain: 'media_player', entity_id: 'media_player.sound', manufacturer: 'Sonos', model: 'Beam' }, 'tv-generic'],
    ]
    for (const [over, kind] of tvs) {
      expect(icon(over).getAttribute('data-icon'), kind).toBe(kind)
      unmount()
    }
  })

  it('a TV with a picture still uses that photo, tagged with its silhouette', () => {
    const el = icon({
      domain: 'media_player',
      entity_id: 'media_player.den',
      manufacturer: 'Samsung Electronics',
      model: 'UN55CU7000FXZA',
      model_id: 'UN55CU7000FXZA',
      device_class: 'tv',
      entity_picture: 'https://example.invalid/tv.jpg',
    })
    expect(el.getAttribute('data-icon')).toBe('tv-flat')
    expect(el.classList.contains('home-icon--photo')).toBe(true)
    expect(el.querySelector('img')?.getAttribute('src')).toBe('https://example.invalid/tv.jpg')
  })
})
