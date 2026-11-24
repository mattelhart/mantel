import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, authHeaders } from '../../api/client'
import { useSettings, useUsers } from '../../api/hooks'
import type { AppSettings, User } from '../../api/types'

interface TestResult {
  id?: number
  status?: string
  error_message?: string | null
}

interface SignalStatus {
  reachable: boolean
  linked: boolean
  accounts: { number: string; aci: string }[]
  mode: string
  error: string | null
  account_number?: string
}

interface UnlinkedSender {
  signal_uuid: string
  name: string
  last_seen: string | null
  message_count: number
}

type Provider = 'twilio' | 'signal'

/** Credentials for family texting. Twilio SID and Auth Token are write-only:
 *  this page only ever learns whether they are saved. Signal talks to a local
 *  container and has no secrets to hide. */
export function MessagesTab() {
  const { data: settings } = useSettings()
  if (!settings) return null
  const provider = (settings.message_provider === 'signal' ? 'signal' : 'twilio') as Provider
  return (
    <section className="panel">
      <h2>Messages</h2>
      <p className="hint">
        Send notes and doodles from the wall to a family member's phone, and show their replies
        here. Choose Twilio for regular text messages, or Signal if you are running the
        signal-cli container on this PC.
      </p>
      <ProviderPicker current={provider} />
      {provider === 'signal' ? <SignalSettings settings={settings} /> : <TwilioSettings settings={settings} />}
    </section>
  )
}

function ProviderPicker({ current }: { current: Provider }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choose = async (provider: Provider) => {
    if (provider === current || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.patch<AppSettings>('/settings', { message_provider: provider })
      await qc.invalidateQueries({ queryKey: ['settings'] })
      await qc.invalidateQueries({ queryKey: ['messages'] })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't switch provider.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="row">
        <div className="row__name row__name--static">Provider</div>
        <div className="messages-provider" role="radiogroup" aria-label="Messaging provider">
          <button
            type="button"
            role="radio"
            aria-checked={current === 'twilio'}
            className="messages-provider__btn"
            disabled={busy}
            onClick={() => void choose('twilio')}
          >
            Twilio
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={current === 'signal'}
            className="messages-provider__btn"
            disabled={busy}
            onClick={() => void choose('signal')}
          >
            Signal
          </button>
        </div>
      </div>
      {error && (
        <p className="banner banner--warn" role="alert">
          {error}
        </p>
      )}
    </>
  )
}

function TwilioSettings({ settings }: { settings: AppSettings }) {
  const qc = useQueryClient()
  const { data: users = [] } = useUsers()
  const [sid, setSid] = useState('')
  const [token, setToken] = useState('')
  const [from, setFrom] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [target, setTarget] = useState<number | ''>('')

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
    <>
      <p className="hint">
        You need a Twilio account and a toll-free number. The Account SID and Auth Token are
        stored on the server and are never shown again.
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

      <TestTarget people={people} target={target} onChange={setTarget} />

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
    </>
  )
}

function SignalSettings({ settings }: { settings: AppSettings }) {
  const qc = useQueryClient()
  const { data: users = [] } = useUsers()
  const [url, setUrl] = useState<string | null>(null)
  const [number, setNumber] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [linking, setLinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [target, setTarget] = useState<number | ''>('')

  const shownUrl = url ?? settings.signal_api_url ?? 'http://host.docker.internal:8081'
  const shownNumber = number ?? settings.signal_account_number ?? ''
  const people = users.filter((u) => u.phone)
  const dirty =
    (url !== null && url !== (settings.signal_api_url ?? '')) ||
    (number !== null && number !== (settings.signal_account_number ?? ''))

  const status = useQuery({
    queryKey: ['signal-status'],
    queryFn: () => api.get<SignalStatus>('/messages/signal/status'),
    refetchInterval: linking ? 2000 : 15_000,
  })

  useEffect(() => {
    const info = status.data
    if (!info?.linked) return
    if (info.account_number && info.account_number !== (settings.signal_account_number ?? '')) {
      void qc.invalidateQueries({ queryKey: ['settings'] })
    }
  }, [status.data, settings.signal_account_number, qc])

  const patch = async (body: Record<string, unknown>) => {
    await api.patch<AppSettings>('/settings', body)
    await qc.invalidateQueries({ queryKey: ['settings'] })
    await qc.invalidateQueries({ queryKey: ['messages'] })
    await qc.invalidateQueries({ queryKey: ['signal-status'] })
  }

  const save = async (): Promise<boolean> => {
    setError(null)
    const body: Record<string, unknown> = {}
    if (url !== null && url !== (settings.signal_api_url ?? '')) body.signal_api_url = url.trim()
    if (number !== null && number !== (settings.signal_account_number ?? '')) {
      body.signal_account_number = number.trim()
    }
    try {
      if (Object.keys(body).length) await patch(body)
      setUrl(null)
      setNumber(null)
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

  const linked = Boolean(status.data?.linked)
  const statusHint = status.data?.error
    ? status.data.error
    : linked
      ? `Linked${status.data?.account_number ? ` as ${status.data.account_number}` : ''}`
      : status.data?.reachable
        ? 'API is running. Link this device to Signal.'
        : 'Not linked yet. Start the signal-api container, then link.'

  return (
    <>
      <p className="hint">
        Run the signal-cli REST API container on this PC, then link it as a device from the
        Signal app on your phone. Family phone numbers stay the same as in Settings → Family.
      </p>

      <div className="row">
        <div className="row__name row__name--static">
          API address
          <div className="hint">The signal-api container, usually http://host.docker.internal:8081</div>
        </div>
        <input
          className="row__name"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Signal API address"
          placeholder="http://host.docker.internal:8081"
          value={shownUrl}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>

      <div className="row">
        <div className="row__name row__name--static">
          Signal account number
          <div className="hint">The number on your Signal account, like +15551234567. Filled in after you link.</div>
        </div>
        <input
          className="row__name"
          inputMode="tel"
          autoComplete="off"
          aria-label="Signal account number"
          placeholder="+15551234567"
          value={shownNumber}
          onChange={(e) => setNumber(e.target.value)}
        />
      </div>

      <TestTarget people={people} target={target} onChange={setTarget} />

      <div className="home-settings__actions">
        <button className="btn btn--primary" onClick={() => void save()} disabled={!dirty || busy}>
          Save
        </button>
        <button type="button" className="btn btn--primary" onClick={() => setLinking(true)} disabled={busy}>
          Link to Signal
        </button>
        <button
          className="btn"
          onClick={() => void sendTest()}
          disabled={busy || !settings.server.signal_configured}
        >
          {busy ? 'Sending…' : 'Send test'}
        </button>
        <span className="hint" data-testid="signal-state">
          {statusHint}
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

      <UnlinkedSenders users={users} enabled={Boolean(settings.server.signal_configured)} />

      {linking && (
        <SignalLinkScreen
          alreadyLinked={linked}
          onBack={() => {
            setLinking(false)
            void qc.invalidateQueries({ queryKey: ['settings'] })
            void qc.invalidateQueries({ queryKey: ['signal-status'] })
          }}
        />
      )}
    </>
  )
}

function SignalLinkScreen({ alreadyLinked, onBack }: { alreadyLinked: boolean; onBack: () => void }) {
  const qc = useQueryClient()
  const [qr, setQr] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const status = useQuery({
    queryKey: ['signal-status'],
    queryFn: () => api.get<SignalStatus>('/messages/signal/status'),
    refetchInterval: 2000,
  })
  const linked = Boolean(status.data?.linked || alreadyLinked)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const res = await fetch('/api/messages/signal/qr', { headers: authHeaders() })
        if (!res.ok) {
          let message = "Couldn't make a QR code."
          try {
            const body = await res.json()
            message = body?.error?.message || message
          } catch {
            /* not JSON */
          }
          throw new Error(message)
        }
        const blob = await res.blob()
        objectUrl = URL.createObjectURL(blob)
        if (!cancelled) setQr(objectUrl)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't make a QR code.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [])

  useEffect(() => {
    if (linked) {
      void qc.invalidateQueries({ queryKey: ['settings'] })
    }
  }, [linked, qc])

  return (
    <div className="signal-link" role="dialog" aria-label="Link to Signal">
      <header className="signal-link__bar">
        <button type="button" className="signal-link__back" onClick={onBack}>
          <span aria-hidden>◀</span> Back
        </button>
        <h1 className="signal-link__title">{linked ? 'Linked' : 'Link to Signal'}</h1>
      </header>
      {linked ? (
        <p className="signal-link__status" data-testid="signal-link-state">
          Linked{status.data?.account_number ? ` as ${status.data.account_number}` : ''}. You can
          send notes and doodles from the wall.
        </p>
      ) : (
        <>
          <p className="signal-link__instructions">
            On your phone: Signal → Settings → Linked devices → +, scan this
          </p>
          {loading && <p className="hint">Making a QR code… this can take a moment.</p>}
          {error && (
            <p className="banner banner--warn" role="alert">
              {error}
            </p>
          )}
          {qr && (
            <img className="signal-link__qr" src={qr} alt="QR code to link Homie to Signal" />
          )}
          <p className="hint" data-testid="signal-link-state">
            Waiting for you to scan the code…
          </p>
        </>
      )}
    </div>
  )
}

function formatSeen(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function UnlinkedSenders({ users, enabled }: { users: User[]; enabled: boolean }) {
  const qc = useQueryClient()
  const [choice, setChoice] = useState<Record<string, number | ''>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const listing = useQuery({
    queryKey: ['signal-unlinked'],
    queryFn: () => api.get<{ senders: UnlinkedSender[] }>('/messages/signal/unlinked'),
    enabled,
    refetchInterval: 15_000,
  })
  const senders = listing.data?.senders ?? []
  if (!enabled || senders.length === 0) return null

  const link = async (sender: UnlinkedSender) => {
    const userId = choice[sender.signal_uuid]
    if (userId === undefined || userId === '') return
    setBusy(sender.signal_uuid)
    setError(null)
    try {
      await api.post('/messages/signal/link', { signal_uuid: sender.signal_uuid, user_id: userId })
      await qc.invalidateQueries({ queryKey: ['signal-unlinked'] })
      await qc.invalidateQueries({ queryKey: ['users'] })
      await qc.invalidateQueries({ queryKey: ['messages'] })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't link that sender.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="signal-unlinked">
      <h3>Link to family member</h3>
      <p className="hint">
        These people messaged Homie, but Signal hid their number. Pick who they are.
      </p>
      {senders.map((sender) => (
        <div key={sender.signal_uuid} className="row">
          <div className="row__name row__name--static">
            {sender.name}
            {sender.last_seen ? <div className="hint">Last seen {formatSeen(sender.last_seen)}</div> : null}
          </div>
          <select
            aria-label={`Link ${sender.name} to a family member`}
            value={choice[sender.signal_uuid] ?? ''}
            onChange={(e) =>
              setChoice((current) => ({
                ...current,
                [sender.signal_uuid]: e.target.value === '' ? '' : Number(e.target.value),
              }))
            }
          >
            <option value="">Family member</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy === sender.signal_uuid || choice[sender.signal_uuid] === undefined || choice[sender.signal_uuid] === ''}
            onClick={() => void link(sender)}
          >
            {busy === sender.signal_uuid ? 'Linking…' : 'Link'}
          </button>
        </div>
      ))}
      {error && (
        <p className="banner banner--warn" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function TestTarget({
  people,
  target,
  onChange,
}: {
  people: User[]
  target: number | ''
  onChange: (value: number | '') => void
}) {
  return (
    <div className="row">
      <div className="row__name row__name--static">Send a test to</div>
      <select
        value={target}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      >
        <option value="">First family member with a number</option>
        {people.map((u: User) => (
          <option key={u.id} value={u.id}>
            {u.name} ({u.phone})
          </option>
        ))}
      </select>
    </div>
  )
}
