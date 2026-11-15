import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, storeDeviceToken } from '../api/client'

/** Shown only when this browser is somewhere the server does not trust — a phone
 *  on cellular, or a laptop off the LAN. The wall display never reaches it. */
export function AuthGate() {
  const queryClient = useQueryClient()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim() || 'This browser',
        }),
      })
      if (!res.ok) {
        let message = 'That code was not accepted.'
        try {
          const body = await res.json()
          message = body?.error?.message ?? message
        } catch {
          /* non-JSON */
        }
        throw new ApiError('unauthorized', message, res.status)
      }
      const body = (await res.json()) as { token: string }
      storeDeviceToken(body.token)
      await queryClient.invalidateQueries()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not pair.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="authgate">
      <form
        className="authgate__card"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <h1>Connect this screen</h1>
        <p className="hint">
          This browser is outside the home network, so it needs a pairing code. On the wall
          display, open Settings → Devices and tap “Pair a phone”. Enter that code here.
        </p>
        <input
          className="row__name"
          value={code}
          autoFocus
          autoCapitalize="characters"
          placeholder="Code from the wall"
          onChange={(e) => setCode(e.target.value)}
        />
        <input
          className="row__name"
          value={name}
          placeholder="Name this device (optional)"
          onChange={(e) => setName(e.target.value)}
        />
        {error && <p className="banner banner--warn">{error}</p>}
        <button className="btn btn--primary" type="submit" disabled={busy || code.trim().length < 4}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </form>
    </div>
  )
}
