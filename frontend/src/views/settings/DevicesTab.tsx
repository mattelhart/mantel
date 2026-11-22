import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../api/client'
import { useEntityMutation } from '../../api/hooks'
import { isLoopbackHost, qrDataUri } from './qr'
import { timeAgo } from './timeAgo'

interface Device {
  id: number
  name: string
  token_prefix: string
  created_at: string
  last_used_at: string | null
}

interface PairingCode {
  code: string
  expires_at: string
  qr_svg: string
}

/** Phones pair here. The wall itself never does: on the home network it is
 *  already allowed in, which is the whole point of a kiosk. */
export function DevicesTab() {
  const queryClient = useQueryClient()
  const [code, setCode] = useState<PairingCode | null>(null)
  const [forTv, setForTv] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { data: devices = [] } = useQuery({
    queryKey: ['devices'],
    queryFn: () => api.get<Device[]>('/auth/devices'),
  })

  const revoke = useEntityMutation(
    (id: number) => api.del<void>(`/auth/devices/${id}`),
    ['devices'],
  )

  const showCode = async (tv: boolean) => {
    setForTv(tv)
    setBusy(true)
    setError(null)
    try {
      const minted = await api.post<PairingCode>(
        `/auth/pairing-codes?base_url=${encodeURIComponent(window.location.origin)}`,
      )
      setCode(minted)
      await queryClient.invalidateQueries({ queryKey: ['devices'] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create a pairing code.')
    } finally {
      setBusy(false)
    }
  }

  const expired = code ? new Date(code.expires_at).getTime() < Date.now() : false

  return (
    <section className="panel">
      <h2>Phones and browsers</h2>
      <p className="hint">
        This screen does not ask you to log in. It is on the home network, and that is enough.
        A phone away from home pairs with a code instead of a password: show one here, then
        enter it in the app (or scan the code). A TV pairs the same way: tap Pair a TV and type the code with its remote. Revoke a device here any time — its token
        stops working immediately.
      </p>

      <div className="row">
        <button className="btn btn--primary" onClick={() => void showCode(false)} disabled={busy}>
          {code && !forTv ? 'New pairing code' : 'Pair a phone'}
        </button>
        <button className="btn" onClick={() => void showCode(true)} disabled={busy}>
          {code && forTv ? 'New TV code' : 'Pair a TV'}
        </button>
      </div>

      {error && <p className="banner banner--warn">{error}</p>}

      {code && (
        <div className="pair">
          <div className="pair__code">{expired ? 'Expired' : code.code}</div>
          {!expired && (
            <img
              className="pair__qr"
              alt={`QR code for pairing ${code.code}`}
              src={qrDataUri(code.qr_svg)}
            />
          )}
          {!expired && isLoopbackHost(window.location.hostname) && (
            <p className="banner banner--warn">
              This screen is open as {window.location.hostname}, which a phone cannot reach, so the QR will not
              work. Open Mantel here by its network address (for example http://10.0.15.178:8080) and try again.
            </p>
          )}
          <div className="pair__meta">
            {expired
              ? 'That code has expired. Show a new one.'
              : forTv
                ? `On the TV, type this code when it says “Pair this TV”. It expires ${expiryLabel(code.expires_at)} and works once.`
                : `Enter this in the phone app. It expires ${expiryLabel(code.expires_at)} and works once.`}
          </div>
        </div>
      )}

      {devices.length === 0 ? (
        <p className="hint">No phones paired yet.</p>
      ) : (
        devices.map((d) => (
          <div key={d.id} className="row">
            <div className="row__name row__name--static">
              <strong>{d.name}</strong>
              <span className="hint">
                {d.token_prefix}… · {d.last_used_at ? `used ${timeAgo(d.last_used_at)}` : 'not used yet'}
              </span>
            </div>
            <button className="btn btn--danger" onClick={() => revoke.mutate(d.id)}>
              Revoke
            </button>
          </div>
        ))
      )}
    </section>
  )
}

function expiryLabel(iso: string): string {
  const then = new Date(iso)
  const mins = Math.max(1, Math.round((then.getTime() - Date.now()) / 60_000))
  return mins === 1 ? 'in a minute' : `in ${mins} minutes`
}
