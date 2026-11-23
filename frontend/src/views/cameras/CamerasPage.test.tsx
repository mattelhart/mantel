// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { click, mount, unmount } from '../../components/testDom'
import { CameraViewPage, CamerasPage } from './CamerasPage'
import { isConnected, snapshotUrl } from './model'

const CAMERAS = {
  configured: true,
  cameras: [
    { id: 'front-door', name: 'Front Door Camera', state: 'CONNECTED' },
    { id: 'g5-dome', name: 'G5 Dome', state: 'DISCONNECTED' },
    { id: 'driveway', name: 'Driveway', state: 'CONNECTED' },
    { id: 'brooklyns-bedroom', name: "Brooklyn's Bedroom", state: 'CONNECTED' },
  ],
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return mount(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/cameras" element={<CamerasPage />} />
          <Route path="/cameras/:id" element={<CameraViewPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function waitFor(predicate: () => boolean, label: string) {
  for (let i = 0; i < 40; i += 1) {
    if (predicate()) return
    await act(async () => {
      await Promise.resolve()
      if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0)
      else await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error(`timed out waiting for ${label}`)
}

describe('camera helpers', () => {
  it('treats only CONNECTED as live and aligns snapshot cache keys to 2s', () => {
    expect(isConnected('CONNECTED')).toBe(true)
    expect(isConnected('DISCONNECTED')).toBe(false)
    expect(snapshotUrl('front-door', 4000)).toBe('/api/cameras/front-door/snapshot?t=2')
    expect(snapshotUrl('front-door', 5999)).toBe('/api/cameras/front-door/snapshot?t=2')
  })
})

describe('Cameras page', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).startsWith('/api/cameras') && !String(url).includes('/snapshot')) {
          return new Response(JSON.stringify(CAMERAS), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        return new Response('not found', { status: 404 })
      }),
    )
  })

  afterEach(() => {
    unmount()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('renders the four household cameras and greys a disconnected one', async () => {
    const root = renderAt('/cameras')
    await waitFor(() => Boolean(root.textContent?.includes('Front Door Camera')), 'camera tiles')
    expect(root.textContent).toContain('Front Door Camera')
    expect(root.textContent).toContain('G5 Dome')
    expect(root.textContent).toContain('Driveway')
    expect(root.textContent).toContain("Brooklyn's Bedroom")
    const dome = Array.from(root.querySelectorAll('.cameras__tile')).find((tile) =>
      tile.textContent?.includes('G5 Dome'),
    )
    expect(dome?.getAttribute('data-offline')).toBe('true')
    expect(dome?.querySelector('img')).toBeNull()
    const front = Array.from(root.querySelectorAll('.cameras__tile')).find((tile) =>
      tile.textContent?.includes('Front Door Camera'),
    )
    expect(front?.querySelector('img')?.getAttribute('src')).toMatch(/\/api\/cameras\/front-door\/snapshot/)
  })

  it('opens a full-screen view with a Back button', async () => {
    const root = renderAt('/cameras')
    await waitFor(() => Boolean(root.textContent?.includes('Front Door Camera')), 'camera tiles')
    const front = Array.from(root.querySelectorAll('a.cameras__tile')).find((tile) =>
      tile.textContent?.includes('Front Door Camera'),
    )
    click(front!)
    await flush()
    expect(root.querySelector('.camview__title')?.textContent).toBe('Front Door Camera')
    expect(root.querySelector('.camview__back')?.textContent).toMatch(/Back/)
    expect(root.querySelector('.camview__shot')?.getAttribute('src')).toMatch(/\/api\/cameras\/front-door\/snapshot/)
  })

  it('pauses snapshot refreshes while the tab is hidden', async () => {
    vi.useFakeTimers()
    const root = renderAt('/cameras')
    await waitFor(() => Boolean(root.textContent?.includes('Front Door Camera')), 'camera tiles')
    const front = () =>
      Array.from(root.querySelectorAll('.cameras__tile'))
        .find((tile) => tile.textContent?.includes('Front Door Camera'))
        ?.querySelector('img')
        ?.getAttribute('src')

    const first = front()
    await act(async () => {
      vi.advanceTimersByTime(3000)
    })
    const afterTick = front()
    expect(afterTick).not.toBe(first)

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
    const hiddenAt = front()
    await act(async () => {
      vi.advanceTimersByTime(9000)
    })
    expect(front()).toBe(hiddenAt)
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
  })

  it('explains when Protect is not configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(JSON.stringify({ configured: false, cameras: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )
    const root = renderAt('/cameras')
    await waitFor(() => Boolean(root.textContent?.match(/not configured/i)), 'not configured message')
    expect(root.textContent).toMatch(/not configured/i)
    expect(root.textContent).toContain('UNIFI_PROTECT_KEY_FILE')
  })
})
