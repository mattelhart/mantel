import { ApiError } from '../api/client'

export interface OutboxItem {
  id: string
  method: 'POST' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
  /** Present on chore checks and redeems. A replay must send this same value. */
  requestId: string | null
}

export type Attempt = 'ok' | 'retry' | 'drop'

/** Network and "try again" statuses stay in the queue. A 4xx means the server
 * rejected the tap (the chore was deleted, the stars were not enough) and the
 * screen should drop it and show whatever the server has. */
export function classify(err: unknown): Attempt {
  if (err instanceof TypeError) return 'retry'
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 408 || err.status === 429 || err.status >= 500 || err.status === 0) {
      return 'retry'
    }
    return 'drop'
  }
  return 'retry'
}

/** Sends in order. A retry stops the line so a later tap cannot overtake the
 * one the server has not seen yet. `ok` and `drop` both remove the head. */
export async function replayAll(
  items: OutboxItem[],
  send: (item: OutboxItem) => Promise<Attempt>,
): Promise<OutboxItem[]> {
  const remaining = [...items]
  while (remaining.length > 0) {
    const outcome = await send(remaining[0])
    if (outcome === 'retry') return remaining
    remaining.shift()
  }
  return remaining
}
