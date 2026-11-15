import { noteCachedAt, noteSynced } from '../offline/kv'

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

/** Set once a browser has paired. The wall display on the home network never has one. */
const TOKEN_KEY = 'mantel.deviceToken'

export function deviceToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function storeDeviceToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearDeviceToken() {
  localStorage.removeItem(TOKEN_KEY)
}

/** Header for fetches that don't go through `api` (photo upload, the guide). */
export function authHeaders(): Record<string, string> {
  const token = deviceToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** `<img src>` cannot send a header. A paired browser appends the token; the wall
 *  does not have one and is let in by its address. */
export function authedUrl(url: string): string {
  const token = deviceToken()
  if (!token || url.includes('access_token=')) return url
  const join = url.includes('?') ? '&' : '?'
  return `${url}${join}access_token=${encodeURIComponent(token)}`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    let code = 'error'
    let message = res.statusText
    try {
      const body = await res.json()
      code = body?.error?.code ?? code
      message = body?.error?.message ?? message
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(code, message, res.status)
  }
  // The service worker answers from its cache with this header once the
  // network fetch threw. That data is still worth showing, and it is not a
  // fresh sync.
  if (res.headers.get('X-Mantel-From-Cache') === '1') {
    window.dispatchEvent(new Event('famcal:unreachable'))
    const saved = res.headers.get('X-Mantel-Saved-At')
    if (saved) noteCachedAt(saved)
  } else {
    window.dispatchEvent(new Event('famcal:reachable'))
    noteSynced()
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

export interface VersionInfo {
  version: string
  build_time: string
  // Null/false until the server's daily GitHub check has succeeded.
  latest_version?: string | null
  update_available?: boolean
  checked_at?: string | null
  release_url?: string | null
}
