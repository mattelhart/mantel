import { addDays, format, startOfWeek } from 'date-fns'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from './api/client'
import { UnsavedChangesPrompt, useDismissGuard } from './components/dismissGuard'

const routes = {
  today: '/dashboard', week: '/calendar/week', month: '/calendar/month',
  lists: '/lists', photos: '/photos', meals: '/meals',
} as const
type Destination = keyof typeof routes
const titles: Record<Destination, string> = {
  today: 'Today', week: 'Week', month: 'Month', lists: 'Lists', photos: 'Photos', meals: 'Meals',
}
const slots = ['breakfast', 'lunch', 'dinner'] as const
const dateKey = (day: Date) => format(day, 'yyyy-MM-dd')

type MealEdit = { day: string; meal: typeof slots[number]; title: string }

/** The meal editor. Opens with a title, and asks before throwing a changed one away. */
function MealDialog({ edit, setEdit, save, onClose }: {
  edit: MealEdit
  setEdit: (edit: MealEdit) => void
  save: { mutateAsync: (entry: MealEdit) => Promise<unknown>; mutate: (entry: MealEdit) => void; isPending: boolean; isError: boolean }
  onClose: () => void
}) {
  const [openingTitle] = useState(edit.title)
  const guard = useDismissGuard({
    dirty: edit.title !== openingTitle,
    // The mutation's own success handler closes the dialog.
    save: () => save.mutateAsync(edit).then(() => true, () => false),
    onClose,
    busy: save.isPending,
  })
  return <div className="modal" role="dialog" aria-modal="true" aria-label="Edit meal" {...guard.backdropProps}>
    <form className="modal__card" inert={guard.confirming}
      onSubmit={event => { event.preventDefault(); save.mutate(edit) }}>
      <h2>Edit {edit.meal}</h2>
      <label>Meal name <input maxLength={200} value={edit.title} onChange={event => setEdit({ ...edit, title: event.target.value })} /></label>
      {save.isError && <p role="alert">Could not save the meal.</p>}
      <div><button type="button" disabled={save.isPending} onClick={guard.requestClose}>Cancel</button>
        <button disabled={save.isPending}>Save meal</button>
        {edit.title && <button type="button" disabled={save.isPending} onClick={() => save.mutate({ ...edit, title: '' })}>Clear meal</button>}</div>
    </form>
    {guard.confirming && <UnsavedChangesPrompt {...guard.promptProps} />}
  </div>
}

export function MealsPage() {
  const [week, setWeek] = useState(() => startOfWeek(new Date()))
  const days = Array.from({ length: 7 }, (_, index) => addDays(week, index))
  const key = ['meals', dateKey(week)]
  const queryClient = useQueryClient()
  const plan = useQuery({
    queryKey: key,
    queryFn: () => api.get<Record<string, string>>('/meals?start=' + dateKey(week) + '&end=' + dateKey(days[6])),
    refetchInterval: 15000,
  })
  const [edit, setEdit] = useState<{ day: string; meal: typeof slots[number]; title: string } | null>(null)
  const save = useMutation({
    mutationFn: (entry: NonNullable<typeof edit>) => api.post('/meals', entry),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['meals'] }); setEdit(null) },
  })
  return <div className="dash">
    <h1>Meal plan</h1>
    <div className="dash__bar">
      <button onClick={() => setWeek(addDays(week, -7))}>Previous week</button>
      <span>{format(week, 'MMM d')} - {format(days[6], 'MMM d, yyyy')}</span>
      <button onClick={() => setWeek(addDays(week, 7))}>Next week</button>
    </div>
    {plan.isError && <p role="alert">Could not load the meal plan.</p>}
    <div className="dash__grid">{days.map(day => <section key={dateKey(day)} className="widget" data-size="medium">
      <h2>{format(day, 'EEEE, MMM d')}</h2>
      {slots.map(meal => {
        const title = plan.data?.[dateKey(day) + ':' + meal] ?? ''
        return <p key={meal}><button disabled={!plan.isSuccess} onClick={() => { save.reset(); setEdit({ day: dateKey(day), meal, title }) }}>
          {meal[0].toUpperCase() + meal.slice(1)}{title ? ': ' + title : ' +'}
        </button></p>
      })}
    </section>)}</div>
    {edit && <MealDialog edit={edit} setEdit={setEdit} save={save} onClose={() => setEdit(null)} />}
  </div>
}

type Display = { id: string; name: string }

export function ShowOnTvPage() {
  const [destination, setDestination] = useState<Destination>('today')
  const devices = useQuery({
    queryKey: ['displays'], queryFn: () => api.get<Display[]>('/displays'), refetchInterval: 3000,
  })
  const send = useMutation({
    mutationFn: (device: Display) => api.post('/displays/' + device.id + '/show', { destination }),
  })
  return <div className="dash">
    <h1>Show on TV</h1>
    <label>What to show <select value={destination} onChange={event => { send.reset(); setDestination(event.target.value as Destination) }}>
      {Object.entries(titles).map(([value, title]) => <option key={value} value={value}>{title}</option>)}
    </select></label>
    <p>Open Homie on the TV and give it a name on this page.</p>
    {document.documentElement.dataset.tv === 'true' && <DisplayName />}
    {devices.isSuccess && !devices.data.length && <p>No TVs are online.</p>}
    {devices.isError && <p role="alert">Could not find TVs.</p>}
    {devices.data?.map(device => <p key={device.id}><button disabled={send.isPending} onClick={() => send.mutate(device)}>Show on {device.name}</button></p>)}
    {send.isSuccess && <p role="status">Sent to {send.variables.name}.</p>}
    {send.isError && <p role="alert">Could not send. Open Homie on the TV and try again.</p>}
  </div>
}

function DisplayName() {
  const [name, setName] = useState(() => localStorage.getItem('mantel.displayName') ?? '')
  return <form onSubmit={event => {
    event.preventDefault()
    localStorage.setItem('mantel.displayName', name.trim())
    window.dispatchEvent(new Event('mantel:display-name'))
  }}><label>This TV's name <input required maxLength={48} value={name} onChange={event => setName(event.target.value)} /></label><button>Save TV name</button></form>
}

export function useDisplayReceiver(enabled: boolean) {
  const navigate = useNavigate()
  useEffect(() => {
    if (!enabled || document.documentElement.dataset.tv !== 'true') return
    let id = localStorage.getItem('mantel.displayId')
    if (!id) {
      const bytes = crypto.getRandomValues(new Uint8Array(16))
      const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
      id = hex
      localStorage.setItem('mantel.displayId', id)
    }
    let active = true
    let pending = false
    const poll = async () => {
      const name = localStorage.getItem('mantel.displayName')
      if (!name || document.hidden || pending) return
      pending = true
      try {
        const { destination } = await api.post<{ destination: Destination | null }>('/displays/' + id + '/poll', { name })
        if (active && destination && routes[destination]) {
          window.dispatchEvent(new Event('mantel:dismiss-saver'))
          navigate(routes[destination])
        }
      } catch {
        // Retrying on the next interval keeps normal navigation available offline.
      } finally {
        pending = false
      }
    }
    void poll()
    const timer = window.setInterval(poll, 3000)
    window.addEventListener('mantel:display-name', poll)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('mantel:display-name', poll)
    }
  }, [enabled, navigate])
}
