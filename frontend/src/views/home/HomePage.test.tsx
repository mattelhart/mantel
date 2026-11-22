// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { byText, click, mount, tapPointer, unmount, type } from '../../components/testDom'
import { HomePage } from './HomePage'
import type { HomeData, HomeEntity } from './homeModel'

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
    expect(byText('✨ Movie Night')).toBeTruthy()
  })

  it('tapping a light turns it off at once and tells Home Assistant', async () => {
    renderPage()
    await settle()
    click(tile('Lamp'))
    await settle()
    expect(world.posts).toEqual([
      { url: '/api/home/entities/light.lamp/action', body: { action: 'turn_off', confirm: false } },
    ])
    expect(tile('Lamp').getAttribute('aria-pressed')).toBe('false')
  })

  it('a scene is one tap', async () => {
    renderPage()
    await settle()
    click(byText('✨ Movie Night')!)
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
    expect(tile('Lamp').getAttribute('aria-pressed')).toBe('false')
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

const titles = () => Array.from(document.querySelectorAll('.home-room__title')).map((n) => n.textContent)
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
    expect(tile('TV').textContent).toContain('📺')
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
    expect(tile('Basement Lamp').querySelector('.home-tile__bar')).toBeTruthy()
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
    expect(document.querySelector('h1')?.textContent).toBe('Edit Home')
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
    expect(sceneNames()).toEqual(['✨ Away'])
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
    expect(sceneNames()).toEqual(['✨ Away', '✨ Home'])
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
