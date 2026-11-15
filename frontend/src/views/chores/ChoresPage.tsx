import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type CSSProperties } from 'react'
import { ApiError, api } from '../../api/client'
import { useEntityMutation, useUsers } from '../../api/hooks'
import { useAiryTheme, useEventColor } from '../../components/eventColor'
import { usePersonFilter } from '../../hooks/usePersonFilter'
import { checkChore, redeemReward, reviewChore } from '../../offline/actions'
import type { ChoreBoard, ChoreDef, PersonBoard } from '../../api/types'
import { formatBoardDay, shiftDay, weekdayLabel } from './dates'

const KEYS = ['chores']

export function ChoresPage() {
  const [on, setOn] = useState<string | null>(null)
  const path = on ? `/chores/board?on=${on}` : '/chores/board'
  const { data, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['chores', 'board', on ?? 'today'],
    queryFn: () => api.get<ChoreBoard>(path),
    // The live stream refreshes this. The 60s poll is the fallback when it drops.
  })
  const { data: chores = [] } = useQuery({
    queryKey: ['chores', 'defs'],
    queryFn: () => api.get<ChoreDef[]>('/chores'),
  })

  const day = data?.on
  const airy = useAiryTheme()
  const { isVisible } = usePersonFilter()
  const people = data?.people.filter((person) => !airy || isVisible(person.user_id)) ?? []

  return (
    <div className="chores">
      <header className="chores__bar">
        <button
          className="iconbtn"
          onClick={() => day && setOn(shiftDay(day, -1))}
          disabled={!day}
          aria-label="Previous day"
        >
          ‹
        </button>
        <h1 className="chores__title">
          Chores
          <small>{day ? formatBoardDay(day) : 'Loading…'}</small>
        </h1>
        <button
          className="iconbtn"
          onClick={() => day && setOn(shiftDay(day, 1))}
          disabled={!day}
          aria-label="Next day"
        >
          ›
        </button>
        {on && (
          <button className="iconbtn" onClick={() => setOn(null)}>
            Today
          </button>
        )}
      </header>

      <div className="chores__body">
        {isError && !data && (
          <p className="hint">
            {error instanceof ApiError ? error.message : 'The calendar is unreachable.'}{' '}
            <button className="iconbtn" onClick={() => void refetch()}>
              Retry
            </button>
          </p>
        )}

        {data && data.pending_approvals.length > 0 && (
          <section className="chores__approvals">
            <h2>Waiting for approval</h2>
            {data.pending_approvals.map((item) => (
              <ApprovalRow key={item.completion_id} item={item} />
            ))}
          </section>
        )}

        {data && data.people.length === 0 && (
          <p className="hint">Add a family member in Settings before assigning chores.</p>
        )}
        {airy && data && data.people.length > 0 && people.length === 0 && (
          <p className="hint">Everyone is hidden. Tap a profile along the top to bring their chores back.</p>
        )}

        <div className="chores__people">
          {data &&
            people.map((person) => (
              <PersonColumn key={person.user_id} person={person} day={data.on} />
            ))}
        </div>

        {data && (
          <Rewards
            rewards={data.rewards}
            redemptions={data.pending_redemptions}
            people={data.people}
          />
        )}

        <ChoreForm />

        {chores.length > 0 && (
          <section className="chores__manage">
            <h2>All chores</h2>
            <ul>
              {chores.map((row) => (
                <ChoreRow key={row.id} chore={row} />
              ))}
            </ul>
          </section>
        )}

        {isFetching && !data && <p className="hint">Loading chores…</p>}
      </div>
    </div>
  )
}

function ApprovalRow({ item }: { item: ChoreBoard['pending_approvals'][number] }) {
  const qc = useQueryClient()
  const approve = () => void reviewChore(item.completion_id, true, qc).catch(() => undefined)
  const reject = () => void reviewChore(item.completion_id, false, qc).catch(() => undefined)
  return (
    <div className="chores__approval">
      <span className="chores__swatch" style={{ background: item.color }} />
      <span>
        {item.user_name} · {item.title} · {item.points}★ · {item.on}
      </span>
      <button className="btn btn--primary" onClick={approve}>
        Approve
      </button>
      <button className="btn" onClick={reject}>
        Not yet
      </button>
    </div>
  )
}

const CHEER = ['#f6c9a6', '#b7d4fb', '#f6e3a4', '#b7e4c7', '#f6c1d6', '#d4c4f5', '#b7e3dc', '#f6c4c2']

function PersonColumn({ person, day }: { person: PersonBoard; day: string }) {
  const qc = useQueryClient()
  const airy = useAiryTheme()
  const fill = useEventColor()
  const tone = fill(person.color)
  const [cheer, setCheer] = useState<number | null>(null)
  const toggle = (choreId: number, done: boolean) => {
    if (done && airy) {
      setCheer(choreId)
      window.setTimeout(() => setCheer((current) => (current === choreId ? null : current)), 800)
    }
    void checkChore({ choreId, userId: person.user_id, on: day, done }, qc).catch(() => undefined)
  }
  const letter = person.name.trim().charAt(0).toUpperCase() || '?'

  return (
    <section className="chores__person">
      <header style={{ borderColor: person.color }}>
        <span className="chores__avatar" style={{ background: tone }} aria-hidden>
          {person.avatar_emoji || letter}
        </span>
        <span className="chores__swatch" style={{ background: person.color }} />
        <h2>
          {!airy && person.avatar_emoji ? `${person.avatar_emoji} ` : ''}
          {person.name}
        </h2>
        <span className="chores__stars">{person.stars}★</span>
      </header>
      {person.chores.length === 0 && <p className="hint">Nothing due.</p>}
      <ul>
        {person.chores.map((chore) => {
          const status = chore.completion?.status
          const checked = status === 'done' || status === 'pending'
          return (
            <li
              key={chore.chore_id}
              data-status={status ?? 'open'}
              className={cheer === chore.chore_id ? 'is-cheering' : undefined}
            >
              {cheer === chore.chore_id && (
                <span className="cheer" aria-hidden>
                  {CHEER.map((color, i) => (
                    <i key={color} style={{ '--i': i, '--c': color } as CSSProperties} />
                  ))}
                </span>
              )}
              <button
                className="listitem__check"
                aria-label={checked ? `Uncheck ${chore.title}` : `Check off ${chore.title}`}
                style={
                  airy
                    ? checked
                      ? { background: tone, borderColor: tone, color: '#0b1220' }
                      : { borderColor: '#c5cad3', background: '#fff' }
                    : !checked
                      ? { borderColor: person.color }
                      : undefined
                }
                onClick={() => toggle(chore.chore_id, !checked)}
              >
                {status === 'done' ? '✓' : status === 'pending' ? '…' : ''}
              </button>
              <span className="chores__label">
                {chore.icon} {chore.title}
                <small>
                  {chore.points}★
                  {status === 'pending' ? ' · waiting' : ''}
                </small>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Rewards({
  rewards,
  redemptions,
  people,
}: {
  rewards: ChoreBoard['rewards']
  redemptions: ChoreBoard['pending_redemptions']
  people: PersonBoard[]
}) {
  const [title, setTitle] = useState('')
  const [cost, setCost] = useState(10)
  const [who, setWho] = useState<number | ''>('')
  const [message, setMessage] = useState('')

  const create = useEntityMutation(
    (body: { title: string; points_cost: number }) => api.post('/rewards', body),
    KEYS,
  )
  const qc = useQueryClient()
  const redeem = (rewardId: number, userId: number) =>
    void redeemReward({ rewardId, userId }, qc).catch((err: unknown) => {
      setMessage(err instanceof Error ? err.message : 'Could not redeem that.')
    })
  const fulfill = useEntityMutation(
    (id: number) => api.post(`/redemptions/${id}/fulfill`),
    KEYS,
  )
  const deny = useEntityMutation((id: number) => api.post(`/redemptions/${id}/deny`), KEYS)
  const remove = useEntityMutation((id: number) => api.del(`/rewards/${id}`), KEYS)

  const spender = who === '' ? people[0]?.user_id : who

  const add = () => {
    const name = title.trim()
    if (!name) return
    create.mutate({ title: name, points_cost: cost })
    setTitle('')
  }

  return (
    <section className="chores__rewards">
      <h2>Rewards</h2>
      {message && <p className="hint">{message}</p>}
      {redemptions.length > 0 && (
        <ul className="chores__requests">
          {redemptions.map((row) => (
            <li key={row.id}>
              <span className="chores__swatch" style={{ background: row.color }} />
              {row.user_name} wants {row.reward_title} ({row.points_spent}★)
              <button className="btn btn--primary" onClick={() => fulfill.mutate(row.id)}>
                Given
              </button>
              <button className="btn" onClick={() => deny.mutate(row.id)}>
                Send back
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="chores__reward-grid">
        {rewards.map((row) => (
          <article key={row.id} className="chores__reward">
            <strong>
              {row.icon} {row.title}
            </strong>
            <span>{row.points_cost}★</span>
            <button
              className="btn btn--primary"
              onClick={() => {
                if (spender == null) return
                setMessage('')
                void redeem(row.id, spender)
              }}
            >
              Redeem
            </button>
            <button className="iconbtn iconbtn--danger" onClick={() => remove.mutate(row.id)}>
              Delete
            </button>
          </article>
        ))}
      </div>
      <div className="row chores__form">
        {people.length > 0 && (
          <select
            aria-label="Who is redeeming"
            value={spender ?? ''}
            onChange={(e) => setWho(Number(e.target.value))}
          >
            {people.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.name} ({p.stars}★)
              </option>
            ))}
          </select>
        )}
        <input
          placeholder="New reward"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <input
          aria-label="Star cost"
          type="number"
          min={1}
          value={cost}
          onChange={(e) => setCost(Number(e.target.value))}
        />
        <button className="btn btn--primary" onClick={add}>
          Add reward
        </button>
      </div>
    </section>
  )
}

function ChoreForm() {
  const { data: users = [] } = useUsers()
  const [title, setTitle] = useState('')
  const [points, setPoints] = useState(1)
  const [schedule, setSchedule] = useState<'daily' | 'weekly' | 'once'>('daily')
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [due, setDue] = useState('')
  const [approval, setApproval] = useState(false)
  const [assignees, setAssignees] = useState<number[] | null>(null)
  const [message, setMessage] = useState('')

  const chosen = assignees ?? users.map((u) => u.id)

  const create = useEntityMutation(
    (body: Record<string, unknown>) => api.post('/chores', body),
    KEYS,
  )

  const toggleDay = (day: number) => {
    setDays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort(),
    )
  }

  const togglePerson = (id: number) => {
    setAssignees((current) => {
      const base = current ?? users.map((u) => u.id)
      return base.includes(id) ? base.filter((n) => n !== id) : [...base, id]
    })
  }

  const add = () => {
    const name = title.trim()
    if (!name) return
    create.mutate(
      {
        title: name,
        points,
        schedule,
        weekdays: schedule === 'weekly' ? days : undefined,
        due_on: schedule === 'once' ? due || null : undefined,
        requires_approval: approval,
        assignee_ids: chosen,
      },
      {
        onSuccess: () => {
          setTitle('')
          setMessage('')
        },
        onError: (err) => setMessage(err instanceof ApiError ? err.message : 'Could not save'),
      },
    )
  }

  return (
    <section className="chores__manage">
      <h2>Add a chore</h2>
      {message && <p className="hint">{message}</p>}
      {users.length === 0 && <p className="hint">Add someone in Settings first.</p>}
      <div className="row chores__form">
        <input
          placeholder="Chore"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <input
          aria-label="Stars"
          type="number"
          min={0}
          max={100}
          value={points}
          onChange={(e) => setPoints(Number(e.target.value))}
        />
        <select
          aria-label="Schedule"
          value={schedule}
          onChange={(e) => setSchedule(e.target.value as 'daily' | 'weekly' | 'once')}
        >
          <option value="daily">Every day</option>
          <option value="weekly">Weekly</option>
          <option value="once">One day</option>
        </select>
        <button className="btn btn--primary" onClick={add}>
          Add chore
        </button>
      </div>
      {schedule === 'weekly' && (
        <div className="chores__days">
          {[0, 1, 2, 3, 4, 5, 6].map((day) => (
            <button
              key={day}
              className="iconbtn"
              aria-pressed={days.includes(day)}
              onClick={() => toggleDay(day)}
            >
              {weekdayLabel(day)}
            </button>
          ))}
        </div>
      )}
      {schedule === 'once' && (
        <input aria-label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      )}
      <label className="chores__checkline">
        <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} />
        Needs approval before stars
      </label>
      <div className="chores__days">
        {users.map((u) => (
          <button
            key={u.id}
            className="iconbtn"
            aria-pressed={chosen.includes(u.id)}
            onClick={() => togglePerson(u.id)}
          >
            {u.name}
          </button>
        ))}
      </div>
    </section>
  )
}

function ChoreRow({ chore }: { chore: ChoreDef }) {
  const remove = useEntityMutation((id: number) => api.del(`/chores/${id}`), KEYS)
  const when =
    chore.schedule === 'daily'
      ? 'Every day'
      : chore.schedule === 'weekly'
        ? chore.weekdays.map(weekdayLabel).join(', ')
        : (chore.due_on ?? 'Once')
  return (
    <li className="chores__def">
      <span>
        {chore.icon} {chore.title} · {chore.points}★ · {when}
        {chore.requires_approval ? ' · approval' : ''}
      </span>
      <button className="iconbtn iconbtn--danger" onClick={() => remove.mutate(chore.id)}>
        Delete
      </button>
    </li>
  )
}
