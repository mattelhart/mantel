import type { ChoreBoard, SharedList } from '../api/types'

/** What the wall draws after a tap it could not send yet. The server answer
 * replaces this on replay; the request_id is what keeps the stars honest. */
export function applyChoreToggle(
  board: ChoreBoard,
  userId: number,
  choreId: number,
  done: boolean,
): ChoreBoard {
  return {
    ...board,
    pending_approvals: done
      ? board.pending_approvals
      : board.pending_approvals.filter(
          (item) => !(item.user_id === userId && item.chore_id === choreId),
        ),
    people: board.people.map((person) => {
      if (person.user_id !== userId) return person
      let stars = person.stars
      const chores = person.chores.map((chore) => {
        if (chore.chore_id !== choreId) return chore
        if (done) {
          if (chore.completion?.status === 'done' || chore.completion?.status === 'pending') {
            return chore
          }
          const status: 'pending' | 'done' = chore.requires_approval ? 'pending' : 'done'
          const awarded = status === 'done' ? chore.points : 0
          stars += awarded
          return {
            ...chore,
            completion: {
              id: 0,
              chore_id: choreId,
              user_id: userId,
              on: board.on,
              status,
              points_awarded: awarded,
            },
          }
        }
        stars -= chore.completion?.points_awarded ?? 0
        return { ...chore, completion: null }
      })
      return { ...person, stars, chores }
    }),
  }
}

export function applyApproval(board: ChoreBoard, completionId: number, approve: boolean): ChoreBoard {
  const item = board.pending_approvals.find((row) => row.completion_id === completionId)
  if (!item) return board
  return {
    ...board,
    pending_approvals: board.pending_approvals.filter((row) => row.completion_id !== completionId),
    people: board.people.map((person) => {
      if (person.user_id !== item.user_id) return person
      return {
        ...person,
        stars: approve ? person.stars + item.points : person.stars,
        chores: person.chores.map((chore) => {
          if (chore.completion?.id !== completionId) return chore
          if (!approve) return { ...chore, completion: null }
          return {
            ...chore,
            completion: { ...chore.completion, status: 'done', points_awarded: item.points },
          }
        }),
      }
    }),
  }
}

export function applyRedeem(board: ChoreBoard, userId: number, rewardId: number): ChoreBoard {
  const reward = board.rewards.find((row) => row.id === rewardId)
  const person = board.people.find((row) => row.user_id === userId)
  if (!reward || !person) return board
  return {
    ...board,
    people: board.people.map((row) =>
      row.user_id === userId ? { ...row, stars: row.stars - reward.points_cost } : row,
    ),
    pending_redemptions: [
      ...board.pending_redemptions,
      {
        id: 0,
        reward_id: rewardId,
        reward_title: reward.title,
        user_id: userId,
        user_name: person.name,
        color: person.color,
        points_spent: reward.points_cost,
        status: 'pending',
      },
    ],
  }
}

export function applyListCheck(lists: SharedList[], listId: number, itemId: number, checked: boolean): SharedList[] {
  return lists.map((list) => {
    if (list.id !== listId) return list
    let delta = 0
    const items = list.items.map((item) => {
      if (item.id !== itemId || item.checked === checked) return item
      delta += checked ? -1 : 1
      return { ...item, checked }
    })
    return { ...list, items, item_count: Math.max(0, list.item_count + delta) }
  })
}

export function lastSyncedLabel(iso: string | null, now = new Date()): string {
  if (!iso) return 'earlier'
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 'earlier'
  const time = then.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (then.toDateString() === now.toDateString()) return time
  const day = then.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return `${day} ${time}`
}
