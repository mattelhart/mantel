import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { api, authedUrl } from '../../api/client'
import { isConnected, snapshotUrl, type CamerasResponse } from './model'

const GRID_MS = 3000
const VIEW_MS = 1000

export function CamerasPage() {
  const listing = useCameras()
  const tick = useTick(GRID_MS)

  if (listing.isLoading) {
    return (
      <div className="cameras">
        <header className="cameras__bar">
          <h1 className="cameras__title">Cameras</h1>
        </header>
        <p className="hint">Loading cameras…</p>
      </div>
    )
  }

  const data = listing.data
  if (data && !data.configured) {
    return (
      <div className="cameras">
        <header className="cameras__bar">
          <h1 className="cameras__title">Cameras</h1>
        </header>
        <p className="hint">
          Cameras are not configured yet. On the server, point{' '}
          <code>UNIFI_PROTECT_KEY_FILE</code> at a file that holds your UniFi Protect
          Integration API key. You can also set <code>UNIFI_PROTECT_URL</code> if the
          console is not at <code>https://10.0.0.1/proxy/protect/integration</code>.
        </p>
      </div>
    )
  }

  const cameras = data?.cameras ?? []

  return (
    <div className="cameras">
      <header className="cameras__bar">
        <h1 className="cameras__title">Cameras</h1>
      </header>
      {cameras.length === 0 && <p className="hint">No cameras were returned by UniFi Protect.</p>}
      {listing.isError && <p className="hint">Could not load the camera list. Trying again shortly.</p>}
      <div className="cameras__grid">
        {cameras.map((camera) => {
          const live = isConnected(camera.state)
          return (
            <Link
              key={camera.id}
              to={`/cameras/${encodeURIComponent(camera.id)}`}
              className="cameras__tile"
              data-offline={live ? undefined : 'true'}
            >
              {live ? (
                <img
                  src={authedUrl(snapshotUrl(camera.id, tick))}
                  alt=""
                  className="cameras__shot"
                />
              ) : (
                <div className="cameras__offline" />
              )}
              <span className="cameras__caption">
                <span className="cameras__name">{camera.name}</span>
                <span className="cameras__state">{live ? 'Live' : camera.state || 'Disconnected'}</span>
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

export function CameraViewPage() {
  const { id } = useParams()
  const listing = useCameras()
  const tick = useTick(VIEW_MS)
  const camera = listing.data?.cameras.find((item) => item.id === id)

  if (!id) return <Navigate to="/cameras" replace />
  if (listing.data && !listing.data.configured) return <Navigate to="/cameras" replace />
  if (listing.isSuccess && listing.data && !camera) return <Navigate to="/cameras" replace />

  const name = camera?.name ?? 'Camera'
  const live = camera ? isConnected(camera.state) : true

  return (
    <div className="camview">
      <header className="camview__bar">
        <Link to="/cameras" className="camview__back">
          <span aria-hidden>◀</span> Back
        </Link>
        <h1 className="camview__title">{name}</h1>
        {camera && !live && <span className="camview__state">{camera.state}</span>}
      </header>
      <div className="camview__stage" data-offline={live ? undefined : 'true'}>
        {live ? (
          <img src={authedUrl(snapshotUrl(id, tick))} alt={name} className="camview__shot" />
        ) : (
          <p className="camview__offline">This camera is {camera?.state.toLowerCase() || 'disconnected'}.</p>
        )}
      </div>
    </div>
  )
}

function useCameras() {
  return useQuery({
    queryKey: ['cameras'],
    queryFn: () => api.get<CamerasResponse>('/cameras'),
    refetchInterval: 15_000,
  })
}

/** Advances while the document is visible, and pauses when the tab is hidden. */
export function useTick(intervalMs: number): number {
  const [tick, setTick] = useState(() => Date.now())

  useEffect(() => {
    const bump = () => setTick(Date.now())
    const start = () => window.setInterval(bump, intervalMs)

    let timer = document.hidden ? 0 : start()
    const onVisibility = () => {
      window.clearInterval(timer)
      if (document.hidden) return
      bump()
      timer = start()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs])

  return tick
}
