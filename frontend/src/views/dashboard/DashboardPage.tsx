import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../api/client'
import { useEntityMutation } from '../../api/hooks'
import type { CalendarEvent } from '../../api/types'
import { EventModal } from '../../components/EventModal'
import { useDismissGuard } from '../../components/dismissGuard'
import { WIDGETS } from './widgets'

interface Widget {
  id: number
  widget_type: string
  size: 'small' | 'medium' | 'large'
  position: number
  config: Record<string, unknown>
}

interface WidgetType {
  type: string
  name: string
  description: string
  default_size: string
}

const SIZES: Widget['size'][] = ['small', 'medium', 'large']

export function DashboardPage() {
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [openEvent, setOpenEvent] = useState<CalendarEvent | null>(null)
  const [newEventAt, setNewEventAt] = useState<Date | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const { data: widgets = [] } = useQuery({
    queryKey: ['widgets'],
    queryFn: () => api.get<Widget[]>('/dashboard/widgets'),
  })
  const { data: types = [] } = useQuery({
    queryKey: ['widget-types'],
    queryFn: () => api.get<WidgetType[]>('/dashboard/widget-types'),
  })

  const addWidget = useEntityMutation(
    (body: { widget_type: string; size: string }) => api.post<Widget>('/dashboard/widgets', body),
    ['widgets'],
  )
  const patchWidget = useEntityMutation(
    ({ id, ...patch }: { id: number } & Partial<Widget>) =>
      api.patch<Widget>(`/dashboard/widgets/${id}`, patch),
    ['widgets'],
  )
  const removeWidget = useEntityMutation(
    (id: number) => api.del<void>(`/dashboard/widgets/${id}`),
    ['widgets'],
  )

  const move = (index: number, direction: -1 | 1) => {
    const target = widgets[index + direction]
    const current = widgets[index]
    if (!target) return
    patchWidget.mutate({ id: current.id, position: target.position })
    patchWidget.mutate({ id: target.id, position: current.position })
  }

  const cycleSize = (w: Widget) =>
    patchWidget.mutate({ id: w.id, size: SIZES[(SIZES.indexOf(w.size) + 1) % SIZES.length] })

  const showEvent = (e: CalendarEvent) => {
    setOpenEvent(e)
    setNewEventAt(null)
    setModalOpen(true)
  }
  const createAt = (start: Date) => {
    setOpenEvent(null)
    setNewEventAt(start)
    setModalOpen(true)
  }

  return (
    <div className="dash">
      <header className="dash__bar">
        <h1 className="dash__title">Today</h1>
        <button className="iconbtn" onClick={() => setAdding(true)}>
          + Widget
        </button>
        <button
          className="iconbtn"
          aria-current={editing ? 'page' : undefined}
          onClick={() => setEditing(!editing)}
        >
          {editing ? 'Done' : 'Arrange'}
        </button>
      </header>

      <div className="dash__grid">
        {(['today_agenda', 'chores'] as const).map((type) => {
          const widget = WIDGETS[type]
          return (
            <section key={type} className="widget" data-size="large">
              <widget.component config={{}} onConfigChange={() => {}}
                onOpenEvent={showEvent} onNewEvent={createAt} />
            </section>
          )
        })}
      </div>

      <div className="dash__grid">
        {widgets.map((w, i) => {
          const def = WIDGETS[w.widget_type]
          return (
            <section key={w.id} className="widget" data-size={w.size}>
              {editing && (
                <div className="widget__edit">
                  <button className="iconbtn" onClick={() => move(i, -1)} disabled={i === 0}>
                    ↑
                  </button>
                  <button
                    className="iconbtn"
                    onClick={() => move(i, 1)}
                    disabled={i === widgets.length - 1}
                  >
                    ↓
                  </button>
                  <button className="iconbtn" onClick={() => cycleSize(w)}>
                    {w.size}
                  </button>
                  <button className="iconbtn iconbtn--danger" onClick={() => removeWidget.mutate(w.id)}>
                    Remove
                  </button>
                </div>
              )}
              {def ? (
                <def.component
                  config={w.config}
                  onConfigChange={(config) => patchWidget.mutate({ id: w.id, config })}
                  onOpenEvent={showEvent}
                  onNewEvent={createAt}
                />
              ) : (
                <p className="widget__empty">Unknown widget “{w.widget_type}”.</p>
              )}
            </section>
          )
        })}
      </div>

      {adding && (
        <AddWidgetDialog
          types={types}
          onPick={(t) => {
            addWidget.mutate({ widget_type: t.type, size: t.default_size })
            setAdding(false)
          }}
          onClose={() => setAdding(false)}
        />
      )}

      {modalOpen && (
        <EventModal
          event={openEvent}
          defaultStart={newEventAt}
          onClose={() => {
            setModalOpen(false)
            setOpenEvent(null)
            setNewEventAt(null)
          }}
        />
      )}
    </div>
  )
}

/** The widget picker. Nothing to lose here, so a tap outside, Escape or Cancel just close it. */
function AddWidgetDialog({
  types,
  onPick,
  onClose,
}: {
  types: WidgetType[]
  onPick: (t: WidgetType) => void
  onClose: () => void
}) {
  const guard = useDismissGuard({ dirty: false, onClose })
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Add a widget" {...guard.backdropProps}>
      <div className="modal__card">
        <h2 className="modal__title">Add a widget</h2>
        <div className="picker-list">
          {types.map((t) => (
            <button key={t.type} className="picker" onClick={() => onPick(t)}>
              <span className="picker__name">{t.name}</span>
              <span className="picker__desc">{t.description}</span>
            </button>
          ))}
        </div>
        <div className="modal__actions">
          <div className="modal__spacer" />
          <button className="btn" onClick={guard.requestClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
