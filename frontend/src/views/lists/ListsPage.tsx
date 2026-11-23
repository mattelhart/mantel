import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../api/client'
import { useEntityMutation, useUsers } from '../../api/hooks'
import { checkListItem } from '../../offline/actions'
import type { SharedList } from '../../api/types'

const LIST_KEYS = ['lists']

export function ListsPage() {
  const { data: lists = [] } = useQuery({
    queryKey: LIST_KEYS,
    queryFn: () => api.get<SharedList[]>('/lists'),
  })
  const [newName, setNewName] = useState('')

  const createList = useEntityMutation(
    (body: { name: string; icon: string }) => api.post<SharedList>('/lists', body),
    LIST_KEYS,
  )

  const add = () => {
    const name = newName.trim()
    if (!name || createList.isPending) return
    createList.mutate({ name, icon: guessIcon(name) }, { onSuccess: () => setNewName('') })
  }

  return (
    <div className="lists">
      <header className="lists__bar">
        <h1 className="lists__title">Lists</h1>
      </header>

      <div className="lists__body">
        {lists.length === 0 && (
          <p className="hint">
            No lists yet. Groceries, packing for a trip — whatever the house needs to tick off.
          </p>
        )}

        <div className="lists__grid">
          {lists.map((list) => (
            <ListCard key={list.id} list={list} />
          ))}
        </div>

        {createList.error && <p role="alert">{createList.error.message}</p>}
        <div className="row">
          <input
            className="row__name"
            placeholder="New list (e.g. Groceries)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button className="btn btn--primary" disabled={createList.isPending || !newName.trim()} onClick={add}>
            Add list
          </button>
        </div>
      </div>
    </div>
  )
}

function ListCard({ list }: { list: SharedList }) {
  const { data: users = [] } = useUsers()
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<{ id: number | null; value: string } | null>(null)
  const [deleting, setDeleting] = useState<'list' | 'checked' | number | null>(null)
  const [assignee, setAssignee] = useState<number | ''>('')

  const addItem = useEntityMutation(
    (body: { text: string; assigned_user_id: number | null }) =>
      api.post(`/lists/${list.id}/items`, body),
    LIST_KEYS,
  )
  const edit = useEntityMutation(
    ({ id, value }: { id: number | null; value: string }) => id === null
      ? api.patch(`/lists/${list.id}`, { name: value.trim() })
      : api.patch(`/lists/${list.id}/items/${id}`, { text: value.trim() }),
    LIST_KEYS,
  )
  const qc = useQueryClient()
  const removeItem = useEntityMutation(
    (id: number) => api.del(`/lists/${list.id}/items/${id}`),
    LIST_KEYS,
  )
  const clearChecked = useEntityMutation(
    () => api.post(`/lists/${list.id}/clear-checked`),
    LIST_KEYS,
  )
  const removeList = useEntityMutation(() => api.del(`/lists/${list.id}`), LIST_KEYS)

  const submit = () => {
    const value = text.trim()
    if (!value || addItem.isPending) return
    addItem.mutate({ text: value, assigned_user_id: assignee === '' ? null : assignee }, { onSuccess: () => setText('') })
  }

  const checkedCount = list.items.filter((i) => i.checked).length

  return (
    <section className="listcard">
      <div className="listcard__head">
        <h2>
          {list.icon} {list.name}
        </h2>
        <span className="listcard__count">{list.item_count} left</span>
        {/* Grouped so a narrow card wraps both buttons together, rather than
            stranding Delete on a line of its own. */}
        <div className="listcard__actions">
          <button className="iconbtn" onClick={() => setEditing({ id: null, value: list.name })}>Rename</button>
          {checkedCount > 0 && (
            <button className="iconbtn" onClick={() => setDeleting('checked')}>
              Clear {checkedCount}
            </button>
          )}
          <button className="iconbtn iconbtn--danger" onClick={() => setDeleting('list')}>
            Delete
          </button>
        </div>
      </div>

      {editing && (
        <form className="listcard__add" onSubmit={(event) => {
          event.preventDefault()
          if (editing.value.trim() && !edit.isPending) edit.mutate(editing, { onSuccess: () => setEditing(null) })
        }}>
          <input aria-label={editing.id === null ? 'List name' : 'Item text'} autoFocus
            value={editing.value} maxLength={editing.id === null ? 100 : 500}
            disabled={edit.isPending} onChange={(event) => setEditing({ ...editing, value: event.target.value })} />
          <button className="btn" disabled={edit.isPending || !editing.value.trim()}>Save</button>
          <button className="btn" type="button" disabled={edit.isPending} onClick={() => setEditing(null)}>Cancel</button>
        </form>
      )}
      {deleting !== null && (
        <div role="group" aria-label="Confirm deletion">
          <p>{deleting === 'list' ? `Delete ${list.name} and all its items for everyone?`
            : deleting === 'checked' ? `Delete ${checkedCount} completed items?` : 'Delete this item for everyone?'}</p>
          <button className="btn" disabled={removeList.isPending || removeItem.isPending || clearChecked.isPending}
            onClick={() => {
              const options = { onSuccess: () => setDeleting(null) }
              if (deleting === 'list') removeList.mutate(undefined as never, options)
              else if (deleting === 'checked') clearChecked.mutate(undefined as never, options)
              else removeItem.mutate(deleting, options)
            }}>Delete</button>
          <button className="btn" onClick={() => setDeleting(null)}>Cancel</button>
        </div>
      )}
      {(edit.error || addItem.error || removeList.error || removeItem.error || clearChecked.error) && (
        <p role="alert">{String(edit.error?.message || addItem.error?.message || removeList.error?.message || removeItem.error?.message || clearChecked.error?.message)}</p>
      )}
      <ul className="listcard__items">
        {list.items.map((item) => (
          <li key={item.id} className="listitem" data-checked={item.checked}>
            <button
              className="listitem__check"
              aria-label={item.checked ? `Uncheck ${item.text}` : `Check off ${item.text}`}
              style={item.color && !item.checked ? { borderColor: item.color } : undefined}
              onClick={() =>
                void checkListItem(
                  { listId: list.id, itemId: item.id, checked: !item.checked },
                  qc,
                ).catch(() => undefined)
              }
            >
              {item.checked ? '✓' : ''}
            </button>
            <span className="listitem__text">{item.text}</span>
            <button className="iconbtn" aria-label={`Edit ${item.text}`} onClick={() => setEditing({ id: item.id, value: item.text })}>Edit</button>
            <button
              className="listitem__remove"
              aria-label={`Remove ${item.text}`}
              onClick={() => setDeleting(item.id)}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <div className="listcard__add">
        <input
          value={text}
          placeholder="Add an item"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {users.length > 1 && (
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value ? Number(e.target.value) : '')}
            aria-label="Assign to"
          >
            <option value="">Anyone</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn btn--primary" disabled={addItem.isPending || !text.trim()} onClick={submit}>
          Add
        </button>
      </div>
    </section>
  )
}

/** A small nicety: a new list gets a sensible emoji without anyone picking one. */
function guessIcon(name: string): string {
  const n = name.toLowerCase()
  if (/grocer|food|shop|market|costco|aldi|store/.test(n)) return '🛒'
  if (/chore|clean|task|todo|to-do/.test(n)) return '🧹'
  if (/pack|trip|travel|vacation|holiday/.test(n)) return '🧳'
  if (/hardware|tool|diy|garage/.test(n)) return '🔧'
  if (/gift|present|birthday|christmas/.test(n)) return '🎁'
  if (/school|homework|class/.test(n)) return '🎒'
  return '📝'
}
