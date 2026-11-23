import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { authHeaders } from '../../api/client'
import { Markdown } from '../../components/Markdown'

export const API_DOC_LINKS = [
  { href: '/api/docs', label: 'Interactive docs' },
  { href: '/api/redoc', label: 'Reference' },
  { href: '/api/openapi.json', label: 'OpenAPI schema' },
  { href: '/api/ai-guide', label: 'Guide as markdown' },
] as const

/** The wall kiosk and TVs set this when they open with ?tv=1. Raw pages have
 *  no app chrome, so a tap on /api/docs or /api/openapi.json leaves no way back. */
export function isWallDisplay(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.dataset.tv === 'true') return true
  try {
    if (sessionStorage.getItem('mantel.tv') === '1') return true
  } catch {
    // private mode, or storage blocked
  }
  return new URLSearchParams(location.search).get('tv') === '1'
}

function absoluteUrl(path: string): string {
  return new URL(path, window.location.origin).href
}

/** Renders the same markdown that /api/ai-guide serves, so what a person reads here and
 *  what an agent fetches can never drift apart. */
export function ApiTab() {
  const wall = isWallDisplay()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['ai-guide'],
    queryFn: async () => {
      const res = await fetch('/api/ai-guide', { headers: authHeaders() })
      if (!res.ok) throw new Error(`ai-guide ${res.status}`)
      return res.text()
    },
    // The guide ships inside the image; it only changes when the app is redeployed.
    refetchInterval: false,
    staleTime: Infinity,
  })

  return (
    <section className="panel">
      <h2>API</h2>
      <p className="hint">
        Everything this app can do is available over HTTP. The wall display and the rest of
        the home network need no token. A phone away from home pairs under Devices and then
        sends <code>Authorization: Bearer</code>. The guide below is what to hand an agent.
      </p>

      {wall ? <WallDocAddresses /> : <DocLinks />}

      <div className="docs__body">
        {isLoading && <p className="hint">Loading the guide…</p>}
        {isError && (
          <p className="hint">
            Couldn't load the guide. It is also at <code>/api/ai-guide</code>.
          </p>
        )}
        {data && <Markdown source={data} />}
      </div>
    </section>
  )
}

function DocLinks() {
  return (
    <div className="row">
      {API_DOC_LINKS.map(({ href, label }) => (
        <a key={href} className="btn" href={href} target="_blank" rel="noopener">
          {label}
        </a>
      ))}
    </div>
  )
}

function WallDocAddresses() {
  return (
    <div className="api-tab__wall">
      <p className="hint">
        These pages leave the wall display, so they are not links here. Open them on a
        phone, or copy the address.
      </p>
      <ul className="api-tab__urls">
        {API_DOC_LINKS.map(({ href, label }) => (
          <li key={href} className="api-tab__url">
            <div className="row__name row__name--static">{label}</div>
            <code>{absoluteUrl(href)}</code>
            <CopyButton text={absoluteUrl(href)} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // The address is still selectable if the clipboard is unavailable.
    }
  }

  return (
    <button type="button" className="btn" onClick={() => void copy()}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
