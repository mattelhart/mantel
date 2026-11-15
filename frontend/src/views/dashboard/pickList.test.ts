import { describe, expect, it } from 'vitest'
import { pickList } from './pickList'

const lists = [
  { id: 1, name: 'Groceries' },
  { id: 2, name: 'Hardware' },
]

describe('pickList', () => {
  it('uses the first list when the widget has never chosen one', () => {
    expect(pickList(lists, 0)?.name).toBe('Groceries')
  })

  it('shows the list the widget was pointed at, not always the first', () => {
    expect(pickList(lists, 2)?.name).toBe('Hardware')
  })

  it('does not silently substitute the first list after the chosen one is deleted', () => {
    expect(pickList(lists, 9)).toBeNull()
  })
})
