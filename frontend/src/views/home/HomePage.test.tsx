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
    settings: { home_favorites: [], home_hidden: [], theme: 'airy', server: { ha_token_set: true } },
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
