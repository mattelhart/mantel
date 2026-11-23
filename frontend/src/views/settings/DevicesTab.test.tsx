// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { byText, click, mount, unmount } from '../../components/testDom'
import { DevicesTab } from './DevicesTab'

const minted: string[] = []

beforeEach(() => {
  minted.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json' } })
      if (url.startsWith('/api/auth/pairing-codes') && init?.method === 'POST') {
        minted.push(url)
        return json({ code: 'K7NQ-4RMP', expires_at: new Date(Date.now() + 600_000).toISOString(), qr_svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' })
      }
      return json([])
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
      <DevicesTab />
    </QueryClientProvider>,
  )
  await settle()
}

describe('Devices tab', () => {
  it('pairs a phone and tells you to enter it in the app', async () => {
    await render()
    click(byText('Pair a phone')!)
    await settle()
    expect(document.querySelector('.pair__code')?.textContent).toBe('K7NQ-4RMP')
    expect(document.querySelector('.pair__meta')?.textContent).toContain('phone app')
  })

  it('pairs a TV with the same code and says to type it on the TV', async () => {
    await render()
    click(byText('Pair a TV')!)
    await settle()
    expect(minted).toHaveLength(1)
    expect(document.querySelector('.pair__code')?.textContent).toBe('K7NQ-4RMP')
    expect(document.querySelector('.pair__meta')?.textContent).toContain('On the TV')
    expect(byText('New TV code')).toBeTruthy()
  })
})
