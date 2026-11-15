import type { QueryClient } from '@tanstack/react-query'
import { idbKv, type Kv } from './kv'

/** What a wall still needs to draw after the Pi loses the network. Rewards
 * are part of the chore board, so they ride along with `chores`. */
const ROOTS = new Set([
  'events',
  'users',
  'calendars',
  'settings',
  'lists',
  'chores',
  'widgets',
  'photos',
  'weather',
])

function snapKey(queryKey: readonly unknown[]): string {
  return `snap:${JSON.stringify(queryKey)}`
}

export async function hydrate(qc: QueryClient, kv: Kv = idbKv): Promise<void> {
  const keys = await kv.keys()
  for (const key of keys) {
    if (!key.startsWith('snap:')) continue
    const raw = await kv.get(key)
    if (!raw) continue
    try {
      // updatedAt 0 marks the copy stale, so an online mount refetches, while
      // an offline mount still has something to draw.
      qc.setQueryData(JSON.parse(key.slice(5)), JSON.parse(raw), { updatedAt: 0 })
    } catch {
      /* a bad snapshot is skipped; the network copy replaces it */
    }
  }
}

export function watchQueries(qc: QueryClient, kv: Kv = idbKv): () => void {
  return qc.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.query.state.status !== 'success') return
    const root = String(event.query.queryKey[0])
    if (!ROOTS.has(root)) return
    const data = event.query.state.data
    if (data === undefined) return
    void kv.set(snapKey(event.query.queryKey), JSON.stringify(data)).catch(() => undefined)
  })
}
