// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { click, mount, unmount } from '../../components/testDom'
import { API_DOC_LINKS, ApiTab, isWallDisplay } from './ApiTab'

beforeEach(() => {
  delete document.documentElement.dataset.tv
  sessionStorage.clear()
  window.history.replaceState({}, '', '/settings?tab=api')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (href: string) => {
      if (href === '/api/ai-guide') return new Response('# API guide for AI agents\n', { headers: { 'Content-Type': 'text/markdown' } })
      return new Response('missing', { status: 404 })
    }),
  )
})

afterEach(() => {
  unmount()
  delete document.documentElement.dataset.tv
  sessionStorage.clear()
  vi.unstubAllGlobals()
})

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 5))))
}

const render = async () => {
  mount(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ApiTab />
    </QueryClientProvider>,
  )
  await settle()
}

const docAnchors = () =>
  API_DOC_LINKS.map(({ href }) => document.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)).filter(
    (a): a is HTMLAnchorElement => a !== null,
  )

describe('isWallDisplay', () => {
  it('is off in a regular browser', () => {
    expect(isWallDisplay()).toBe(false)
  })

  it('follows the tv dataset the kiosk sets at startup', () => {
    document.documentElement.dataset.tv = 'true'
    expect(isWallDisplay()).toBe(true)
  })

  it('follows a leftover mantel.tv session or ?tv=1', () => {
    sessionStorage.setItem('mantel.tv', '1')
    expect(isWallDisplay()).toBe(true)
    sessionStorage.clear()
    window.history.replaceState({}, '', '/settings?tab=api&tv=1')
    expect(isWallDisplay()).toBe(true)
  })
})

describe('API tab', () => {
  it('opens docs in a new tab from a desktop browser', async () => {
    await render()
    const links = docAnchors()
    expect(links).toHaveLength(API_DOC_LINKS.length)
    for (const a of links) {
      expect(a.target).toBe('_blank')
      expect(a.rel.split(/\s+/)).toContain('noopener')
    }
    expect(document.body.textContent).toContain('API guide for AI agents')
    expect(document.querySelector('.api-tab__urls')).toBeNull()
  })

  it('does not link to raw pages on the wall, and shows copyable addresses instead', async () => {
    document.documentElement.dataset.tv = 'true'
    const written: string[] = []
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn(async (text: string) => { written.push(text) }) },
    })
    await render()

    expect(docAnchors()).toHaveLength(0)
    expect(document.querySelectorAll('a[href="/api/docs"], a[href="/api/redoc"], a[href="/api/openapi.json"], a[href="/api/ai-guide"]')).toHaveLength(0)

    for (const { href, label } of API_DOC_LINKS) {
      const url = new URL(href, window.location.origin).href
      expect(document.body.textContent).toContain(label)
      expect(document.body.textContent).toContain(url)
    }

    const firstCopy = Array.from(document.querySelectorAll<HTMLButtonElement>('.api-tab__url .btn')).find(
      (b) => b.textContent === 'Copy',
    )!
    click(firstCopy)
    await settle()
    expect(written).toEqual([new URL('/api/docs', window.location.origin).href])
    expect(firstCopy.textContent).toBe('Copied')
  })
})
