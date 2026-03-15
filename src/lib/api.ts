import type { AdminUser } from '../types/admin'
import type { ScheduleItem } from '../types/schedule'

const API_BASE_URL = '/api'
const CHAT_API_URL = `${API_BASE_URL}/chat`

export type ChatMessage = {
  id: number
  nickname: string
  body: string
  created_at: string
  is_admin?: boolean
}

export type ChatAuthPayload = {
  nickname?: string
  isAdmin?: boolean
  error?: string
}

export type ChatMessagesPayload = {
  messages: ChatMessage[]
  user?: {
    nickname: string
    isAdmin: boolean
  }
}

export type ChatPublicMessagesPayload = {
  messages: ChatMessage[]
}

export type ChatMutationErrorPayload = {
  error?: string
  cooldownSeconds?: number
}

export type AdminUsersPayload = {
  users: AdminUser[]
}

export type SchedulePayload = {
  refreshAfterMs?: number
  schedule?: ScheduleItem[]
}

type JsonRequestOptions = {
  body?: unknown
  credentials?: RequestCredentials
  headers?: HeadersInit
  method?: string
}

type JsonResult<T> = {
  data: T
  response: Response
}

async function requestJson<T>(
  url: string,
  {
    body,
    credentials = 'same-origin',
    headers,
    method,
  }: JsonRequestOptions = {},
): Promise<JsonResult<T>> {
  const response = await fetch(url, {
    credentials,
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

  const hasJsonBody = response.status !== 204
  const data = hasJsonBody
    ? ((await response.json()) as T)
    : ({} as T)

  return { data, response }
}

export function createChatStreamUrl(pathname: string) {
  return new URL(`${CHAT_API_URL}${pathname}`, window.location.origin).toString()
}

export const api = {
  schedule: {
    async get() {
      return requestJson<SchedulePayload>(`${API_BASE_URL}/schedule`)
    },
  },
  chat: {
    async logout() {
      return requestJson<{ ok: boolean }>(`${CHAT_API_URL}/auth/logout`, {
        method: 'POST',
      })
    },
    async getMessages() {
      return requestJson<ChatMessagesPayload>(`${CHAT_API_URL}/messages`)
    },
    async getPublicMessages() {
      return requestJson<ChatPublicMessagesPayload>(`${CHAT_API_URL}/messages/public`)
    },
    async submitAuth(
      authMode: 'login' | 'register',
      nickname: string,
      password: string,
    ) {
      return requestJson<ChatAuthPayload>(
        `${CHAT_API_URL}/auth/${authMode === 'login' ? 'login' : 'register'}`,
        {
          method: 'POST',
          body: {
            nickname,
            password,
          },
        },
      )
    },
    async sendMessage(body: string) {
      return requestJson<ChatMutationErrorPayload>(
        `${CHAT_API_URL}/messages`,
        {
          method: 'POST',
          body: { body },
        },
      )
    },
    publicStreamUrl() {
      return createChatStreamUrl('/messages/public/stream')
    },
    privateStreamUrl() {
      return createChatStreamUrl('/messages/stream')
    },
  },
  admin: {
    async getUsers(view: 'active' | 'banned') {
      return requestJson<AdminUsersPayload>(`${CHAT_API_URL}/admin/users/${view}`)
    },
    async clear() {
      return requestJson<{ ok: boolean }>(`${CHAT_API_URL}/admin/clear`, {
        method: 'POST',
      })
    },
    async deleteMessage(messageId: number) {
      return requestJson<{ ok: boolean }>(
        `${CHAT_API_URL}/admin/messages/${messageId}/delete`,
        {
          method: 'POST',
        },
      )
    },
    async warnUser(messageId: number) {
      return requestJson<{ ok: boolean; nickname?: string }>(
        `${CHAT_API_URL}/admin/messages/${messageId}/warn`,
        {
          method: 'POST',
        },
      )
    },
    async banUser(nickname: string) {
      return requestJson<{ ok: boolean }>(
        `${CHAT_API_URL}/admin/users/${encodeURIComponent(nickname)}/ban`,
        {
          method: 'POST',
        },
      )
    },
    async unbanUser(nickname: string) {
      return requestJson<{ ok: boolean }>(
        `${CHAT_API_URL}/admin/users/${encodeURIComponent(nickname)}/unban`,
        {
          method: 'POST',
        },
      )
    },
    async deleteUser(nickname: string) {
      return requestJson<{ ok: boolean }>(
        `${CHAT_API_URL}/admin/users/${encodeURIComponent(nickname)}`,
        {
          method: 'DELETE',
        },
      )
    },
  },
}
