// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { byText, click, mount, type, unmount } from '../../components/testDom'
import { MessagesTab } from './MessagesTab'

let settings: Record<string, unknown>
let patches: Record<string, unknown>[]
let tests: unknown[]
const SID = 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'
const TOKEN = 'twilio-auth-token-SUPER-SECRET'

beforeEach(() => {
  settings = {
    twilio_account_sid: '',
    twilio_auth_token: '',
    twilio_from_number: '+18005550100',
    message_provider: 'twilio',
    signal_api_url: 'http://host.docker.internal:8081',
    signal_account_number: '',
    server: {
      twilio_account_sid_set: true,
      twilio_auth_token_set: true,
      twilio_configured: true,
      signal_configured: false,
      messages_configured: true,
      messages_provider: 'twilio',
    },
  }
  patches = []
  tests = []
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: () => 'blob:qr-test',
    revokeObjectURL: () => undefined,
  }))
  const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json' } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url === '/api/settings' && method === 'PATCH') {
        const body = JSON.parse(String(init!.body))
        patches.push(body)
        settings = {
          ...settings,
          ...body,
          twilio_from_number: body.twilio_from_number ?? settings.twilio_from_number,
          twilio_account_sid: '',
          twilio_auth_token: '',
          server: {
            ...(settings.server as object),
            twilio_account_sid_set: body.twilio_account_sid === null ? false : true,
            twilio_auth_token_set: body.twilio_auth_token === null ? false : true,
            twilio_configured: body.twilio_account_sid === null || body.twilio_auth_token === null ? false : true,
            signal_configured: Boolean((body.signal_account_number ?? settings.signal_account_number) && (body.signal_api_url ?? settings.signal_api_url)),
            messages_provider: body.message_provider ?? settings.message_provider,
            messages_configured: true,
          },
        }
        return json(settings)
      }
      if (url === '/api/settings') return json(settings)
      if (url === '/api/users') return json([{ id: 3, name: 'Austin', color: '#3b82f6', avatar_emoji: null, sort_order: 0, phone: '+15555550123' }])
      if (url === '/api/messages/test') {
        tests.push(init?.body)
        return json({ id: 9, user_id: 3, status: 'queued' })
      }
      if (url === '/api/messages/signal/status') {
        return json({
          reachable: true,
          linked: Boolean(settings.signal_account_number),
          accounts: settings.signal_account_number ? [{ number: settings.signal_account_number, aci: '' }] : [],
          mode: 'normal',
          error: null,
          account_number: settings.signal_account_number || '',
        })
      }
      if (url.startsWith('/api/messages/signal/qr')) {
        const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
        return new Response(png, { headers: { 'Content-Type': 'image/png' } })
      }
      return json({})
    }),
  )
})
afterEach(() => {
  unmount()
  vi.unstubAllGlobals()
})

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 5))))
}
const render = async () => {
  mount(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <MessagesTab />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await settle()
}

describe('Messages settings', () => {
  it('only says credentials are saved, never what they are', async () => {
    await render()
    expect(document.querySelector('[data-testid=twilio-state]')?.textContent).toBe('Twilio is set up')
    expect(document.body.innerHTML).not.toContain(SID)
    expect(document.body.innerHTML).not.toContain(TOKEN)
    const passwords = [...document.querySelectorAll<HTMLInputElement>('input[type=password]')]
    expect(passwords).toHaveLength(2)
    expect(passwords.every((el) => el.value === '')).toBe(true)
  })

  it('sends a newly typed token once, then empties the field', async () => {
    await render()
    const tokenField = document.querySelectorAll<HTMLInputElement>('input[type=password]')[1]
    type(tokenField, TOKEN)
    click(byText('Save')!)
    await settle()
    expect(patches).toEqual([{ twilio_auth_token: TOKEN }])
    expect(tokenField.value).toBe('')
    expect(document.body.innerHTML).not.toContain(TOKEN)
  })

  it('sends a test text to a family member', async () => {
    await render()
    click(byText('Send test')!)
    await settle()
    expect(tests).toHaveLength(1)
    expect(document.body.textContent).toContain('Test sent')
  })

  it('switches to Signal settings and opens a QR link screen with Back', async () => {
    await render()
    expect(document.body.textContent).toContain('Twilio')
    expect(document.body.textContent).toContain('Signal')
    click(byText('Signal')!)
    await settle()
    expect(patches).toEqual([{ message_provider: 'signal' }])
    expect(document.body.textContent).toContain('API address')
    expect(document.body.textContent).toContain('Link to Signal')
    click(byText('Link to Signal')!)
    for (let i = 0; i < 12; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
    expect(document.querySelector('.signal-link')).toBeTruthy()
    expect(document.body.textContent).toContain('On your phone: Signal → Settings → Linked devices → +, scan this')
    expect(document.querySelector('img.signal-link__qr')).toBeTruthy()
    expect(document.querySelector('.signal-link__back')?.textContent).toMatch(/Back/)
    expect(document.querySelector('[data-testid=signal-link-state]')?.textContent).toContain('Waiting')
    click(document.querySelector('.signal-link__back')!)
    await settle()
    expect(document.querySelector('.signal-link')).toBeNull()
    expect(byText('Link to Signal')).toBeTruthy()
  })
})
