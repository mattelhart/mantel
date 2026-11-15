import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { classify, replayAll, type OutboxItem } from './outbox'

const check: OutboxItem = {
  id: 'check-1',
  method: 'POST',
  path: '/chores/7/complete',
  body: { user_id: 1, on: '2026-11-15', done: true, request_id: 'check-1' },
  requestId: 'check-1',
}

const redeem: OutboxItem = {
  id: 'redeem-1',
  method: 'POST',
  path: '/rewards/3/redeem',
  body: { user_id: 1, request_id: 'redeem-1' },
  requestId: 'redeem-1',
}

describe('classify', () => {
  it('keeps a tap the network never delivered', () => {
    expect(classify(new TypeError('Failed to fetch'))).toBe('retry')
    expect(classify(new ApiError('error', 'down', 503))).toBe('retry')
  })

  it('drops a tap the server refused so the screen can show the server copy', () => {
    expect(classify(new ApiError('bad_request', 'Not enough stars', 400))).toBe('drop')
    expect(classify(new ApiError('not_found', 'gone', 404))).toBe('drop')
  })
})

describe('replayAll', () => {
  it('sends the original request_id and does not send the rest after a network failure', async () => {
    const later: OutboxItem = { ...redeem, id: 'later', requestId: 'later' }
    const seen: string[] = []
    const left = await replayAll([check, redeem, later], async (item) => {
      seen.push(item.requestId ?? '')
      return item.id === 'redeem-1' ? 'retry' : 'ok'
    })
    expect(seen).toEqual(['check-1', 'redeem-1'])
    expect(left.map((item) => item.requestId)).toEqual(['redeem-1', 'later'])
  })

  it('removes a replay that already landed, so a second pass sends nothing new', async () => {
    const seen: unknown[] = []
    const left = await replayAll([check], async (item) => {
      seen.push(item.body)
      return 'ok'
    })
    expect(left).toEqual([])
    expect(seen).toEqual([check.body])
    const again = await replayAll(left, async () => {
      throw new Error('should not send')
    })
    expect(again).toEqual([])
  })

  it('drops a rejected tap and still sends the one behind it', async () => {
    const seen: string[] = []
    const left = await replayAll([check, redeem], async (item) => {
      seen.push(item.id)
      return item.id === 'check-1' ? 'drop' : 'ok'
    })
    expect(seen).toEqual(['check-1', 'redeem-1'])
    expect(left).toEqual([])
  })
})
