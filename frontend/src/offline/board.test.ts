import { describe, expect, it } from 'vitest'
import type { ChoreBoard, SharedList } from '../api/types'
import { applyApproval, applyChoreToggle, applyListCheck, applyRedeem, lastSyncedLabel } from './board'

const board: ChoreBoard = {
  on: '2026-11-15',
  people: [
    {
      user_id: 1,
      name: 'Sam',
      color: '#22c55e',
      avatar_emoji: null,
      stars: 4,
      chores: [
        {
          chore_id: 7,
          title: 'Make bed',
          notes: null,
          icon: '🛏',
          points: 2,
          requires_approval: false,
          schedule: 'daily',
          completion: null,
        },
      ],
    },
  ],
  rewards: [{ id: 3, title: 'Movie', description: null, points_cost: 3, icon: null }],
  pending_redemptions: [],
  pending_approvals: [],
}

describe('applyChoreToggle', () => {
  it('checks a chore and adds its stars locally', () => {
    const next = applyChoreToggle(board, 1, 7, true)
    expect(next.people[0].stars).toBe(6)
    expect(next.people[0].chores[0].completion?.status).toBe('done')
    expect(next.people[0].chores[0].completion?.points_awarded).toBe(2)
  })

  it('does not award the same check twice while it is still queued', () => {
    const once = applyChoreToggle(board, 1, 7, true)
    const twice = applyChoreToggle(once, 1, 7, true)
    expect(twice.people[0].stars).toBe(6)
  })

  it('puts the stars back when the queued tap was an uncheck', () => {
    const checked = applyChoreToggle(board, 1, 7, true)
    const undone = applyChoreToggle(checked, 1, 7, false)
    expect(undone.people[0].stars).toBe(4)
    expect(undone.people[0].chores[0].completion).toBeNull()
  })

  it('holds stars when the chore still needs a parent', () => {
    const waiting: ChoreBoard = {
      ...board,
      people: [
        {
          ...board.people[0],
          chores: [{ ...board.people[0].chores[0], requires_approval: true }],
        },
      ],
    }
    const next = applyChoreToggle(waiting, 1, 7, true)
    expect(next.people[0].stars).toBe(4)
    expect(next.people[0].chores[0].completion?.status).toBe('pending')
  })
})

describe('applyApproval', () => {
  it('awards the stars when a queued approval lands', () => {
    const pending = applyChoreToggle(
      {
        ...board,
        people: [
          {
            ...board.people[0],
            chores: [{ ...board.people[0].chores[0], requires_approval: true }],
          },
        ],
      },
      1,
      7,
      true,
    )
    const withRow: ChoreBoard = {
      ...pending,
      pending_approvals: [
        {
          completion_id: 9,
          chore_id: 7,
          title: 'Make bed',
          user_id: 1,
          user_name: 'Sam',
          color: '#22c55e',
          points: 2,
          on: '2026-11-15',
        },
      ],
      people: pending.people.map((person) => ({
        ...person,
        chores: person.chores.map((chore) =>
          chore.completion ? { ...chore, completion: { ...chore.completion, id: 9 } } : chore,
        ),
      })),
    }
    const approved = applyApproval(withRow, 9, true)
    expect(approved.pending_approvals).toHaveLength(0)
    expect(approved.people[0].stars).toBe(6)
    expect(approved.people[0].chores[0].completion?.status).toBe('done')
  })
})

describe('applyRedeem', () => {
  it('holds the stars for a reward that is waiting to be given', () => {
    const next = applyRedeem(board, 1, 3)
    expect(next.people[0].stars).toBe(1)
    expect(next.pending_redemptions[0].reward_title).toBe('Movie')
    expect(next.pending_redemptions[0].points_spent).toBe(3)
  })
})

describe('applyListCheck', () => {
  const lists: SharedList[] = [
    {
      id: 1,
      name: 'Groceries',
      icon: '🛒',
      sort_order: 0,
      item_count: 1,
      items: [
        {
          id: 4,
          list_id: 1,
          text: 'Milk',
          checked: false,
          assigned_user_id: null,
          color: null,
          sort_order: 0,
        },
      ],
    },
  ]

  it('ticks the item the server will be told about later', () => {
    const next = applyListCheck(lists, 1, 4, true)
    expect(next[0].items[0].checked).toBe(true)
    expect(next[0].item_count).toBe(0)
  })
})

describe('lastSyncedLabel', () => {
  it('uses the clock when the sync was today', () => {
    const now = new Date(2026, 10, 15, 15, 4)
    const iso = new Date(2026, 10, 15, 14, 2).toISOString()
    expect(lastSyncedLabel(iso, now)).toMatch(/2:02/)
  })

  it('says earlier when the screen has never reached the server', () => {
    expect(lastSyncedLabel(null)).toBe('earlier')
  })
})
