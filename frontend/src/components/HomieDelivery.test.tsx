// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { act } from 'react'
import { afterEach, expect, it } from 'vitest'
import { HomieDelivery } from './HomieDelivery'
import { click, mount, unmount } from './testDom'

function Where() {
  const route = useLocation()
  return <output>{route.pathname}{route.search}</output>
}

afterEach(() => { unmount(); localStorage.clear() })

it('delivers a picture once, offers Messages between deliveries, and celebrates new stars', async () => {
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
  click(button)
  expect(host.querySelector('output')?.textContent).toBe('/messages')
  expect(host.querySelector('.homie-star')).toBeNull()
  await act(async () => {
    client.setQueryData(board, { people: [{ ...person, stars: 5 }] })
    await new Promise(resolve => setTimeout(resolve, 15))
  })
  expect(host.querySelector('[role=status]')?.textContent).toBe('Nice work, Sam! +2 ★')
  expect(host.querySelector('.homie-star')).toBeTruthy()
})
