export interface LiveMessage {
  kind: 'change' | 'resync' | 'hello' | 'ignore'
  id: number | null
  topics: string[]
}

/** Areas a notice can name, and the react-query roots that display them.
 * Rewards live on the chore board, so that topic refreshes chores. */
export const TOPIC_QUERY_KEYS: Record<string, string[][]> = {
  events: [['events']],
  calendars: [['calendars']],
  sync: [['sync-status']],
  accounts: [['accounts']],
  users: [['users']],
  settings: [['settings']],
  lists: [['lists']],
  chores: [['chores']],
  rewards: [['chores']],
  widgets: [['widgets']],
  photos: [['photos']],
}

export const FALLBACK_ROOTS = [
  'events',
  'calendars',
  'sync-status',
  'accounts',
  'users',
  'settings',
  'lists',
  'chores',
  'widgets',
  'photos',
]

/** 1s, 2s, 4s… capped at 30s, plus a little jitter so a restarted server is
 * not hit by every screen in the same millisecond. */
export function reconnectDelayMs(attempt: number, jitter = 0): number {
  const step = Math.max(0, attempt - 1)
  const exp = Math.min(30_000, 1000 * 2 ** step)
  return exp + Math.max(0, Math.min(400, jitter))
}

export function parseSseBlock(block: string): LiveMessage {
  let id: number | null = null
  let event = 'message'
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue
    const split = line.indexOf(':')
    const field = split === -1 ? line : line.slice(0, split)
    const value = split === -1 ? '' : line.slice(split + 1).replace(/^ /, '')
    if (field === 'id') {
      const parsed = Number(value)
      id = Number.isFinite(parsed) ? parsed : null
    } else if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  if (event === 'hello') return { kind: 'hello', id, topics: [] }
  if (event === 'resync') return { kind: 'resync', id, topics: [] }
  if (event !== 'change') return { kind: 'ignore', id, topics: [] }
  try {
    const payload = JSON.parse(data.join('\n')) as { topics?: unknown }
    const topics = Array.isArray(payload.topics)
      ? payload.topics.filter((topic): topic is string => typeof topic === 'string')
      : []
    return { kind: 'change', id, topics }
  } catch {
    return { kind: 'ignore', id, topics: [] }
  }
}

/** SSE frames are separated by a blank line. `rest` is the trailing partial
 * frame, which the next chunk has to finish. */
export function takeSseFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split('\n\n')
  const rest = parts.pop() ?? ''
  return { frames: parts.filter((part) => part.trim().length > 0), rest }
}
