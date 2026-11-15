import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { authHeaders } from '../api/client'
import { replayOutbox } from '../offline/actions'
import { FALLBACK_ROOTS, parseSseBlock, reconnectDelayMs, takeSseFrames, TOPIC_QUERY_KEYS, type LiveMessage } from './sse'

const POLL_MS = 60_000

async function readStream(
  signal: AbortSignal,
  lastId: number | null,
  onMessage: (message: LiveMessage) => void,
): Promise<void> {
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    ...authHeaders(),
  }
  if (lastId !== null) headers['Last-Event-ID'] = String(lastId)
  const res = await fetch('/api/live', { headers, signal })
  if (res.status === 401 || res.status === 403) {
    const error = new Error('unauthorized')
    error.name = 'AuthError'
    throw error
  }
  if (!res.ok || !res.body) throw new Error(`live ${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    const { frames, rest } = takeSseFrames(buffer)
    buffer = rest
    for (const frame of frames) onMessage(parseSseBlock(frame))
  }
}

function keysFor(topics: string[]): string[][] {
  const seen = new Set<string>()
  const keys: string[][] = []
  for (const topic of topics) {
    for (const key of TOPIC_QUERY_KEYS[topic] ?? []) {
      const stamp = JSON.stringify(key)
      if (seen.has(stamp)) continue
      seen.add(stamp)
      keys.push(key)
    }
  }
  return keys
}

/**
 * Keeps every open Mantel tab on the commit stream. While the stream is up,
 * family data is not polled. When it drops, one 60s timer refetches — the
 * same cadence the wall used before — and a reconnect with Last-Event-ID
 * refetches only the topics it missed.
 */
export function useLiveUpdates() {
  const qc = useQueryClient()

  useEffect(() => {
    let cancelled = false
    let lastId: number | null = null
    let attempt = 0
    let healthy = false
    let poll: number | null = null
    let debounce: number | null = null
    const pending = new Set<string>()
    let resync = false
    const controller = new AbortController()

    const flushTopics = () => {
      debounce = null
      const full = resync
      resync = false
      const topics = [...pending]
      pending.clear()
      const keys = full
        ? FALLBACK_ROOTS.map((root) => [root])
        : keysFor(topics)
      // Spread a gap-resync so a room of tablets does not refetch as one.
      const wait = full ? Math.floor(Math.random() * 800) : 0
      window.setTimeout(() => {
        if (cancelled) return
        for (const key of keys) void qc.invalidateQueries({ queryKey: key })
      }, wait)
    }

    const queueTopics = (topics: string[], full: boolean) => {
      if (full) resync = true
      for (const topic of topics) pending.add(topic)
      if (debounce !== null) return
      debounce = window.setTimeout(flushTopics, 200)
    }

    const setPolling = (on: boolean) => {
      if (poll !== null) {
        window.clearInterval(poll)
        poll = null
      }
      if (!on) return
      poll = window.setInterval(() => {
        for (const root of FALLBACK_ROOTS) void qc.invalidateQueries({ queryKey: [root] })
      }, POLL_MS)
    }

    const onMessage = (message: LiveMessage) => {
      if (message.id !== null) lastId = message.id
      if (!healthy && message.kind !== 'ignore') {
        healthy = true
        attempt = 0
        setPolling(false)
        window.dispatchEvent(new Event('famcal:reachable'))
      }
      if (message.kind === 'change') queueTopics(message.topics, false)
      else if (message.kind === 'resync') queueTopics([], true)
    }

    const run = async () => {
      setPolling(true)
      while (!cancelled) {
        try {
          await readStream(controller.signal, lastId, onMessage)
          if (cancelled) return
          // A clean close still waits. A proxy that drops the stream would
          // otherwise reconnect in a tight loop.
          attempt = healthy ? 1 : attempt + 1
          healthy = false
          setPolling(true)
        } catch (err) {
          if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return
          healthy = false
          setPolling(true)
          if (err instanceof TypeError) window.dispatchEvent(new Event('famcal:unreachable'))
          // 401 is "pair this browser", not "the server is down". Keep trying
          // so a token saved a moment later starts working without a reload.
          attempt = err instanceof Error && err.name === 'AuthError' ? 6 : attempt + 1
        }
        if (cancelled) return
        const jitter = Math.floor(Math.random() * 400)
        await new Promise((resolve) => window.setTimeout(resolve, reconnectDelayMs(attempt, jitter)))
      }
    }

    void run()
    return () => {
      cancelled = true
      controller.abort()
      if (poll !== null) window.clearInterval(poll)
      if (debounce !== null) window.clearTimeout(debounce)
    }
  }, [qc])
}

/** Drain queued taps once the server answers again. */
export function useOfflineReplay() {
  const qc = useQueryClient()
  useEffect(() => {
    let running = false
    const replay = () => {
      if (running) return
      running = true
      void replayOutbox()
        .then((changed) => {
          if (!changed) return
          void qc.invalidateQueries({ queryKey: ['chores'] })
          void qc.invalidateQueries({ queryKey: ['lists'] })
        })
        .finally(() => {
          running = false
        })
    }
    window.addEventListener('famcal:reachable', replay)
    window.addEventListener('online', replay)
    return () => {
      window.removeEventListener('famcal:reachable', replay)
      window.removeEventListener('online', replay)
    }
  }, [qc])
}
