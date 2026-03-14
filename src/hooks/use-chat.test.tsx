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

  it('loads public messages and handles public stream events when signed out', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(() =>
        createJsonResponse({
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
        }),
      )

    const { result } = renderHook(() => useChat())

    await waitFor(() => {
      expect(result.current.chatMessages).toHaveLength(1)
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/chat/messages/public', {
      headers: {},
      method: undefined,
    })
    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0]?.url).toBe(
      `${window.location.origin}/api/chat/messages/public/stream`,
    )

    act(() => {
      MockEventSource.instances[0]?.emit('ready')
      MockEventSource.instances[0]?.emit('message', {
        id: 2,
        nickname: 'viewer1',
        body: 'hello there',
        created_at: '2026-03-14T12:00:01.000Z',
      })
    })

    await waitFor(() => {
      expect(result.current.chatConnectionState).toBe('live')
    })

    act(() => {
      MockEventSource.instances[0]?.emit('message', {
        id: 3,
        nickname: 'viewer1',
        body: 'hello there',
        created_at: '2026-03-14T12:00:02.000Z',
      })
    })

    await waitFor(() => {
      expect(result.current.chatMessages).toHaveLength(3)
    })
    expect(result.current.chatMessages[2]?.body).toBe('hello there')
  })

  it('restores stored auth, opens a private stream, and clears auth on ban', async () => {
    window.localStorage.setItem(
      'andromeda-chat-auth',
      JSON.stringify({
        nickname: 'testuser',
        token: 'token-123',
        isAdmin: true,
      }),
    )

    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockImplementationOnce(() =>
        createJsonResponse({
          json: { messages: [] },
        }),
      )
      .mockImplementationOnce(() =>
        createJsonResponse({
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
        }),
      )
      .mockImplementationOnce(() =>
        createJsonResponse({
          json: { ok: true },
        }),
      )
      .mockImplementationOnce(() =>
        createJsonResponse({
          json: { messages: [] },
        }),
      )

    const { result } = renderHook(() => useChat())

    await waitFor(() => {
      expect(result.current.authToken).toBe('token-123')
      expect(result.current.chatMessages).toHaveLength(1)
    })

    expect(MockEventSource.instances).toHaveLength(2)
    expect(MockEventSource.instances[0]?.url).toBe(
      `${window.location.origin}/api/chat/messages/public/stream`,
    )
    expect(MockEventSource.instances[0]?.closed).toBe(true)
    expect(MockEventSource.instances[1]?.url).toBe(
      `${window.location.origin}/api/chat/messages/stream`,
    )

    act(() => {
      MockEventSource.instances[1]?.emit('warn', { nickname: 'testuser' })
    })

    await waitFor(() => {
      expect(result.current.chatNotice).toBe(
        'you have been warned for your previous message',
      )
    })

    act(() => {
      MockEventSource.instances[1]?.emit('ban', { nickname: 'testuser' })
    })

    await waitFor(() => {
      expect(result.current.authToken).toBeNull()
      expect(result.current.authNickname).toBeNull()
    })

    expect(window.localStorage.getItem('andromeda-chat-auth')).toBeNull()
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/chat/auth/logout',
      {
        headers: {},
        method: 'POST',
      },
    )
    expect(MockEventSource.instances[1]?.closed).toBe(true)
    expect(MockEventSource.instances.at(-1)?.url).toBe(
      `${window.location.origin}/api/chat/messages/public/stream`,
    )
  })

  it('surfaces offline chat state after repeated stream errors and supports manual retry', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(() =>
      createJsonResponse({
        json: {
          messages: [],
        },
      }),
    )

    const { result } = renderHook(() => useChat())

    await waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    act(() => {
      MockEventSource.instances[0]?.emit('error')
      MockEventSource.instances[0]?.emit('error')
      MockEventSource.instances[0]?.emit('error')
    })

    await waitFor(() => {
      expect(result.current.chatConnectionState).toBe('offline')
      expect(result.current.chatConnectionDetail).toContain('unavailable')
    })

    act(() => {
      result.current.retryChatConnection()
    })

    await waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(2)
    })
    expect(MockEventSource.instances[0]?.closed).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('tracks message mutation state while sending and clears it after success', async () => {
    window.localStorage.setItem(
      'andromeda-chat-auth',
      JSON.stringify({
        nickname: 'testuser',
        token: 'token-123',
        isAdmin: false,
      }),
    )

    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockImplementationOnce(() =>
        createJsonResponse({
          json: { messages: [] },
        }),
      )
      .mockImplementationOnce(() =>
        createJsonResponse({
          json: {
            messages: [],
            user: {
              nickname: 'testuser',
              isAdmin: false,
            },
          },
        }),
      )
      .mockImplementationOnce(() =>
        createJsonResponse({
          json: { ok: true },
        }),
      )

    const { result } = renderHook(() => useChat())

    await waitFor(() => {
      expect(result.current.authToken).toBe('token-123')
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
    expect(fetchMock).toHaveBeenLastCalledWith('/api/chat/messages', {
      body: JSON.stringify({ body: 'hello world' }),
      headers: {
        Authorization: 'Bearer token-123',
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })
  })
})
