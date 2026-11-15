export interface ListRef {
  id: number
}

/** Which shared list a dashboard widget draws.
 *
 *  No id (or 0, the historical default) means the first list. An id that is set
 *  but no longer exists is a gap: falling back to the first list is what made
 *  every widget show the same one, with no way to pick another.
 */
export function pickList<T extends ListRef>(lists: readonly T[], listId: number): T | null {
  if (listId > 0) return lists.find((l) => l.id === listId) ?? null
  return lists[0] ?? null
}
