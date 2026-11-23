// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { byText, click, mount, unmount } from '../../components/testDom'
import { DevicesTab } from './DevicesTab'
import { isLoopbackHost, qrDataUri } from './qr'

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

  it('shows the QR as an image the browser can draw', async () => {
    await render()
    click(byText('Pair a phone')!)
    await settle()
    const img = document.querySelector<HTMLImageElement>('.pair__qr')!
    expect(img.src).toContain('data:image/svg+xml')
    expect(decodeURIComponent(img.src)).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(img.alt).toContain('K7NQ-4RMP')
  })
})

describe('qrDataUri', () => {
  const decode = (uri: string) => decodeURIComponent(uri.slice(uri.indexOf(',') + 1))

  it('adds the namespace an <img> needs when the server left it out', () => {
    const old = '<svg width="180" height="180" class="segno"><path d="M0 0h1"/></svg>'
    const out = decode(qrDataUri(old))
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(out).toContain('viewBox="0 0 180 180"') // so CSS can size it
    expect(out).toContain('<path d="M0 0h1"/>')
    expect(new DOMParser().parseFromString(out, 'image/svg+xml').querySelector('parsererror')).toBeNull()
  })

  it('leaves a complete document alone', () => {
    const full = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 53 53" width="53" height="53"><path d="M0 0"/></svg>'
    expect(decode(qrDataUri(full))).toBe(full)
    expect(qrDataUri(`  \n${full}\n`)).toBe(qrDataUri(full))
  })

  it('does not double the namespace on a single-quoted one', () => {
    const q = "<svg xmlns='http://www.w3.org/2000/svg' width=\"9\" height=\"9\"/>"
    expect(decode(qrDataUri(q)).match(/xmlns=/g)).toHaveLength(1)
  })
})

describe('isLoopbackHost', () => {
  it('knows the names a phone cannot reach', () => {
    for (const h of ['localhost', 'LOCALHOST', 'wall.localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]']) expect(isLoopbackHost(h)).toBe(true)
    for (const h of ['10.0.15.178', 'familycal.local', '192.168.1.20', 'mantel.example.com', '']) expect(isLoopbackHost(h)).toBe(false)
  })
})
