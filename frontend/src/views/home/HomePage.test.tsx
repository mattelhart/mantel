// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { byText, click, mount, tapPointer, unmount, type } from '../../components/testDom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { HomePage } from './HomePage'
import type { HomeData, HomeEntity } from './homeModel'

// The real stylesheet, so a few rules that cannot be seen in jsdom are still pinned down.
const homeCss = readFileSync(resolve(process.cwd(), 'src/styles/home.css'), 'utf8')

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

const snapshot = (): HomeData => ({
  status: 'ok',
  message: '',
  rooms: [
    {
      area_id: 'den',
      name: 'Den',
      entities: [
        ent({}),
        ent({ entity_id: 'lock.front', domain: 'lock', name: 'Front Door', state: 'locked', on: false, level: null, adjustable: false }),
      ],
    },
  ],
  actions: [ent({ entity_id: 'scene.movie', domain: 'scene', name: 'Movie Night', on: null, level: null, adjustable: false, state: 'scening' })],
})

interface World {
  home: HomeData
  settings: Record<string, unknown>
  posts: { url: string; body: Record<string, unknown> }[]
  patches: Record<string, unknown>[]
  stream: ReadableStreamDefaultController<Uint8Array> | null
}

let world: World
const enc = new TextEncoder()

function install() {
  world = {
    home: snapshot(),
    settings: { home_favorites: [], home_hidden: [], home_layout: { rooms: [], hidden_rooms: [], wide_rooms: [], devices: {}, scenes: [] }, theme: 'airy', server: { ha_token_set: true } },
    posts: [],
    patches: [],
    stream: null,
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (url === '/api/home/live') {
        return new Response(
          new ReadableStream({
            start(controller) {
              world.stream = controller
              controller.enqueue(enc.encode('event: status\ndata: {"status":"ok","message":""}\n\n'))
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        )
      }
      if (url === '/api/home') return json(world.home)
      if (url === '/api/settings' && method === 'GET') return json(world.settings)
      if (url === '/api/settings' && method === 'PATCH') {
        world.patches.push(body)
        world.settings = { ...world.settings, ...body }
        return json(world.settings)
      }
      if (url.startsWith('/api/home/entities/')) {
        world.posts.push({ url, body })
        if (body.action === 'boom') return json({ error: { code: 'error', message: 'Home Assistant answered 400.' } }, 502)
        return json({ ok: true })
      }
      return json({}, 404)
    }),
  )
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mount(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 5))))
}
const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))
const tile = (name: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('.home-tile__main')).find((b) =>
    b.querySelector('.home-tile__name')?.textContent === name,
  )!
const push = async (frame: string) => {
  await act(async () => world.stream!.enqueue(enc.encode(frame)))
  await settle()
}

describe('Home page', () => {
  beforeEach(() => {
    install()
  })
  afterEach(async () => {
    unmount()
    vi.unstubAllGlobals()
    // A dismissing tap eats the clicks that follow it for a moment; let that pass.
    await new Promise((r) => setTimeout(r, 420))
  })

  it('shows rooms, devices with their state, and the scene row', async () => {
    renderPage()
    await settle()
    expect(document.querySelector('.home-room__title')?.textContent).toBe('Den')
    expect(tile('Lamp').textContent).toContain('50%')
    expect(tile('Front Door').textContent).toContain('Locked')
    expect(byText('Movie Night')).toBeTruthy()
  })

  it('tapping a light turns it off at once and tells Home Assistant', async () => {
    renderPage()
    await settle()
    click(tile('Lamp'))
    await settle()
    expect(world.posts).toEqual([
      { url: '/api/home/entities/light.lamp/action', body: { action: 'turn_off', confirm: false } },
    ])
    expect(tile('Lamp').closest('.home-tile')?.getAttribute('data-on')).toBe('false')
  })

  it('a scene is one tap', async () => {
    renderPage()
    await settle()
    click(byText('Movie Night')!)
    await settle()
    expect(world.posts[0]).toMatchObject({ url: '/api/home/entities/scene.movie/action', body: { action: 'activate' } })
  })

  it('a lock asks first, and only then is it sent as confirmed', async () => {
    renderPage()
    await settle()
    click(tile('Front Door'))
    await settle()
    expect(document.querySelector('[role=dialog]')?.textContent).toContain('Unlock Front Door?')
    expect(world.posts).toEqual([])
    click(byText('Unlock')!)
    await settle()
    expect(world.posts).toEqual([
      { url: '/api/home/entities/lock.front/action', body: { action: 'unlock', confirm: true } },
    ])
  })

  it('cancelling the lock prompt, even by tapping outside it, does nothing', async () => {
    renderPage()
    await settle()
    click(tile('Front Door'))
    await settle()
    tapPointer(document.querySelector('[role=dialog]')!)
    await settle()
    expect(document.querySelector('[role=dialog]')).toBeNull()
    expect(world.posts).toEqual([])
  })

  it('a long press opens the brightness slider, and moving it sends a level', async () => {
    renderPage()
    await settle()
    const lamp = tile('Lamp')
    act(() => {
      lamp.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 5, clientY: 5 }))
    })
    await wait(560)
    act(() => {
      lamp.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 5, clientY: 5 }))
    })
    // The release lands on the sheet that opened under the finger: it must stay open and
    // must not toggle the light.
    click(document.querySelector('[role=dialog]')!)
    click(lamp)
    await settle()
    expect(document.querySelector('[role=dialog]')).toBeTruthy()
    expect(world.posts).toEqual([])
    const slider = document.querySelector<HTMLInputElement>('[role=dialog] input[type=range]')!
    expect(slider.value).toBe('50')
    type(slider, '80')
    await wait(400)
    await settle()
    expect(world.posts).toEqual([
      { url: '/api/home/entities/light.lamp/action', body: { action: 'set_level', value: 80, confirm: false } },
    ])
  })

  it('a tap outside the sheet closes it without toggling what is underneath', async () => {
    renderPage()
    await settle()
    click(document.querySelector('.home-tile__more')!)
    await settle()
    expect(document.querySelector('[role=dialog]')).toBeTruthy()
    tapPointer(document.querySelector('[role=dialog]')!)
    await settle()
    expect(document.querySelector('[role=dialog]')).toBeNull()
    expect(world.posts).toEqual([])
  })

  it('favoriting and hiding are saved in Mantel settings', async () => {
    renderPage()
    await settle()
    click(document.querySelector('.home-tile__more')!)
    await settle()
    click(byText('☆ Add to favorites')!)
    await settle()
    expect(world.patches).toContainEqual({ home_favorites: ['light.lamp'] })
    expect(document.querySelector('[aria-label=Favorites]')).toBeTruthy()
    click(byText('Hide from Home')!)
    await settle()
    expect(world.patches).toContainEqual({ home_hidden: ['light.lamp'] })
    expect(document.querySelector('[role=dialog]')).toBeNull()
    expect(document.body.textContent).toContain('1 hidden')
  })

  it('follows a change made at the wall switch', async () => {
    renderPage()
    await settle()
    await push(
      'event: state\ndata: {"entity_id":"light.lamp","state":"off","available":true,"on":false,"level":0,"attrs":{}}\n\n',
    )
    expect(tile('Lamp').textContent).toContain('Off')
    expect(tile('Lamp').closest('.home-tile')?.getAttribute('data-on')).toBe('false')
  })

  it('says so when Home Assistant refuses, and puts the tile back', async () => {
    renderPage()
    await settle()
    world.home = { ...snapshot() }
    click(tile('Lamp'))
    await settle()
    // The server said no to the next one.
    const original = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    original.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ error: { code: 'error', message: 'Home Assistant answered 400.' } }), { status: 502 }),
    )
    click(tile('Lamp'))
    await settle()
    expect(document.querySelector('[role=alert]')?.textContent).toContain('Home Assistant answered 400.')
  })

  it('explains an unconfigured or unreachable Home Assistant instead of showing an empty page', async () => {
    world.home = { status: 'not_configured', message: '', rooms: [], actions: [] }
    renderPage()
    await settle()
    expect(document.body.textContent).toContain('Home control is not set up yet.')
    expect(document.querySelector('a[href="/settings?tab=home"]')).toBeTruthy()
  })

  it('names a rejected token', async () => {
    world.home = { status: 'invalid_token', message: 'Home Assistant rejected the access token.', rooms: [], actions: [] }
    renderPage()
    await settle()
    expect(document.body.textContent).toContain('Home Assistant rejected the access token.')
    expect(byText('Try again')).toBeTruthy()
  })
})

const tvEntity = (over: Partial<HomeEntity> = {}) =>
  ent({
    entity_id: 'media_player.den_tv',
    domain: 'media_player',
    name: 'TV',
    state: 'on',
    level: 25,
    adjustable: true,
    attrs: { can_power: true, can_volume_step: true, can_mute: true, can_source: true, source: 'HDMI1', sources: ['HDMI1', 'Netflix'], muted: false },
    manufacturer: 'Samsung Electronics',
    model: 'UN55CU7000FXZA',
    model_id: 'UN55CU7000FXZA',
    device_class: 'tv',
    ...over,
  })

const houseWithRooms = (): HomeData => ({
  status: 'ok',
  message: '',
  rooms: [
    { area_id: 'basement', name: 'Basement', entities: [ent({ entity_id: 'light.b1', name: 'Basement Lamp', area_id: 'basement' }), ent({ entity_id: 'light.b2', name: 'Bar', area_id: 'basement' })] },
    { area_id: 'kitchen', name: 'Kitchen', entities: [ent({ entity_id: 'light.k1', name: 'Pendant', area_id: 'kitchen' })] },
    { area_id: 'den', name: 'Den', entities: [tvEntity()] },
  ],
  actions: [
    ent({ entity_id: 'scene.a', domain: 'scene', name: 'Away', on: null, level: null, adjustable: false }),
    ent({ entity_id: 'scene.b', domain: 'scene', name: 'Home', on: null, level: null, adjustable: false }),
  ],
})

const titles = () => Array.from(document.querySelectorAll('.home .home-room__title')).map((n) => n.textContent)
const sceneNames = () => Array.from(document.querySelectorAll('.home__scenes .home-scene')).map((n) => n.textContent?.trim())
const tools = (label: string) => document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
const lastPatch = () => world.patches[world.patches.length - 1]

describe('Home page TVs', () => {
  beforeEach(() => {
    install()
    world.home = houseWithRooms()
  })
  afterEach(async () => {
    unmount()
    vi.unstubAllGlobals()
    await new Promise((r) => setTimeout(r, 420))
  })

  it('a TV is a tile showing what it is on, and a tap turns it off', async () => {
    renderPage()
    await settle()
    expect(tile('TV').textContent).toContain('HDMI1')
        click(tile('TV'))
    await settle()
    expect(world.posts).toEqual([
      { url: '/api/home/entities/media_player.den_tv/action', body: { action: 'turn_off', confirm: false } },
    ])
    expect(tile('TV').textContent).toContain('Off')
  })

  it('its controls have volume, mute and inputs, each sent to Home Assistant', async () => {
    renderPage()
    await settle()
    click(document.querySelector('[aria-label="TV controls"]')!)
    await settle()
    const sheet = document.querySelector('[role=dialog]')!
    click(sheet.querySelector('[aria-label="Volume up"]')!)
    click(sheet.querySelector('[aria-label="Volume down"]')!)
    click(byText('🔈 Mute', sheet)!)
    click(byText('Netflix', sheet)!)
    await settle()
    expect(world.posts.map((p) => p.body)).toEqual([
      { action: 'volume_up', confirm: false },
      { action: 'volume_down', confirm: false },
      { action: 'mute', confirm: false },
      { action: 'select_source', value: 'Netflix', confirm: false },
    ])
    expect(byText('🔇 Muted', sheet)).toBeTruthy()
    // The volume slider is there too, and the TV tile shows no brightness-style bar for it.
    expect(sheet.querySelector('input[type=range]')).toBeTruthy()
    expect(tile('TV').querySelector('.home-tile__bar')).toBeNull()
    expect(tile('TV').querySelector('.home-tile__fill')).toBeNull()
    expect(tile('Basement Lamp').querySelector('.home-tile__fill')).toBeTruthy()
  })

  it('a TV that is off shows only the power button', async () => {
    world.home.rooms[2].entities = [tvEntity({ on: false, state: 'off' })]
    renderPage()
    await settle()
    click(document.querySelector('[aria-label="TV controls"]')!)
    await settle()
    const sheet = document.querySelector('[role=dialog]')!
    expect(byText('Turn on', sheet)).toBeTruthy()
    expect(sheet.querySelector('[aria-label="Volume up"]')).toBeNull()
    expect(sheet.querySelector('input[type=range]')).toBeNull()
    expect(sheet.querySelector('[aria-label=Input]')).toBeNull()
  })
})

describe('Home page edit mode', () => {
  beforeEach(() => {
    install()
    world.home = houseWithRooms()
  })
  afterEach(async () => {
    unmount()
    vi.unstubAllGlobals()
    await new Promise((r) => setTimeout(r, 420))
  })

  const enter = async () => {
    renderPage()
    await settle()
    click(byText('✎ Edit')!)
    await settle()
  }

  it('Edit is a real button, and while editing a tap arranges instead of switching things', async () => {
    await enter()
    expect(document.querySelector('.home')?.getAttribute('data-editing')).toBe('true')
    expect(document.querySelector('h1')?.textContent).toBe('Edit Home Control')
    expect(byText('Done')).toBeTruthy()
    expect(byText('Cancel')).toBeTruthy()
    expect(byText('Reset to default')).toBeTruthy()
    expect(byText('✎ Edit')).toBeUndefined()
    expect(document.querySelector('.home-tile__main')?.tagName).toBe('DIV')
    expect(world.posts).toEqual([])
  })

  it('moves a room later and saves the order for every screen on Done', async () => {
    await enter()
    expect(titles()).toEqual(['Basement', 'Kitchen', 'Den'])
    click(tools('Move Basement later'))
    expect(titles()).toEqual(['Kitchen', 'Basement', 'Den'])
    expect(world.patches).toEqual([]) // nothing is saved until Done
    click(byText('Done')!)
    await settle()
    expect(lastPatch()).toEqual({
      home_layout: { rooms: ['kitchen', 'basement', 'den'], hidden_rooms: [], wide_rooms: [], devices: {}, scenes: [] },
      home_hidden: [],
    })
    expect(document.querySelector('.home')?.getAttribute('data-editing')).toBeNull()
    expect(titles()).toEqual(['Kitchen', 'Basement', 'Den'])
  })

  it('the first room cannot move earlier and the last cannot move later', async () => {
    await enter()
    expect(tools('Move Basement earlier').disabled).toBe(true)
    expect(tools('Move Den later').disabled).toBe(true)
    expect(tools('Move Den earlier').disabled).toBe(false)
  })

  it('reorders devices inside a room', async () => {
    await enter()
    click(tools('Move Bar earlier'))
    click(byText('Done')!)
    await settle()
    expect((lastPatch().home_layout as { devices: unknown }).devices).toEqual({ basement: ['light.b2', 'light.b1'] })
    const names = Array.from(document.querySelectorAll('[aria-label=Basement] .home-tile__name')).map((n) => n.textContent)
    expect(names).toEqual(['Bar', 'Basement Lamp'])
  })

  it('hides a device, and Show brings it back, before anything is saved', async () => {
    await enter()
    click(tools('Hide Bar'))
    expect(tools('Show Bar')).toBeTruthy()
    expect(document.querySelector('[aria-label=Basement]')?.textContent).toContain('Hidden')
    click(tools('Show Bar'))
    expect(tools('Hide Bar')).toBeTruthy()
    click(tools('Hide Bar'))
    click(byText('Done')!)
    await settle()
    expect(lastPatch().home_hidden).toEqual(['light.b2'])
    expect(tile('Basement Lamp')).toBeTruthy()
    expect(Array.from(document.querySelectorAll('.home-tile__name')).map((n) => n.textContent)).not.toContain('Bar')
    expect(document.body.textContent).toContain('1 hidden')
  })

  it('hides a whole room, says so, and a tap on it re-enters Edit to bring it back', async () => {
    await enter()
    click(tools('Hide Kitchen room'))
    click(byText('Done')!)
    await settle()
    expect((lastPatch().home_layout as { hidden_rooms: string[] }).hidden_rooms).toEqual(['kitchen'])
    expect(titles()).toEqual(['Basement', 'Den'])
    click(byText('1 hidden room')!)
    await settle()
    expect(titles()).toEqual(['Basement', 'Kitchen', 'Den'])
    click(tools('Show Kitchen room'))
    click(byText('Done')!)
    await settle()
    expect(titles()).toEqual(['Basement', 'Kitchen', 'Den'])
    expect(byText('1 hidden room')).toBeUndefined()
  })

  it('makes a room wide', async () => {
    await enter()
    click(tools('Den wide'))
    expect(document.querySelector('[aria-label=Den]')?.className).toContain('home-room--wide')
    click(byText('Done')!)
    await settle()
    expect((lastPatch().home_layout as { wide_rooms: string[] }).wide_rooms).toEqual(['den'])
    expect(document.querySelector('[aria-label=Den]')?.className).toContain('home-room--wide')
    expect(document.querySelector('[aria-label=Kitchen]')?.className).not.toContain('home-room--wide')
  })

  it('reorders and hides scene chips', async () => {
    await enter()
    click(tools('Move Away later'))
    click(tools('Hide Home'))
    click(byText('Done')!)
    await settle()
    expect((lastPatch().home_layout as { scenes: string[] }).scenes).toEqual(['scene.b', 'scene.a'])
    expect(lastPatch().home_hidden).toEqual(['scene.b'])
    expect(sceneNames()).toEqual(['Away'])
  })

  it('Cancel throws every change away and saves nothing', async () => {
    await enter()
    click(tools('Move Basement later'))
    click(tools('Hide Bar'))
    click(byText('Cancel')!)
    await settle()
    expect(world.patches).toEqual([])
    expect(titles()).toEqual(['Basement', 'Kitchen', 'Den'])
    expect(tile('Bar')).toBeTruthy()
  })

  it('Reset to default puts the usual order back and shows everything, once Done', async () => {
    world.settings = {
      ...world.settings,
      home_hidden: ['light.b2'],
      home_layout: { rooms: ['den', 'kitchen', 'basement'], hidden_rooms: ['kitchen'], wide_rooms: ['den'], devices: { basement: ['light.b2', 'light.b1'] }, scenes: ['scene.b', 'scene.a'] },
    }
    renderPage()
    await settle()
    expect(titles()).toEqual(['Den', 'Basement'])
    click(byText('✎ Edit')!)
    await settle()
    click(byText('Reset to default')!)
    expect(titles()).toEqual(['Basement', 'Kitchen', 'Den'])
    expect(world.patches).toEqual([]) // still a draft: Cancel could undo it
    click(byText('Done')!)
    await settle()
    expect(lastPatch()).toEqual({
      home_layout: { rooms: [], hidden_rooms: [], wide_rooms: [], devices: {}, scenes: [] },
      home_hidden: [],
    })
    expect(titles()).toEqual(['Basement', 'Kitchen', 'Den'])
    expect(sceneNames()).toEqual(['Away', 'Home'])
  })

  it('shows a layout somebody saved on another screen', async () => {
    world.settings = { ...world.settings, home_layout: { rooms: ['den'], hidden_rooms: [], wide_rooms: [], devices: {}, scenes: [] } }
    renderPage()
    await settle()
    expect(titles()).toEqual(['Den', 'Basement', 'Kitchen'])
  })

  it('a room that appears later goes after the arranged ones', async () => {
    world.settings = { ...world.settings, home_layout: { rooms: ['den', 'basement'], hidden_rooms: [], wide_rooms: [], devices: {}, scenes: [] } }
    world.home.rooms.push({ area_id: 'garage', name: 'Garage', entities: [ent({ entity_id: 'light.g1', name: 'Garage Light', area_id: 'garage' })] })
    renderPage()
    await settle()
    expect(titles()).toEqual(['Den', 'Basement', 'Kitchen', 'Garage'])
  })

  it('says so and stays in Edit mode when saving fails', async () => {
    await enter()
    click(tools('Move Basement later'))
    const original = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    original.mockImplementationOnce(async () => new Response(JSON.stringify({ error: { code: 'error', message: 'nope' } }), { status: 500 }))
    click(byText('Done')!)
    await settle()
    expect(document.querySelector('[role=alert]')?.textContent).toContain("Couldn't save the layout")
    expect(document.querySelector('.home')?.getAttribute('data-editing')).toBe('true')
    expect(titles()).toEqual(['Kitchen', 'Basement', 'Den'])
    click(byText('Done')!)
    await settle()
    expect(document.querySelector('.home')?.getAttribute('data-editing')).toBeNull()
  })

  it('has no Edit button when there is nothing to arrange', async () => {
    world.home = { status: 'ok', message: '', rooms: [], actions: [] }
    renderPage()
    await settle()
    expect(byText('✎ Edit')).toBeUndefined()
  })
})

const rect = (el: HTMLElement, width = 200) => {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: width, bottom: 80, width, height: 80, toJSON: () => ({}),
  })
}

const pointer = (el: HTMLElement, type: string, x: number, y = 10) => {
  act(() => {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: y, button: 0, pointerType: 'touch' }))
  })
}

describe('Home page on-tile slider', () => {
  beforeEach(() => {
    install()
  })
  afterEach(async () => {
    unmount()
    vi.unstubAllGlobals()
    await new Promise((r) => setTimeout(r, 420))
  })

  it('a dimmable light is a slider showing its level, an on/off switch is not', async () => {
    world.home.rooms[0].entities.push(
      ent({ entity_id: 'switch.plug', domain: 'switch', name: 'Plug', adjustable: false, level: null, on: false, state: 'off' }),
    )
    renderPage()
    await settle()
    const lamp = tile('Lamp')
    expect(lamp.getAttribute('role')).toBe('slider')
    expect(lamp.getAttribute('aria-valuenow')).toBe('50')
    expect(lamp.getAttribute('aria-valuemin')).toBe('0')
    expect(lamp.getAttribute('aria-valuemax')).toBe('100')
    expect(lamp.getAttribute('aria-valuetext')).toBe('50%')
    expect(lamp.closest('.home-tile')?.getAttribute('data-slider')).toBe('true')
    expect(lamp.closest('.home-tile')?.querySelector('.home-tile__fill')).toBeTruthy()
    expect(lamp.querySelector('[data-icon=light]')).toBeTruthy()
    expect(tile('Plug').getAttribute('role')).toBeNull()
    expect(tile('Plug').closest('.home-tile')?.getAttribute('data-slider')).toBeNull()
    expect(tile('Front Door').getAttribute('role')).toBeNull()
  })

  it('an off light keeps a gray (off) tile, an on light is marked on', async () => {
    world.home.rooms[0].entities[0] = ent({ on: false, state: 'off', level: 0, name: 'Lamp' })
    renderPage()
    await settle()
    expect(tile('Lamp').closest('.home-tile')?.getAttribute('data-on')).toBe('false')
    expect(tile('Lamp').closest('.home-tile')?.getAttribute('data-domain')).toBe('light')
    world.home.rooms[0].entities[0] = ent({ on: true, state: 'on', level: 80 })
    // Re-render via a live update so the icon on-state flips.
    await push('event: state\ndata: {"entity_id":"light.lamp","state":"on","available":true,"on":true,"level":80,"attrs":{}}\n\n')
    expect(tile('Lamp').closest('.home-tile')?.getAttribute('data-on')).toBe('true')
  })

  it('a short tap still toggles the light, without sending a level', async () => {
    renderPage()
    await settle()
    const lamp = tile('Lamp')
    rect(lamp)
    pointer(lamp, 'pointerdown', 100)
    pointer(lamp, 'pointermove', 104) // under the 8px tap slop
    pointer(lamp, 'pointerup', 104)
    click(lamp)
    await settle()
    expect(world.posts).toEqual([
      { url: '/api/home/entities/light.lamp/action', body: { action: 'turn_off', confirm: false } },
    ])
  })

  it('dragging horizontally sets the level from the pointer, fills the tile, and sends on release', async () => {
    renderPage()
    await settle()
    const lamp = tile('Lamp')
    rect(lamp, 200)
    pointer(lamp, 'pointerdown', 100)
    pointer(lamp, 'pointermove', 160)
    await settle()
    expect(lamp.getAttribute('aria-valuenow')).toBe('80')
    expect(lamp.querySelector('.home-tile__state')?.textContent).toBe('80%')
    expect(lamp.closest('.home-tile')?.getAttribute('data-sliding')).toBe('true')
    expect((lamp.closest('.home-tile') as HTMLElement).style.getPropertyValue('--level')).toBe('80')
    expect(world.posts).toEqual([]) // not until release (or a 300ms throttle)
    pointer(lamp, 'pointerup', 160)
    await settle()
    expect(world.posts).toEqual([
      { url: '/api/home/entities/light.lamp/action', body: { action: 'set_level', value: 80, confirm: false } },
    ])
    expect(lamp.closest('.home-tile')?.getAttribute('data-sliding')).toBeNull()
    expect(lamp.getAttribute('aria-valuenow')).toBe('80')
  })

  it('a vertical move scrolls instead of changing the level or toggling', async () => {
    renderPage()
    await settle()
    const lamp = tile('Lamp')
    rect(lamp)
    pointer(lamp, 'pointerdown', 100, 10)
    pointer(lamp, 'pointermove', 104, 50)
    pointer(lamp, 'pointerup', 104, 50)
    click(lamp)
    await settle()
    expect(world.posts).toEqual([])
    expect(lamp.getAttribute('aria-valuenow')).toBe('50')
    expect(lamp.getAttribute('aria-pressed') ?? lamp.closest('.home-tile')?.getAttribute('data-on')).toBeTruthy()
    expect(tile('Lamp').closest('.home-tile')?.getAttribute('data-on')).toBe('true')
  })

  it('arrow keys adjust a dimmable light by 10%', async () => {
    renderPage()
    await settle()
    const lamp = tile('Lamp')
    act(() => {
      lamp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    })
    await settle()
    expect(world.posts).toEqual([
      { url: '/api/home/entities/light.lamp/action', body: { action: 'set_level', value: 60, confirm: false } },
    ])
    expect(lamp.getAttribute('aria-valuenow')).toBe('60')
    act(() => {
      lamp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    })
    await settle()
    expect(world.posts[1]).toEqual({
      url: '/api/home/entities/light.lamp/action',
      body: { action: 'set_level', value: 50, confirm: false },
    })
  })

  it('a long press still opens the sheet, and does not set a level', async () => {
    renderPage()
    await settle()
    const lamp = tile('Lamp')
    rect(lamp)
    pointer(lamp, 'pointerdown', 100)
    await wait(560)
    pointer(lamp, 'pointerup', 100)
    await settle()
    expect(document.querySelector('[role=dialog]')).toBeTruthy()
    expect(world.posts).toEqual([])
  })

  it('a failed level change is rolled back and explained', async () => {
    renderPage()
    await settle()
    const lamp = tile('Lamp')
    rect(lamp, 200)
    const original = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    original.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ error: { code: 'error', message: 'Home Assistant answered 400.' } }), { status: 502 }),
    )
    pointer(lamp, 'pointerdown', 100)
    pointer(lamp, 'pointermove', 180)
    pointer(lamp, 'pointerup', 180)
    await settle()
    expect(document.querySelector('[role=alert]')?.textContent).toContain('Home Assistant answered 400.')
    // The query is invalidated after a failure, so the tile returns to the last snapshot (50%).
    expect(tile('Lamp').getAttribute('aria-valuenow')).toBe('50')
  })

  it('Edit mode does not expose sliders, so a drag cannot change a device', async () => {
    renderPage()
    await settle()
    click(byText('✎ Edit')!)
    await settle()
    expect(document.querySelector('[role=slider]')).toBeNull()
    expect(document.querySelector('.home-tile__fill')).toBeNull()
  })

  it('a Samsung CU7000 TV gets the thin-bezel flat silhouette', async () => {
    world.home = houseWithRooms()
    renderPage()
    await settle()
    expect(tile('TV').querySelector('[data-icon=tv-flat]')).toBeTruthy()
    expect(tile('TV').closest('.home-tile')?.getAttribute('data-domain')).toBe('media_player')
    expect(tile('TV').getAttribute('role')).toBeNull()
  })
})

describe('Home Control title', () => {
  beforeEach(() => install())
  afterEach(async () => {
    unmount()
    vi.unstubAllGlobals()
    await new Promise((r) => setTimeout(r, 420))
  })

  it('the page is called Home Control, and Edit Home Control while arranging', async () => {
    renderPage()
    await settle()
    expect(document.querySelector('h1')?.textContent).toBe('Home Control')
    click(byText('✎ Edit')!)
    await settle()
    expect(document.querySelector('h1')?.textContent).toBe('Edit Home Control')
    expect(document.body.textContent).toContain('Hide takes one off Home Control')
    click(byText('Cancel')!)
    await settle()
    expect(document.querySelector('h1')?.textContent).toBe('Home Control')
  })

  it('the setup screen carries the same title', async () => {
    world.home = { status: 'not_configured', message: '', rooms: [], actions: [] }
    renderPage()
    await settle()
    expect(document.querySelector('h1')?.textContent).toBe('Home Control')
  })
})

describe('Home tile text clears the ⋯ button', () => {
  const block = (selector: string) => {
    const at = homeCss.indexOf(`\n${selector} {`)
    expect(at).toBeGreaterThan(-1)
    return homeCss.slice(at, homeCss.indexOf('}', at))
  }
  const px = (css: string, prop: string) => Number(new RegExp(`${prop}:\\s*(\\d+)(?:px)?[;\\s]`).exec(css)?.[1])

  it('the text column can shrink, wraps long names, and clamps at two lines', () => {
    expect(block('.home-tile__main')).toContain('grid-template-columns: auto minmax(0, 1fr)')
    const name = block('.home-tile__name')
    expect(name).toContain('min-width: 0')
    expect(name).toContain('overflow-wrap: anywhere')
    expect(name).toContain('-webkit-line-clamp: 2')
    expect(name).toContain('overflow: hidden')
  })

  it('the name reserves at least the width of the ⋯ button, which sits at the tile corner', () => {
    const more = block('.home-tile__more')
    // The global button rule makes every button at least --touch (56px on the wall) wide, which
    // is what really pushed the ⋯ button's edge under the names. Say its width is its width.
    expect(more).toContain('min-width: 0')
    const corner = px(more, 'right') + px(more, 'width')
    const main = block('.home-tile__main')
    const reserved = Number(/padding:\s*\d+px (\d+)px/.exec(main)?.[1]) + 1 + px(block('.home-tile__name'), 'padding-right')
    expect(reserved).toBeGreaterThanOrEqual(corner)
  })

  it('a long name keeps its full text in a tooltip, in the wall and in Edit mode', async () => {
    install()
    world.home = houseWithRooms()
    world.home.rooms[0].entities[0].name = 'Basement Living Room Pendants Over The Bar'
    renderPage()
    await settle()
    expect(tile('Basement Living Room Pendants Over The Bar').querySelector('.home-tile__name')?.getAttribute('title')).toBe(
      'Basement Living Room Pendants Over The Bar',
    )
    click(byText('✎ Edit')!)
    await settle()
    expect(document.querySelector('.home-tile--edit .home-tile__name')?.getAttribute('title')).toBe(
      'Basement Living Room Pendants Over The Bar',
    )
    unmount()
    vi.unstubAllGlobals()
    await new Promise((r) => setTimeout(r, 420))
  })
})


describe('Home Control duotone icons', () => {
  const homeCssNow = () => homeCss

  it('device glyphs are 30px on the phone and 32px on the wall', () => {
    expect(homeCssNow()).toMatch(/\.home-tile__icon \.home-icon,[^{]*\{[^}]*width: 1\.875rem;/)
    expect(homeCssNow()).toMatch(/html\[data-scale='wall'\] \.home-tile__icon \.home-icon,[^{]*\{[^}]*width: 2rem;/)
  })

  it('on-state colors are per type, with a grey off fill, and a fan spin that respects reduced motion', () => {
    expect(homeCssNow()).toMatch(/\[data-domain='light'\][^{]*\{[^}]*--icon-stroke: var\(--icon-light\)/)
    expect(homeCssNow()).toMatch(/\[data-domain='fan'\][^{]*\{[^}]*--icon-stroke: var\(--icon-fan\)/)
    expect(homeCssNow()).toMatch(/\[data-tone='heat'\][^{]*\{[^}]*--icon-stroke: var\(--icon-heat\)/)
    expect(homeCssNow()).toMatch(/\[data-tone='cool'\][^{]*\{[^}]*--icon-stroke: var\(--icon-cool\)/)
    expect(homeCssNow()).toMatch(/\[data-domain='switch'\][^{]*\{[^}]*--icon-stroke: var\(--icon-switch\)/)
    expect(homeCssNow()).toMatch(/\[data-domain='media_player'\][^{]*\{[^}]*--icon-stroke: var\(--icon-tv\)/)
    expect(homeCssNow()).toMatch(/\[data-domain='lock'\][^{]*\{[^}]*--icon-stroke: var\(--icon-slate\)/)
    expect(homeCssNow()).toContain('--icon-fill: var(--icon-off-fill)')
    expect(homeCssNow()).toContain('animation: home-fan-spin')
    expect(homeCssNow()).toContain('prefers-reduced-motion: reduce')
  })
})

describe('Home Control masonry', () => {
  let widthNow = 800
  const heights: Record<string, number> = {}
  let observers: { cb: () => void; targets: Element[] }[] = []
  const originals: Record<string, PropertyDescriptor | undefined> = {}

  beforeEach(() => {
    install()
    world.home = houseWithRooms()
    for (const k of Object.keys(heights)) delete heights[k]
    Object.assign(heights, { 'room:basement': 300, 'room:kitchen': 100, 'room:den': 100 })
    widthNow = 800
    for (const prop of ['clientWidth', 'offsetHeight']) originals[prop] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('home__rooms') ? widthNow : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return heights[this.dataset.cell ?? ''] ?? 0
      },
    })
    observers = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        entry: { cb: () => void; targets: Element[] }
        constructor(cb: () => void) {
          this.entry = { cb, targets: [] }
          observers.push(this.entry)
        }
        observe(el: Element) {
          this.entry.targets.push(el)
        }
        disconnect() {
          this.entry.targets = []
        }
      },
    )
  })
  afterEach(async () => {
    unmount()
    vi.unstubAllGlobals()
    for (const [prop, d] of Object.entries(originals)) {
      if (d) Object.defineProperty(HTMLElement.prototype, prop, d)
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop]
    }
    await new Promise((r) => setTimeout(r, 420))
  })

  const cell = (key: string) => document.querySelector<HTMLElement>(`[data-cell="${key}"]`)!
  const at = (key: string) => [cell(key).style.gridColumn, cell(key).style.gridRow]
  const fire = async () => {
    await act(async () => observers.forEach((o) => o.targets.length && o.cb()))
    await wait(40)
  }

  it('slides a short room up under another short room instead of under a tall one', async () => {
    renderPage()
    await settle()
    const grid = document.querySelector<HTMLElement>('.home__rooms')!
    expect(grid.style.gridTemplateColumns).toMatch(/^repeat\(2, minmax\(0(px)?, 1fr\)\)$/)
    expect(grid.style.gridAutoRows).toBe('4px')
    // Basement (300px + 16 gap = 79 rows) takes the left column; Kitchen (29 rows) the right,
    // and Den (the third room) goes under Kitchen at row 30.
    expect(at('room:basement')).toEqual(['1 / span 1', '1 / span 79'])
    expect(at('room:kitchen')).toEqual(['2 / span 1', '1 / span 29'])
    expect(at('room:den')).toEqual(['2 / span 1', '30 / span 29'])
    // The DOM stays in the saved order, so Tab and the D-pad walk the rooms the way they read.
    expect(Array.from(document.querySelectorAll('[data-cell]')).map((c) => (c as HTMLElement).dataset.cell)).toEqual([
      'room:basement',
      'room:kitchen',
      'room:den',
    ])
  })

  it('reflows when a room changes height (a device wrapping, a tile hidden)', async () => {
    renderPage()
    await settle()
    heights['room:kitchen'] = 400
    await fire()
    // Kitchen is now taller than Basement, so Den goes under Basement instead.
    expect(at('room:den')).toEqual(['1 / span 1', '80 / span 29'])
  })

  it('reflows when the page width changes', async () => {
    renderPage()
    await settle()
    widthNow = 1250
    await fire()
    expect(document.querySelector<HTMLElement>('.home__rooms')!.dataset.columns).toBe('3')
    expect(at('room:den')).toEqual(['3 / span 1', '1 / span 29'])
    widthNow = 360
    await fire()
    expect(document.querySelector<HTMLElement>('.home__rooms')!.dataset.columns).toBe('1')
    expect(at('room:kitchen')).toEqual(['1 / span 1', '80 / span 29'])
  })

  it('a wide room takes two columns and the others fill in beside it', async () => {
    world.settings = {
      ...world.settings,
      home_layout: { rooms: [], hidden_rooms: [], wide_rooms: ['kitchen'], devices: {}, scenes: [] },
    }
    widthNow = 1250
    renderPage()
    await settle()
    // Basement takes column 1. Kitchen is wide: columns 2 and 3 are both free at the top.
    expect(at('room:kitchen')).toEqual(['2 / span 2', '1 / span 29'])
    // Den goes into the highest free spot: under Kitchen's left half.
    expect(at('room:den')).toEqual(['2 / span 1', '30 / span 29'])
    // With a fourth column the next room fills in beside the wide one, at the top.
    widthNow = 1650
    await fire()
    expect(at('room:den')).toEqual(['4 / span 1', '1 / span 29'])
  })

  it('the same packing applies while arranging in Edit mode', async () => {
    renderPage()
    await settle()
    click(byText('✎ Edit')!)
    await settle()
    expect(document.querySelectorAll('.home__rooms > .home-masonry__cell').length).toBe(3)
    expect(cell('basement')).toBeTruthy()
  })
})

describe('Home Control drag and drop', () => {
  // Room cards sit in a row, each tile row below its room, scene chips above.
  const rooms: Record<string, [number, number, number, number]> = {
    basement: [0, 100, 200, 300],
    kitchen: [210, 100, 410, 300],
    den: [420, 100, 620, 300],
  }
  const items: Record<string, [number, number, number, number]> = {
    'light.b1': [10, 160, 100, 210],
    'light.b2': [110, 160, 200, 210],
    'scene.a': [0, 0, 100, 40],
    'scene.b': [110, 0, 220, 40],
  }
  let box: Record<string, [number, number, number, number]>

  beforeEach(() => {
    install()
    world.home = houseWithRooms()
    box = { ...rooms, ...items }
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const b = box[this.dataset.dragId ?? ''] ?? [0, 0, 0, 0]
      return { x: b[0], y: b[1], left: b[0], top: b[1], right: b[2], bottom: b[3], width: b[2] - b[0], height: b[3] - b[1], toJSON: () => ({}) }
    })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    unmount()
    vi.unstubAllGlobals()
    document.body.classList.remove('home-dragging')
    await new Promise((r) => setTimeout(r, 420))
  })

  const enter = async () => {
    renderPage()
    await settle()
    click(byText('✎ Edit')!)
    await settle()
  }
  const send = (target: EventTarget, type: string, x: number, y: number, pointerType = 'mouse') =>
    act(() => {
      target.dispatchEvent(
        new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: y, button: 0, pointerType }),
      )
    })
  const roomEl = (name: string) => document.querySelector<HTMLElement>(`section[aria-label="${name}"]`)!
  const grip = (el: Element) => el.querySelector<HTMLElement>('[data-drag-grip]')!
  const roomGrip = (name: string) => roomEl(name).querySelector<HTMLElement>('.home-room__head [data-drag-grip]')!
  const tileEl = (name: string) =>
    Array.from(document.querySelectorAll<HTMLElement>('.home-tile--edit')).find((t) => t.querySelector('.home-tile__name')?.textContent === name)!
  const chipEl = (name: string) =>
    Array.from(document.querySelectorAll<HTMLElement>('.home-scene-edit')).find((t) => t.textContent?.includes(name))!
  const ghost = () => document.querySelector('[data-testid=drag-ghost]')
  const patchedLayout = () => lastPatch().home_layout as { rooms: string[]; devices: Record<string, string[]>; scenes: string[] }

  it('dragging a room by its handle over another shows a placeholder, reflows live, and saves on Done', async () => {
    await enter()
    send(roomGrip('Basement'), 'pointerdown', 10, 110)
    expect(ghost()).toBeNull() // not yet: a press alone is not a drag
    send(window, 'pointermove', 20, 112)
    expect(ghost()).not.toBeNull()
    expect(document.body.classList.contains('home-dragging')).toBe(true)
    expect(roomEl('Basement').getAttribute('data-drag-state')).toBe('source') // the placeholder
    expect(ghost()?.textContent).toContain('Basement')
    send(window, 'pointermove', 500, 150) // over Den
    expect(titles()).toEqual(['Kitchen', 'Den', 'Basement']) // live reflow, before letting go
    expect(world.patches).toEqual([])
    send(window, 'pointerup', 500, 150)
    expect(ghost()).toBeNull()
    expect(document.body.classList.contains('home-dragging')).toBe(false)
    expect(roomEl('Basement').getAttribute('data-drag-state')).toBeNull()
    expect(titles()).toEqual(['Kitchen', 'Den', 'Basement'])
    expect(world.patches).toEqual([]) // still a draft until Done
    click(byText('Done')!)
    await settle()
    expect(patchedLayout().rooms).toEqual(['kitchen', 'den', 'basement'])
  })

  it('moves the floating copy with the pointer', async () => {
    await enter()
    send(roomGrip('Basement'), 'pointerdown', 10, 110)
    send(window, 'pointermove', 60, 150)
    expect((ghost() as HTMLElement).style.transform).toBe('translate(50px, 40px)')
  })

  it('pressing on a room card body drags it with a mouse, but a plain click does not', async () => {
    await enter()
    const title = roomEl('Kitchen').querySelector('.home-room__title')!
    send(title, 'pointerdown', 220, 110)
    send(window, 'pointermove', 222, 111) // under the threshold
    send(window, 'pointerup', 222, 111)
    expect(ghost()).toBeNull()
    expect(titles()).toEqual(['Basement', 'Kitchen', 'Den'])
    send(title, 'pointerdown', 220, 110)
    send(window, 'pointermove', 100, 110)
    send(window, 'pointermove', 50, 150) // over Basement
    send(window, 'pointerup', 50, 150)
    expect(titles()).toEqual(['Kitchen', 'Basement', 'Den'])
  })

  it('dropping back where it started changes nothing and saves no new order', async () => {
    await enter()
    send(roomGrip('Basement'), 'pointerdown', 10, 110)
    send(window, 'pointermove', 40, 112)
    send(window, 'pointerup', 40, 112)
    expect(titles()).toEqual(['Basement', 'Kitchen', 'Den'])
    click(byText('Done')!)
    await settle()
    expect(patchedLayout().rooms).toEqual([])
  })

  it('Escape puts everything back', async () => {
    await enter()
    send(roomGrip('Basement'), 'pointerdown', 10, 110)
    send(window, 'pointermove', 20, 112)
    send(window, 'pointermove', 500, 150)
    expect(titles()).toEqual(['Kitchen', 'Den', 'Basement'])
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(ghost()).toBeNull()
    send(window, 'pointerup', 500, 150)
    expect(titles()).toEqual(['Basement', 'Kitchen', 'Den'])
    expect(document.body.classList.contains('home-dragging')).toBe(false)
  })

  it('a cancelled pointer (the browser took the touch) also puts everything back', async () => {
    await enter()
    send(roomGrip('Basement'), 'pointerdown', 10, 110, 'touch')
    send(window, 'pointermove', 20, 130, 'touch')
    send(window, 'pointermove', 500, 150, 'touch')
    send(window, 'pointercancel', 500, 150, 'touch')
    expect(ghost()).toBeNull()
    expect(titles()).toEqual(['Basement', 'Kitchen', 'Den'])
  })

  it('a finger on the handle drags straight away, with no hold', async () => {
    await enter()
    send(roomGrip('Basement'), 'pointerdown', 10, 110, 'touch')
    send(window, 'pointermove', 30, 130, 'touch')
    expect(ghost()).not.toBeNull()
    send(window, 'pointermove', 430, 150, 'touch')
    send(window, 'pointerup', 430, 150, 'touch')
    expect(titles()).toEqual(['Kitchen', 'Den', 'Basement'])
  })

  it('a finger on the card body drags after a short hold', async () => {
    await enter()
    const title = roomEl('Basement').querySelector('.home-room__title')!
    send(title, 'pointerdown', 10, 110, 'touch')
    await wait(400)
    expect(ghost()).not.toBeNull()
    send(window, 'pointermove', 300, 150, 'touch')
    send(window, 'pointerup', 300, 150, 'touch')
    expect(titles()).toEqual(['Kitchen', 'Basement', 'Den'])
  })

  it('a finger that moves before the hold is up is scrolling, not dragging', async () => {
    await enter()
    const title = roomEl('Basement').querySelector('.home-room__title')!
    send(title, 'pointerdown', 10, 110, 'touch')
    send(window, 'pointermove', 10, 160, 'touch')
    await wait(400)
    expect(ghost()).toBeNull()
    send(window, 'pointermove', 300, 150, 'touch')
    send(window, 'pointerup', 300, 150, 'touch')
    expect(titles()).toEqual(['Basement', 'Kitchen', 'Den'])
  })

  it('a quick tap on the card body is just a tap', async () => {
    await enter()
    const title = roomEl('Basement').querySelector('.home-room__title')!
    send(title, 'pointerdown', 10, 110, 'touch')
    send(window, 'pointerup', 10, 110, 'touch')
    await wait(400)
    expect(ghost()).toBeNull()
  })

  it('pressing a button (Hide, ◀ ▶, Wide) never starts a drag', async () => {
    await enter()
    const hide = tools('Hide Bar')
    send(hide, 'pointerdown', 150, 180)
    send(window, 'pointermove', 400, 190)
    send(window, 'pointermove', 420, 195)
    expect(ghost()).toBeNull()
    send(window, 'pointerup', 420, 195)
    expect(titles()).toEqual(['Basement', 'Kitchen', 'Den'])
  })

  it('dragging a device moves it within its room only, and the room stays put', async () => {
    await enter()
    send(grip(tileEl('Basement Lamp')), 'pointerdown', 20, 165)
    send(window, 'pointermove', 40, 170)
    expect(tileEl('Basement Lamp').getAttribute('data-drag-state')).toBe('source')
    expect(roomEl('Basement').getAttribute('data-drag-state')).toBeNull() // the room did not start dragging
    send(window, 'pointermove', 150, 180) // over Bar
    send(window, 'pointerup', 150, 180)
    expect(Array.from(document.querySelectorAll('[aria-label=Basement] .home-tile__name')).map((n) => n.textContent)).toEqual([
      'Bar',
      'Basement Lamp',
    ])
    expect(titles()).toEqual(['Basement', 'Kitchen', 'Den'])
    click(byText('Done')!)
    await settle()
    expect(patchedLayout().devices).toEqual({ basement: ['light.b2', 'light.b1'] })
    expect(patchedLayout().rooms).toEqual([])
  })

  it('a device dropped outside its room stays in its room', async () => {
    await enter()
    send(grip(tileEl('Basement Lamp')), 'pointerdown', 20, 165)
    send(window, 'pointermove', 40, 170)
    send(window, 'pointermove', 500, 150) // over the Den room card, not a Basement tile
    send(window, 'pointerup', 500, 150)
    expect(Array.from(document.querySelectorAll('[aria-label=Basement] .home-tile__name')).map((n) => n.textContent)).toEqual([
      'Basement Lamp',
      'Bar',
    ])
  })

  it('a finger held on a device tile drags the tile, not the room', async () => {
    await enter()
    send(tileEl('Basement Lamp').querySelector('.home-tile__name')!, 'pointerdown', 20, 165, 'touch')
    await wait(400)
    expect(tileEl('Basement Lamp').getAttribute('data-drag-state')).toBe('source')
    expect(roomEl('Basement').getAttribute('data-drag-state')).toBeNull()
    send(window, 'pointermove', 150, 180, 'touch')
    send(window, 'pointerup', 150, 180, 'touch')
    expect(tileEl('Basement Lamp').nextElementSibling).toBeNull()
  })

  it('dragging a scene chip reorders the scenes', async () => {
    await enter()
    send(grip(chipEl('Away')), 'pointerdown', 10, 20)
    send(window, 'pointermove', 30, 22)
    expect(chipEl('Away').getAttribute('data-drag-state')).toBe('source')
    send(window, 'pointermove', 160, 20) // over Home
    send(window, 'pointerup', 160, 20)
    click(byText('Done')!)
    await settle()
    expect(patchedLayout().scenes).toEqual(['scene.b', 'scene.a'])
  })

  it('the ◀ ▶ buttons still work, and are the small secondary controls', async () => {
    await enter()
    expect(tools('Move Basement later').className).toContain('home-edit__arrow')
    click(tools('Move Basement later'))
    expect(titles()).toEqual(['Kitchen', 'Basement', 'Den'])
    expect(homeCss).toMatch(/\.home-edit__arrow \{[^}]*width: 32px;\s*min-width: 0/)
  })

  it('the handle is hidden from screen readers, which use the buttons', async () => {
    await enter()
    expect(roomGrip('Basement').getAttribute('aria-hidden')).toBe('true')
    expect(homeCss).toMatch(/\.home-edit__grip \{[^}]*touch-action: none/)
  })

  it('leaving Edit mode mid-drag cleans up', async () => {
    await enter()
    send(roomGrip('Basement'), 'pointerdown', 10, 110)
    send(window, 'pointermove', 20, 112)
    expect(document.body.classList.contains('home-dragging')).toBe(true)
    click(byText('Cancel')!)
    await settle()
    expect(document.body.classList.contains('home-dragging')).toBe(false)
    expect(ghost()).toBeNull()
  })
})


describe('Home page room sensors', () => {
  const sensorEnt = (over: Partial<HomeEntity>): HomeEntity =>
    ent({
      entity_id: 'binary_sensor.kitchen_occupancy',
      domain: 'binary_sensor',
      name: 'Kitchen occupancy',
      state: 'off',
      on: false,
      level: null,
      adjustable: false,
      readonly: true,
      kind: 'sensor',
      device_class: 'occupancy',
      last_changed: new Date(Date.now() - 12 * 60_000).toISOString(),
      ...over,
    })

  beforeEach(() => {
    install()
    world.home = {
      status: 'ok',
      message: '',
      rooms: [
        {
          area_id: 'kitchen',
          name: 'Kitchen',
          entities: [
            ent({ entity_id: 'light.pendant', name: 'Pendant', area_id: 'kitchen', on: false, state: 'off', level: 0 }),
            sensorEnt({}),
          ],
        },
        {
          area_id: 'austins',
          name: "Austin's Bedroom",
          entities: [
            sensorEnt({
              entity_id: 'binary_sensor.austins_motion',
              name: 'Motion',
              area_id: 'austins',
              device_class: 'motion',
              state: 'on',
              on: true,
              last_changed: new Date().toISOString(),
            }),
            sensorEnt({
              entity_id: 'sensor.austins_temperature',
              domain: 'sensor',
              name: 'Temperature',
              area_id: 'austins',
              device_class: 'temperature',
              state: '71.4',
              on: null,
              unit_of_measurement: '°F',
              last_changed: undefined,
            }),
            sensorEnt({
              entity_id: 'sensor.austins_humidity',
              domain: 'sensor',
              name: 'Humidity',
              area_id: 'austins',
              device_class: 'humidity',
              state: '53',
              on: null,
              unit_of_measurement: '%',
              last_changed: undefined,
            }),
          ],
        },
      ],
      actions: [],
    }
  })
  afterEach(async () => {
    unmount()
    vi.unstubAllGlobals()
    await new Promise((r) => setTimeout(r, 420))
  })

  it('shows a compact status strip, not tiles, and a room of only sensors still appears', async () => {
    renderPage()
    await settle()
    const austins = document.querySelector('[aria-label="Austin\'s Bedroom"]')
    expect(austins).toBeTruthy()
    expect(austins!.textContent).toContain('Motion now')
    expect(austins!.textContent).toContain('71°')
    expect(austins!.textContent).toContain('53%')
    expect(austins!.querySelectorAll('.home-tile').length).toBe(0)
    const chips = austins!.querySelectorAll('.home-sensor')
    expect(chips).toHaveLength(3)
    for (const chip of chips) {
      expect(chip.tagName).toBe('LI')
      expect(chip.getAttribute('role')).toBeNull()
      expect((chip as HTMLElement).tabIndex).toBe(-1)
      expect(chip.querySelector('button')).toBeNull()
    }
    expect(austins!.querySelector('[data-active="true"]')?.textContent).toContain('Motion now')
    const kitchen = document.querySelector('[aria-label="Kitchen"]')
    expect(kitchen!.textContent).toContain('Occupied 12 min ago')
    expect(tile('Pendant')).toBeTruthy()
  })

  it('does not send an action when a chip is clicked', async () => {
    renderPage()
    await settle()
    const chip = document.querySelector('.home-sensor') as HTMLElement
    chip.click()
    await settle()
    expect(world.posts).toEqual([])
  })

  it('hides a sensor listed in home_hidden', async () => {
    world.settings = { ...world.settings, home_hidden: ['binary_sensor.austins_motion'] }
    renderPage()
    await settle()
    const austins = document.querySelector('[aria-label="Austin\'s Bedroom"]')
    expect(austins!.textContent).not.toContain('Motion now')
    expect(austins!.textContent).toContain('71°')
  })

  it('updates a chip when a live state event arrives', async () => {
    renderPage()
    await settle()
    await push(
      'event: state\ndata: {"entity_id":"binary_sensor.austins_motion","state":"off","available":true,"on":false,"level":null,"attrs":{},"last_changed":"' +
        new Date(Date.now() - 5 * 60_000).toISOString() +
        '"}\n\n',
    )
    const austins = document.querySelector('[aria-label="Austin\'s Bedroom"]')
    expect(austins!.textContent).toContain('Motion 5 min ago')
    expect(austins!.textContent).not.toContain('Motion now')
  })

  it('styles the strip as flat text, not a tappable tile', () => {
    expect(homeCss).toMatch(/\.home-sensor \{[^}]*cursor: default/)
    expect(homeCss).toMatch(/\.home-sensor \{[^}]*pointer-events: none/)
    expect(homeCss).toMatch(/\.home-sensor \{[^}]*background: none/)
    expect(homeCss).not.toMatch(/\.home-sensor:active/)
    expect(homeCss).not.toMatch(/\.home-sensor:hover/)
    expect(homeCss).toMatch(/\[data-active='true'\] \.home-sensor__dot \{[^}]*--icon-switch/)
  })
})
