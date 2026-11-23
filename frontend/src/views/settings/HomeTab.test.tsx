// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { byText, click, mount, type, unmount } from '../../components/testDom'
import { HomeTab } from './HomeTab'

let settings: Record<string, unknown>
let patches: Record<string, unknown>[]
let testReply: Record<string, unknown>
const SECRET = 'eyJ.super-secret-token'

beforeEach(() => {
  settings = { ha_base_url: 'http://10.0.15.178:8123', home_hidden: [], server: { ha_token_set: true } }
  patches = []
  testReply = { ok: true, status: 'ok', message: 'Connected to Home Assistant: 4 rooms, 20 devices.' }
  const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json' } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url === '/api/settings' && method === 'PATCH') {
        const body = JSON.parse(String(init!.body))
        patches.push(body)
        settings = {
          ...settings,
          ...(body.ha_base_url !== undefined ? { ha_base_url: body.ha_base_url } : {}),
          home_hidden: body.home_hidden ?? settings.home_hidden,
          server: { ha_token_set: body.ha_token === null ? false : true },
        }
        return json(settings)
      }
      if (url === '/api/settings') return json(settings)
      if (url === '/api/home/test') return json(testReply)
      if (url === '/api/home')
        return json({
          status: 'ok', message: '', actions: [],
          rooms: [{ area_id: 'a', name: 'Den', entities: [{ entity_id: 'light.a', name: 'Lamp', domain: 'light', state: 'on', on: true, level: 1, available: true, adjustable: true, attrs: {}, area_id: 'a' }] }],
        })
      return json({})
    }),
  )
})
afterEach(() => {
  unmount()
  vi.unstubAllGlobals()
})

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 5))))
}
const render = async () => {
  mount(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <HomeTab />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await settle()
}
const tokenField = () => document.querySelector<HTMLInputElement>('input[type=password]')!

describe('Home settings', () => {
  it('only says a token is saved, never what it is', async () => {
    await render()
    expect(document.querySelector('[data-testid=token-state]')?.textContent).toBe('Token saved')
    expect(tokenField().value).toBe('')
    expect(tokenField().placeholder).toContain('saved')
    expect(document.body.innerHTML).not.toContain(SECRET)
  })

  it('sends a newly typed token once, then empties the field', async () => {
    await render()
    type(tokenField(), SECRET)
    click(byText('Save')!)
    await settle()
    expect(patches).toEqual([{ ha_token: SECRET }])
    expect(tokenField().value).toBe('')
    expect(document.body.innerHTML).not.toContain(SECRET)
  })

  it('leaves the saved token alone when only the address changes', async () => {
    await render()
    type(document.querySelector<HTMLInputElement>('input[inputmode=url]')!, 'http://ha.local:8123')
    click(byText('Save')!)
    await settle()
    expect(patches).toEqual([{ ha_base_url: 'http://ha.local:8123' }])
  })

  it('Test connection says plainly what happened', async () => {
    await render()
    click(byText('Test connection')!)
    await settle()
    expect(document.querySelector('[role=status]')?.textContent).toContain('Connected to Home Assistant: 4 rooms')
    testReply = { ok: false, status: 'invalid_token', message: 'Home Assistant rejected the access token.' }
    click(byText('Test connection')!)
    await settle()
    expect(document.querySelector('[role=status]')?.textContent).toContain('rejected the access token')
  })

  it('removing the token clears it on the server', async () => {
    await render()
    click(byText('Remove token')!)
    await settle()
    expect(patches).toEqual([{ ha_token: null }])
    expect(document.querySelector('[data-testid=token-state]')?.textContent).toBe('No token saved yet')
  })

  it('lets a device be taken off the wall', async () => {
    await render()
    const box = document.querySelector<HTMLInputElement>('.home-settings__device input')!
    expect(box.checked).toBe(true)
    click(box)
    await settle()
    expect(patches).toContainEqual({ home_hidden: ['light.a'] })
  })
})
