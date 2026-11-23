export interface Camera {
  id: string
  name: string
  state: string
}

export interface CamerasResponse {
  configured: boolean
  cameras: Camera[]
}

export function isConnected(state: string): boolean {
  return state.trim().toUpperCase() === 'CONNECTED'
}

/** Align cache-busting with the server's ~2s snapshot cache. */
export function snapshotUrl(id: string, at = Date.now()): string {
  return `/api/cameras/${encodeURIComponent(id)}/snapshot?t=${Math.floor(at / 2000)}`
}
