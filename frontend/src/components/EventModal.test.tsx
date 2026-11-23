// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalendarEvent, CalendarInfo, User } from '../api/types'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('../api/hooks', () => {
  const calendars = [
    { id: 1, name: 'Family', is_local: true, claimed_by_user_id: 1, writable: true, sync_enabled: false,
      account_provider: null, color: '#3b82f6' },
  ] as unknown as CalendarInfo[]
  const users = [{ id: 1, name: 'Dad', color: '#3b82f6' }] as unknown as User[]
  return {
    useCalendars: () => ({ data: calendars }),
    useUsers: () => ({ data: users }),
    useCreateEvent: () => ({ mutateAsync: mocks.create, isPending: false }),
    useUpdateEvent: () => ({ mutateAsync: mocks.update, isPending: false }),
    useDeleteEvent: () => ({ mutateAsync: mocks.remove, isPending: false }),
  }
})

import { EventModal } from './EventModal'
import { TAP_THROUGH_GUARD_MS } from './dismissGuard'
import { byText, click, flush, key, mount, tapPointer, type, unmount } from './testDom'

const existing: CalendarEvent = {
  id: 7, calendar_id: 1, calendar_name: 'Family', color: '#3b82f6', user_id: 1,
  title: 'Soccer practice', description: null, location: null,
  start_at: '2026-08-08T15:00:00Z', end_at: '2026-08-08T16:00:00Z', all_day: false,
  timezone: null, recurring: false, recurrence_rule: null, recurrence_text: null,
  origin: 'local', sync_state: 'synced', editable: true,
}

const backdrop = () => document.querySelector<HTMLElement>('.modal')!
const title = () => document.querySelector<HTMLInputElement>('.modal__card input')!
const prompt = () => document.querySelector('[role="alertdialog"]')
/** A button of the "Save changes?" prompt (the form has its own Save). */
const choice = (label: string) => byText(label, prompt()!)!

describe('EventModal dismissal', () => {
  const onClose = vi.fn()
  const under = vi.fn()

  const open = (event: CalendarEvent | null = null) =>
    mount(
      <>
        <button data-testid="calendar-slot" onClick={under}>slot</button>
        <EventModal event={event} defaultStart={new Date(2026, 7, 8, 9, 0)} onClose={onClose} />
      </>,
    )

  beforeEach(() => {
    vi.useFakeTimers()
    onClose.mockReset()
    under.mockReset()
    Object.values(mocks).forEach((m) => m.mockReset().mockResolvedValue({}))
  })
  afterEach(() => {
    unmount()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('a tap outside a new, untouched event closes it with no prompt', () => {
    open()
    tapPointer(backdrop())
    expect(onClose).toHaveBeenCalledOnce()
    expect(prompt()).toBeNull()
  })

  it('does not activate the calendar slot under the tap', () => {
    open()
    tapPointer(backdrop())
    click(document.querySelector('[data-testid="calendar-slot"]')!)
    expect(under).not.toHaveBeenCalled()
    vi.advanceTimersByTime(TAP_THROUGH_GUARD_MS + 10)
    click(document.querySelector('[data-testid="calendar-slot"]')!)
    expect(under).toHaveBeenCalledOnce()
  })

  it('opening an existing event and tapping out is clean too', () => {
    open(existing)
    tapPointer(backdrop())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('asks before closing once the title was typed, for tap, Escape and Cancel', () => {
    open()
    type(title(), 'Dentist')
    tapPointer(backdrop())
    expect(prompt()).not.toBeNull()
    // The browser's click for that tap is eaten for a moment; wait it out like a person would.
    vi.advanceTimersByTime(TAP_THROUGH_GUARD_MS + 10)
    click(choice('Keep editing'))
    key('Escape')
    expect(prompt()).not.toBeNull()
    click(choice('Keep editing'))
    click(byText('Cancel')!)
    expect(prompt()).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(title().value).toBe('Dentist')
  })

  it('changing an existing event counts, and changing it back does not', () => {
    open(existing)
    type(title(), 'Soccer')
    key('Escape')
    expect(prompt()).not.toBeNull()
    click(choice('Keep editing'))
    type(title(), 'Soccer practice')
    key('Escape')
    expect(prompt()).toBeNull()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Save creates the event and closes', async () => {
    open()
    type(title(), 'Dentist')
    key('Escape')
    click(choice('Save'))
    await flush()
    expect(mocks.create).toHaveBeenCalledOnce()
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ title: 'Dentist', calendar_id: 1 })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Save on an edited event updates it', async () => {
    open(existing)
    type(title(), 'Soccer game')
    tapPointer(backdrop())
    vi.advanceTimersByTime(TAP_THROUGH_GUARD_MS + 10)
    click(choice('Save'))
    await flush()
    expect(mocks.update).toHaveBeenCalledOnce()
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ id: 7, title: 'Soccer game' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Save with a failing validation keeps the panel open and shows why', async () => {
    open()
    // Edited, but the title is blank, so the normal save refuses.
    const location = document.querySelectorAll<HTMLInputElement>('.modal__card input')[2]
    type(location, 'Riverside Park')
    key('Escape')
    click(choice('Save'))
    await flush()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(prompt()).toBeNull()
    expect(document.querySelector('.modal__error')?.textContent).toBe('Give the event a title.')
  })

  it('Save that the server rejects keeps the panel open with the error', async () => {
    mocks.create.mockRejectedValueOnce(new Error('Calendar is read-only'))
    open()
    type(title(), 'Dentist')
    key('Escape')
    click(choice('Save'))
    await flush()
    expect(onClose).not.toHaveBeenCalled()
    expect(prompt()).toBeNull()
    expect(document.querySelector('.modal__error')?.textContent).toBe('Calendar is read-only')
  })

  it('Discard closes without saving', () => {
    open()
    type(title(), 'Dentist')
    key('Escape')
    click(choice('Discard'))
    expect(onClose).toHaveBeenCalledOnce()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('a read-only event never prompts', () => {
    open({ ...existing, editable: false })
    key('Escape')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
