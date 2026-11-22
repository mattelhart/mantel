import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../api/client'
import { useSettings, useUsers } from '../../api/hooks'
import type { AppSettings, User } from '../../api/types'

interface TestResult {
  id?: number
  status?: string
  error_message?: string | null
}

/** Twilio credentials for family texting. The SID and Auth Token are write-only:
 *  this page only ever learns whether they are saved. */
export function MessagesTab() {
  const qc = useQueryClient()
  const { data: settings } = useSettings()
  const { data: users = [] } = useUsers()
  const [sid, setSid] = useState('')
  const [token, setToken] = useState('')
  const [from, setFrom] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [target, setTarget] = useState<number | ''>('')

  if (!settings) return null

  const sidSaved = Boolean(settings.server.twilio_account_sid_set)
  const tokenSaved = Boolean(settings.server.twilio_auth_token_set)
  const shownFrom = from ?? settings.twilio_from_number ?? ''
  const people = users.filter((u) => u.phone)
  const dirty =
    sid.trim() !== '' ||
    token.trim() !== '' ||
    (from !== null && from !== (settings.twilio_from_number ?? ''))

  const patch = async (body: Record<string, unknown>) => {
    await api.patch<AppSettings>('/settings', body)
    await qc.invalidateQueries({ queryKey: ['settings'] })
    await qc.invalidateQueries({ queryKey: ['messages'] })
  }

  const save = async (): Promise<boolean> => {
    setError(null)
    const body: Record<string, unknown> = {}
    if (sid.trim()) body.twilio_account_sid = sid.trim()
    if (token.trim()) body.twilio_auth_token = token.trim()
    if (from !== null && from !== (settings.twilio_from_number ?? '')) {
      body.twilio_from_number = from.trim()
    }
    try {
      if (Object.keys(body).length) await patch(body)
      setSid('')
      setToken('')
      setFrom(null)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.")
      return false
    }
  }

  const sendTest = async () => {
    setBusy(true)
    setResult(null)
    setError(null)
    try {
      if (dirty && !(await save())) return
      const body: { user_id?: number } = {}
      if (target !== '') body.user_id = target
      const sent = await api.post<TestResult>('/messages/test', body)
      const who = people.find((u) => u.id === (body.user_id ?? sent.id))
      setResult(`Test sent${who ? ` to ${who.name}` : ''}${sent.status ? ` (${sent.status})` : ''}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send a test.")
    } finally {
      setBusy(false)
    }
  }

  const forget = async () => {
    setError(null)
    setResult(null)
    try {
      await patch({ twilio_account_sid: null, twilio_auth_token: null, twilio_from_number: '' })
      setSid('')
      setToken('')
      setFrom('')
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove it.")
    }
  }

  return (
    <section className="panel">
      <h2>Messages</h2>
      <p className="hint">
        Send notes and doodles from the wall to a family member's phone as a regular text
        message, and show their replies on the wall. You need a Twilio account and a
        toll-free number. The Account SID and Auth Token are stored on the server and are
        never shown again.
      </p>

      <div className="row">
        <div className="row__name row__name--static">
          Account SID
          <div className="hint">From the Twilio console, starting with AC</div>
        </div>
        <input
          className="row__name"
          type="password"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Twilio Account SID"
          placeholder={sidSaved ? '•••••••• saved. Paste a new one to replace it' : 'ACxxxxxxxx'}
          value={sid}
          onChange={(e) => setSid(e.target.value)}
        />
      </div>

      <div className="row">
        <div className="row__name row__name--static">
          Auth Token
          <div className="hint">The token next to the SID in the Twilio console</div>
        </div>
        <input
          className="row__name"
          type="password"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Twilio Auth Token"
          placeholder={tokenSaved ? '•••••••• saved. Paste a new one to replace it' : 'Paste the Auth Token'}
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </div>

      <div className="row">
        <div className="row__name row__name--static">
          From number
          <div className="hint">Your Twilio toll-free number, like +18005551212</div>
        </div>
        <input
          className="row__name"
          inputMode="tel"
          autoComplete="off"
          placeholder="+18005551212"
          value={shownFrom}
          onChange={(e) => setFrom(e.target.value)}
        />
      </div>

      <div className="row">
        <div className="row__name row__name--static">Send a test to</div>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">First family member with a number</option>
          {people.map((u: User) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.phone})
            </option>
          ))}
        </select>
      </div>

      <div className="home-settings__actions">
        <button className="btn btn--primary" onClick={() => void save()} disabled={!dirty || busy}>
          Save
        </button>
        <button
          className="btn"
          onClick={() => void sendTest()}
          disabled={busy || (!sidSaved && !sid.trim()) || (!tokenSaved && !token.trim())}
        >
          {busy ? 'Sending…' : 'Send test'}
        </button>
        {(sidSaved || tokenSaved) && (
          <button className="btn btn--danger" onClick={() => void forget()} disabled={busy}>
            Remove credentials
          </button>
        )}
        <span className="hint" data-testid="twilio-state">
          {settings.server.twilio_configured
            ? 'Twilio is set up'
            : sidSaved || tokenSaved
              ? 'Finish the From number to finish setup'
              : 'Not set up yet'}
        </span>
      </div>

      {error && (
        <p className="banner banner--warn" role="alert">
          {error}
        </p>
      )}
      {result && (
        <p className="banner" role="status">
          {result}
        </p>
      )}
    </section>
  )
}
