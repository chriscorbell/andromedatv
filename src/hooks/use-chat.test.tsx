import { act, renderHook, waitFor } from '@testing-library/react'
import type { FormEvent } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChat } from './use-chat'

type MockResponsePayload = {
  ok?: boolean
  status?: number
  json?: unknown
}

class MockEventSource {
  static instances: MockEventSource[] = []

  readonly url: string
  closed = false
  private listeners = new Map<string, Set<(event?: MessageEvent) => void>>()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event?: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  close() {
    this.closed = true
  }

  emit(type: string, payload?: unknown) {
    const event =
      payload === undefined
        ? undefined
        : ({ data: JSON.stringify(payload) } as MessageEvent)

    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }

  static reset() {
    MockEventSource.instances = []
  }
}

function createJsonResponse({
  ok = true,
  status = ok ? 200 : 500,
  json,
}: MockResponsePayload = {}) {
  return Promise.resolve({
    ok,
    status,
    json: async () => json,
  } as Response)
}

describe('useChat', () => {
  beforeEach(() => {
    window.localStorage.clear()
    MockEventSource.reset()
    vi.restoreAllMocks()
    vi.stubGlobal('EventSource', MockEventSource)
    vi.stubGlobal('fetch', vi.fn())
  })

  it('falls back to public chat when there is no authenticated cookie session', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation((input) => {
      if (input === '/api/chat/messages') {
        return createJsonResponse({
          ok: false,
          status: 401,
          json: { error: 'Missing auth token' },
        })
      }

      return createJsonResponse({
        json: {
          messages: [
            {
              id: 1,
              nickname: 'system',
              body: 'welcome',
              created_at: '2026-03-14T12:00:00.000Z',
            },
          ],
        },
      })
    })

    const { result } = renderHook(() => useChat())

    await waitFor(() => {
      expect(result.current.chatMessages).toHaveLength(1)
    })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/chat/messages', {
      credentials: 'same-origin',
      headers: {},
      method: undefined,
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/chat/messages/public', {
      credentials: 'same-origin',
      headers: {},
      method: undefined,
    })
    expect(result.current.authSessionActive).toBe(false)
    expect(MockEventSource.instances.length).toBeGreaterThan(0)
    expect(MockEventSource.instances.at(-1)?.url).toBe(
      `${window.location.origin}/api/chat/messages/public/stream`,
    )
  })

  it('uses an authenticated cookie session, then logs out and falls back on ban', async () => {
    const fetchMock = vi.mocked(fetch)
    let loggedOut = false
    fetchMock.mockImplementation((input) => {
      if (input === '/api/chat/auth/logout') {
        loggedOut = true
        return createJsonResponse({
          json: { ok: true },
        })
      }

      if (input === '/api/chat/messages') {
        return loggedOut
          ? createJsonResponse({
              ok: false,
              status: 401,
              json: { error: 'Missing auth token' },
            })
          : createJsonResponse({
              json: {
                messages: [
                  {
                    id: 10,
                    nickname: 'system',
                    body: 'authenticated history',
                    created_at: '2026-03-14T12:00:00.000Z',
                  },
                ],
                user: {
                  nickname: 'testuser',
                  isAdmin: true,
                },
              },
            })
      }

      return createJsonResponse({
        json: { messages: [] },
      })
    })

    const { result } = renderHook(() => useChat())

    await waitFor(() => {
      expect(result.current.authSessionActive).toBe(true)
      expect(result.current.chatMessages).toHaveLength(1)
    })

    expect(MockEventSource.instances.length).toBeGreaterThan(0)
    expect(MockEventSource.instances.at(-1)?.url).toBe(
      `${window.location.origin}/api/chat/messages/stream`,
    )

    act(() => {
      MockEventSource.instances.at(-1)?.emit('warn', { nickname: 'testuser' })
    })

    await waitFor(() => {
      expect(result.current.chatNotice).toBe(
        'you have been warned for your previous message',
      )
    })

    act(() => {
      MockEventSource.instances.at(-1)?.emit('ban', { nickname: 'testuser' })
    })

    await waitFor(() => {
      expect(result.current.authSessionActive).toBe(false)
      expect(result.current.authNickname).toBeNull()
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/chat/auth/logout', {
      credentials: 'same-origin',
      headers: {},
      method: 'POST',
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/chat/messages/public', {
      credentials: 'same-origin',
      headers: {},
      method: undefined,
    })
    expect(MockEventSource.instances.some((instance) => instance.closed)).toBe(true)
    expect(MockEventSource.instances.at(-1)?.url).toBe(
      `${window.location.origin}/api/chat/messages/public/stream`,
    )
  })

  it('surfaces offline chat state after repeated stream errors and supports manual retry', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation((input) => {
      if (input === '/api/chat/messages') {
        return createJsonResponse({
          ok: false,
          status: 401,
          json: { error: 'Missing auth token' },
        })
      }

      return createJsonResponse({
        json: {
          messages: [],
        },
      })
    })

    const { result } = renderHook(() => useChat())

    await waitFor(() => {
      expect(MockEventSource.instances.length).toBeGreaterThan(0)
    })

    act(() => {
      const stream = MockEventSource.instances.at(-1)
      stream?.emit('error')
      stream?.emit('error')
      stream?.emit('error')
    })

    await waitFor(() => {
      expect(result.current.chatConnectionState).toBe('offline')
      expect(result.current.chatConnectionDetail).toContain('unavailable')
    })

    act(() => {
      result.current.retryChatConnection()
    })

    await waitFor(() => {
      expect(MockEventSource.instances.length).toBeGreaterThan(1)
    })

    expect(MockEventSource.instances.some((instance) => instance.closed)).toBe(true)
    expect(fetchMock).toHaveBeenCalled()
  })

  it('signs in without storing a token and sends messages with cookie auth', async () => {
    const fetchMock = vi.mocked(fetch)
    let loggedIn = false
    fetchMock.mockImplementation((input, init) => {
      if (input === '/api/chat/auth/login') {
        loggedIn = true
        return createJsonResponse({
          json: {
            nickname: 'testuser',
            isAdmin: false,
          },
        })
      }

      if (input === '/api/chat/messages' && init?.method === 'POST') {
        return createJsonResponse({
          json: { ok: true },
        })
      }

      if (input === '/api/chat/messages') {
        return loggedIn
          ? createJsonResponse({
              json: {
                messages: [],
                user: {
                  nickname: 'testuser',
                  isAdmin: false,
                },
              },
            })
          : createJsonResponse({
              ok: false,
              status: 401,
              json: { error: 'Missing auth token' },
            })
      }

      return createJsonResponse({
        json: { messages: [] },
      })
    })

    const { result } = renderHook(() => useChat())

    await waitFor(() => {
      expect(MockEventSource.instances.length).toBeGreaterThan(0)
    })

    act(() => {
      result.current.handleAuthNicknameChange('testuser')
      result.current.handleAuthPasswordChange('hunter2')
    })

    await act(async () => {
      await result.current.handleAuthSubmit({
        preventDefault() {},
      } as FormEvent<HTMLFormElement>)
    })

    await waitFor(() => {
      expect(result.current.authSessionActive).toBe(true)
      expect(MockEventSource.instances.length).toBeGreaterThan(1)
    })

    act(() => {
      result.current.handleMessageBodyChange('hello world')
    })

    await act(async () => {
      await result.current.handleSendMessage({
        preventDefault() {},
      } as FormEvent<HTMLFormElement>)
    })

    await waitFor(() => {
      expect(result.current.messageSending).toBe(false)
    })

    expect(result.current.messageStatus).toBe('Message sent.')
    expect(result.current.messageBody).toBe('')
    expect(window.localStorage.getItem('andromeda-chat-auth')).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith('/api/chat/auth/login', {
      body: JSON.stringify({ nickname: 'testuser', password: 'hunter2' }),
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/chat/messages', {
      body: JSON.stringify({ body: 'hello world' }),
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })
  })
})
