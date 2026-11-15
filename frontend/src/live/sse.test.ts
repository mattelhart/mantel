import { describe, expect, it } from 'vitest'
import { parseSseBlock, reconnectDelayMs, takeSseFrames } from './sse'

describe('reconnectDelayMs', () => {
  it('backs off and then stops growing', () => {
    expect(reconnectDelayMs(1)).toBe(1000)
    expect(reconnectDelayMs(2)).toBe(2000)
    expect(reconnectDelayMs(3)).toBe(4000)
    expect(reconnectDelayMs(20)).toBe(30_000)
  })

  it('adds a short jitter so screens do not reconnect together', () => {
    expect(reconnectDelayMs(1, 250)).toBe(1250)
    expect(reconnectDelayMs(1, 5000)).toBe(1400)
  })
})

describe('parseSseBlock', () => {
  it('reads the topics off a change without treating it as a full refetch', () => {
    const message = parseSseBlock(
      'id: 4\nevent: change\ndata: {"topics":["chores","rewards"],"at":"2026-11-15T12:00:00Z"}',
    )
    expect(message).toEqual({ kind: 'change', id: 4, topics: ['chores', 'rewards'] })
  })

  it('treats a gap as a resync and ignores keepalive comments', () => {
    expect(parseSseBlock(': keepalive').kind).toBe('ignore')
    expect(parseSseBlock('event: resync\ndata: {"reason":"gap"}')).toMatchObject({
      kind: 'resync',
      topics: [],
    })
    expect(parseSseBlock('id: 9\nevent: hello\ndata: {"id":9}')).toEqual({
      kind: 'hello',
      id: 9,
      topics: [],
    })
  })
})

describe('takeSseFrames', () => {
  it('keeps a frame that has not finished yet', () => {
    const first = takeSseFrames('id: 1\nevent: hello\ndata: {"id":1}\n\nevent: cha')
    expect(first.frames).toEqual(['id: 1\nevent: hello\ndata: {"id":1}'])
    expect(first.rest).toBe('event: cha')
    const second = takeSseFrames(`${first.rest}nge\ndata: {"topics":["events"]}\n\n`)
    expect(parseSseBlock(second.frames[0]).topics).toEqual(['events'])
  })
})
