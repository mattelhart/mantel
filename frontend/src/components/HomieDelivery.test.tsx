// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { act } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { HomieDelivery } from './HomieDelivery'
import { click, mount, unmount } from './testDom'

function Where() {
  const route = useLocation()
  return <output>{route.pathname}{route.search}</output>
}

afterEach(() => { unmount(); localStorage.clear() })

it('delivers a picture once, dodges between deliveries, and celebrates new stars', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  client.setQueryData(['messages'], { conversations: [{ id: 'user-1', user_id: 1, name: 'Sam',
    last_message: { id: 8, direction: 'in', media_url: '/picture', media_content_type: 'image/png' } }] })
  const board = ['chores', 'board', 'today']
  const person = { user_id: 1, name: 'Sam', color: '#ff6600', stars: 3 }
  client.setQueryData(board, { people: [person] })
  const host = mount(<QueryClientProvider client={client}><MemoryRouter>
    <HomieDelivery /><Where />
  </MemoryRouter></QueryClientProvider>)
  const button = host.querySelector('button')!
  expect(button.getAttribute('aria-label')).toContain('mail from Sam')
  click(button)
  expect(host.querySelector('output')?.textContent).toBe('/games/doodle?media=%2Fpicture&replyTo=1')
  expect(button.querySelector('.homie-letter')).toBeNull()
  click(button)
  expect(button.querySelector('.homie-jump[data-jump="true"]')).toBeTruthy()
  expect(host.querySelector('output')?.textContent).toBe('/games/doodle?media=%2Fpicture&replyTo=1')
  expect(host.querySelector('.homie-star')).toBeNull()
  await act(async () => {
    client.setQueryData(board, { people: [{ ...person, stars: 5 }] })
    await new Promise(resolve => setTimeout(resolve, 15))
  })
  expect(host.querySelector('[role=status]')?.textContent).toBe('Nice work, Sam! +2 ★')
  expect(host.querySelector('.homie-star')).toBeTruthy()
})

it('asks for an unfinished job and opens Chores when the family taps the note', () => {
  vi.useFakeTimers()
  try {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    client.setQueryData(['chores', 'board', 'today'], { people: [{ name: 'Sam', user_id: 1, stars: 3, chores: [
      { title: 'Feed the cat', completion: {status: 'pending'} },
      { title: 'Water the basil', completion: null },
    ] }] })
    const host = mount(<QueryClientProvider client={client}><MemoryRouter><HomieDelivery /><Where /></MemoryRouter></QueryClientProvider>)
    act(() => vi.advanceTimersByTime(12000))
    const note = host.querySelector('.homie-chore-note')!
    expect(note.textContent).toContain('Sam, lend a hand?')
    expect(note.textContent).toContain('Water the basil')
    click(note)
    expect(host.querySelector('output')?.textContent).toBe('/chores')
    expect(host.querySelector('.homie-chore-note')).toBeNull()
  } finally { vi.useRealTimers() }
})
