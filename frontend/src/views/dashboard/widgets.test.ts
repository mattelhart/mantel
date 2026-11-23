import { describe, expect, it } from 'vitest'
import type { PersonBoard } from '../../api/types'
import { alignChoreColumns } from './widgets'

const users = [
  { id: 1, name: 'Dad', color: '#e8a24a' },
  { id: 2, name: 'Mom', color: '#7c3aed' },
  { id: 3, name: 'Autumn', color: '#2563eb' },
  { id: 4, name: 'Brooklyn', color: '#db2777' },
]

const board = [
  { user_id: 3, name: 'Autumn', color: '#00ff00', stars: 1, chores: [{ chore_id: 9 }] },
  { user_id: 1, name: 'Dad', color: '#ff0000', stars: 0, chores: [] },
] as unknown as PersonBoard[]

describe('alignChoreColumns', () => {
  it('follows the family order, not the board payload order', () => {
    const cols = alignChoreColumns(users, board, [])
    expect(cols.map((c) => c.name)).toEqual(['Dad', 'Mom', 'Autumn', 'Brooklyn'])
  })

  it('keeps an empty column for someone with nothing due', () => {
    const mom = alignChoreColumns(users, board, [])[1]
    expect(mom.name).toBe('Mom')
    expect(mom.stars).toBe(0)
    expect(mom.chores).toEqual([])
  })

  it('uses the person color from the family list so columns match the schedule', () => {
    const autumn = alignChoreColumns(users, board, [])[2]
    expect(autumn.color).toBe('#2563eb')
    expect(autumn.stars).toBe(1)
    expect(autumn.chores).toEqual([{ chore_id: 9 }])
  })

  it('honours a widget config that only shows some people', () => {
    const cols = alignChoreColumns(users, board, [3, 1])
    expect(cols.map((c) => c.name)).toEqual(['Dad', 'Autumn'])
  })

  it('falls back to the board when the family list has not loaded', () => {
    const cols = alignChoreColumns([], board, [])
    expect(cols.map((c) => c.name)).toEqual(['Autumn', 'Dad'])
  })
})
