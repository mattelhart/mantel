import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../api/client'
import { useHome } from '../../api/home'
import { useSettings } from '../../api/hooks'
import type { AppSettings } from '../../api/types'

interface TestResult {
  ok: boolean
  status: string
  message: string
}

/** Where Home Assistant is and the key to it. The key goes to the server and is never
 *  shown again: this page only ever learns whether one is saved. */
export function HomeTab() {
  const qc = useQueryClient()
  const { data: settings } = useSettings()
  const { data: home } = useHome('connecting')
  const [url, setUrl] = useState<string | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!settings) return null
  const tokenSaved = settings.server.ha_token_set
  const shownUrl = url ?? settings.ha_base_url
  const dirty = (url !== null && url !== settings.ha_base_url) || token.trim() !== ''

  const patch = async (body: Record<string, unknown>) => {
    await api.patch<AppSettings>('/settings', body)
    await qc.invalidateQueries({ queryKey: ['settings'] })
    void qc.invalidateQueries({ queryKey: ['home'] })
  }

  const save = async (): Promise<boolean> => {
    setError(null)
    const body: Record<string, unknown> = {}
    if (url !== null && url !== settings.ha_base_url) body.ha_base_url = url.trim()
    if (token.trim()) body.ha_token = token.trim()
    try {
      if (Object.keys(body).length) await patch(body)
      setToken('')
      setUrl(null)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.")
      return false
    }
  }

  const test = async () => {
    setBusy(true)
    setResult(null)
    try {
      if (dirty && !(await save())) return
      setResult(await api.post<TestResult>('/home/test'))
    } catch (e) {
      setResult({ ok: false, status: 'error', message: e instanceof Error ? e.message : 'Test failed.' })
    } finally {
      setBusy(false)
    }
  }

  const forget = async () => {
    setError(null)
    try {
      await patch({ ha_token: null })
      setResult(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove it.")
    }
  }

  const hidden = new Set(settings.home_hidden ?? [])
  const devices = [...(home?.rooms ?? []).flatMap((r) => r.entities), ...(home?.actions ?? [])]
  const setHidden = (id: string, hide: boolean) => {
    const next = hide ? [...hidden, id] : [...hidden].filter((x) => x !== id)
    void patch({ home_hidden: next }).catch(() => setError("Couldn't save that."))
  }

  return (
    <section className="panel">
      <h2>Home control</h2>
      <p className="hint">
        Homie controls your lights, fans, shades, TVs, locks and scenes through{' '}
        <strong>Home Assistant</strong>. Add Lutron Caseta, SmartThings and the rest to Home
        Assistant, and they appear on Home Control automatically, grouped by room.
      </p>

      <div className="row">
        <div className="row__name row__name--static">
          Home Assistant address
          <div className="hint">Where Homie reaches it, e.g. http://10.0.15.178:8123</div>
        </div>
        <input
          className="row__name"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="http://homeassistant.local:8123"
          value={shownUrl}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>

      <div className="row">
        <div className="row__name row__name--static">
          Long-lived access token
          <div className="hint">
            In Home Assistant: your profile → Security → Long-lived access tokens → Create token
          </div>
        </div>
        <input
          className="row__name"
          type="password"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Long-lived access token"
          placeholder={tokenSaved ? '•••••••• saved. Paste a new one to replace it' : 'Paste the token'}
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </div>

      <div className="home-settings__actions">
        <button className="btn btn--primary" onClick={() => void save()} disabled={!dirty || busy}>
          Save
        </button>
        <button className="btn" onClick={() => void test()} disabled={busy || (!tokenSaved && !token.trim())}>
          {busy ? 'Testing…' : 'Test connection'}
        </button>
        {tokenSaved && (
          <button className="btn btn--danger" onClick={() => void forget()} disabled={busy}>
            Remove token
          </button>
        )}
        <span className="hint" data-testid="token-state">
          {tokenSaved ? 'Token saved' : 'No token saved yet'}
        </span>
      </div>

      {error && <p className="banner banner--warn" role="alert">{error}</p>}
      {result && (
        <p className={result.ok ? 'banner' : 'banner banner--warn'} role="status">
          {result.ok ? '✓ ' : ''}
          {result.message}
        </p>
      )}

      {devices.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>Show on Home Control</h2>
          <p className="hint">Untick anything you don't want on the wall, such as a switch that only runs a pump.</p>
          <div className="home-settings__devices">
            {devices.map((d) => (
              <label key={d.entity_id} className="home-settings__device">
                <input
                  type="checkbox"
                  checked={!hidden.has(d.entity_id)}
                  onChange={(e) => setHidden(d.entity_id, !e.target.checked)}
                />
                <span>{d.name}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
