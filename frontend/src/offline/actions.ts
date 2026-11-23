import type { QueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { ChoreBoard, SharedList } from '../api/types'
import { queryClient } from '../api/queryClient'
import { applyApproval, applyChoreToggle, applyListCheck, applyRedeem } from './board'
import { idbKv, type Kv } from './kv'
import { classify, replayAll, type OutboxItem } from './outbox'

const OUTBOX = 'outbox'

let tail: Promise<unknown> = Promise.resolve()

function locked<T>(work: () => Promise<T>): Promise<T> {
  const run = tail.then(work, work)
  tail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function load(kv: Kv): Promise<OutboxItem[]> {
  const raw = await kv.get(OUTBOX)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as OutboxItem[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function save(kv: Kv, items: OutboxItem[]) {
  await kv.set(OUTBOX, JSON.stringify(items))
}

async function transmit(item: OutboxItem): Promise<void> {
  if (item.method === 'POST') await api.post(item.path, item.body ?? {})
  else if (item.method === 'PATCH') await api.patch(item.path, item.body ?? {})
  else await api.del(item.path)
}

function markOffline() {
  window.dispatchEvent(new Event('famcal:unreachable'))
}

/** True when at least one queued tap was sent or dropped, so the screen should
 * refetch and replace the optimistic copy. */
export async function replayOutbox(kv: Kv = idbKv): Promise<boolean> {
  return locked(async () => {
    const items = await load(kv)
    if (items.length === 0) return false
    const left = await replayAll(items, async (item) => {
      try {
        await transmit(item)
        return 'ok'
      } catch (err) {
        return classify(err)
      }
    })
    await save(kv, left)
    if (left.length > 0) markOffline()
    return left.length !== items.length
  })
}

/** True when the tap is sitting in the queue and the screen should draw it
 * locally. False when the server already has it. */
async function submit(item: OutboxItem, kv: Kv = idbKv): Promise<'sent' | 'queued'> {
  return locked(async () => {
    const existing = await load(kv)
    if (existing.length === 0 && navigator.onLine) {
      try {
        await transmit(item)
        return 'sent'
      } catch (err) {
        const outcome = classify(err)
        if (outcome === 'drop') throw err
        await save(kv, [item])
        markOffline()
        return 'queued'
      }
    }
    await save(kv, [...existing, item])
    if (!navigator.onLine) {
      markOffline()
      return 'queued'
    }
    const left = await replayAll(await load(kv), async (row) => {
      try {
        await transmit(row)
        return 'ok'
      } catch (err) {
        return classify(err)
      }
    })
    await save(kv, left)
    if (left.length > 0) markOffline()
    return left.some((row) => row.id === item.id) ? 'queued' : 'sent'
  })
}

export function requestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `tap-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
}

function patchBoards(qc: QueryClient, map: (board: ChoreBoard) => ChoreBoard) {
  for (const [key, data] of qc.getQueriesData<ChoreBoard>({ queryKey: ['chores', 'board'] })) {
    if (data) qc.setQueryData(key, map(data))
  }
}

async function finishChores(qc: QueryClient, queued: boolean) {
  if (!queued) await qc.invalidateQueries({ queryKey: ['chores'] })
}

export function checkChore(
  input: { choreId: number; userId: number; on: string; done: boolean },
  qc: QueryClient = queryClient,
) {
  const id = requestId()
  const item: OutboxItem = {
    id,
    method: 'POST',
    path: `/chores/${input.choreId}/complete`,
    body: { user_id: input.userId, on: input.on, done: input.done, request_id: id },
    requestId: id,
  }
  return submit(item).then(async (result) => {
    if (result === 'queued') {
      patchBoards(qc, (board) =>
        board.on === input.on ? applyChoreToggle(board, input.userId, input.choreId, input.done) : board,
      )
      return
    }
    await finishChores(qc, false)
  })
}

export function reviewChore(completionId: number, approve: boolean, qc: QueryClient = queryClient) {
  const item: OutboxItem = {
    id: `${approve ? 'approve' : 'reject'}-${completionId}-${requestId()}`,
    method: 'POST',
    path: `/chores/completions/${completionId}/${approve ? 'approve' : 'reject'}`,
    body: {},
    requestId: null,
  }
  return submit(item).then(async (result) => {
    if (result === 'queued') {
      patchBoards(qc, (board) => applyApproval(board, completionId, approve))
      return
    }
    await finishChores(qc, false)
  })
}

export function redeemReward(
  input: { rewardId: number; userId: number },
  qc: QueryClient = queryClient,
) {
  const id = requestId()
  const item: OutboxItem = {
    id,
    method: 'POST',
    path: `/rewards/${input.rewardId}/redeem`,
    body: { user_id: input.userId, request_id: id },
    requestId: id,
  }
  return submit(item).then(async (result) => {
    if (result === 'queued') {
      patchBoards(qc, (board) => applyRedeem(board, input.userId, input.rewardId))
      return
    }
    await finishChores(qc, false)
  })
}

export function checkListItem(
  input: { listId: number; itemId: number; checked: boolean },
  qc: QueryClient = queryClient,
) {
  const item: OutboxItem = {
    id: `list-${input.listId}-${input.itemId}-${input.checked ? 1 : 0}-${requestId()}`,
    method: 'PATCH',
    path: `/lists/${input.listId}/items/${input.itemId}`,
    body: { checked: input.checked },
    requestId: null,
  }
  return submit(item).then(async (result) => {
    if (result === 'queued') {
      qc.setQueryData<SharedList[]>(['lists'], (lists) =>
        lists ? applyListCheck(lists, input.listId, input.itemId, input.checked) : lists,
      )
      return
    }
    await qc.invalidateQueries({ queryKey: ['lists'] })
  })
}
