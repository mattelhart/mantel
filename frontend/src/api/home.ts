import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, authHeaders } from './client'
import { reconnectDelayMs } from '../live/sse'
import {
  applyState,
  parseHomeFrames,
  patchEntity,
  predict,
  type HomeData,
  type HomeEntity,
  type HomeStatus,
} from '../views/home/homeModel'

export const HOME_KEY = ['home'] as const

/** Never persisted for offline use (see offline/persist.ts): a stale "light is on" you
 *  cannot act on is worse than an honest "can't reach it". */
export function useHome(live: HomeStatus) {
  return useQuery({
    queryKey: HOME_KEY,
    queryFn: () => api.get<HomeData>('/home'),
    // The stream keeps this current. Without it, look again every half minute.
    refetchInterval: live === 'ok' ? false : 30_000,
  })
}

/** Run one device action. Shows the expected result at once and lets the stream (or a
 *  refetch on failure) have the last word. */
export async function sendHomeAction(
  qc: ReturnType<typeof useQueryClient>,
  entity: HomeEntity,
  action: string,
  value?: number | string,
  confirm = false,
): Promise<void> {
  const before = qc.getQueryData<HomeData>(HOME_KEY)
  const guess = predict(entity, action, typeof value === 'number' ? value : undefined)
  if (before && Object.keys(guess).length) {
    qc.setQueryData<HomeData>(HOME_KEY, (d) => (d ? patchEntity(d, entity.entity_id, guess) : d))
  }
  try {
    await api.post(`/home/entities/${entity.entity_id}/action`, { action, value, confirm })
  } catch (error) {
    void qc.invalidateQueries({ queryKey: HOME_KEY })
    throw error
  }
}

async function readHomeStream(
  signal: AbortSignal,
  onFrame: (frame: ReturnType<typeof parseHomeFrames>['frames'][number]) => void,
): Promise<void> {
  const res = await fetch('/api/home/live', {
    headers: { Accept: 'text/event-stream', ...authHeaders() },
    signal,
  })
  if (!res.ok || !res.body) throw new Error(`home live ${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    const parsed = parseHomeFrames(buffer)
    buffer = parsed.rest
    parsed.frames.forEach(onFrame)
  }
}

/** Follows Home Assistant while Home Control is open. Returns the connection status
 *  the server reports; 'connecting' until the first frame. */
export function useHomeLive(): HomeStatus {
  const qc = useQueryClient()
  const [status, setStatus] = useState<HomeStatus>('connecting')

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    let attempt = 0
    let timer: number | null = null

    const run = async () => {
      while (!cancelled) {
        try {
          await readHomeStream(controller.signal, (frame) => {
            if (frame.event === 'status') {
              attempt = 0
              setStatus(frame.data.status)
            } else if (frame.event === 'state') {
              qc.setQueryData<HomeData>(HOME_KEY, (d) => (d ? applyState(d, frame.data) : d))
            } else {
              void qc.invalidateQueries({ queryKey: HOME_KEY })
            }
          })
        } catch (err) {
          if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return
        }
        if (cancelled) return
        setStatus((s) => (s === 'ok' ? 'unreachable' : s))
        attempt += 1
        await new Promise((resolve) => {
          timer = window.setTimeout(resolve, reconnectDelayMs(attempt, Math.floor(Math.random() * 400)))
        })
      }
    }
    void run()
    return () => {
      cancelled = true
      controller.abort()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [qc])

  return status
}
