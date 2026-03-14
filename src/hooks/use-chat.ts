import { useEffect, useEffectEvent, useRef, useState } from 'react'

const CHAT_API_URL = '/api/chat'
const CHAT_STORAGE_KEY = 'andromeda-chat-auth'

export type ChatMessage = {
  id: number
  nickname: string
  body: string
  created_at: string
  is_admin?: boolean
}

export function useChat() {
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null)
  const chatStreamRef = useRef<EventSource | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authToken, setAuthToken] = useState<string | null>(null)
  const [authNickname, setAuthNickname] = useState<string | null>(null)
  const [authIsAdmin, setAuthIsAdmin] = useState(false)
  const [authNicknameInput, setAuthNicknameInput] = useState('')
  const [authPasswordInput, setAuthPasswordInput] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [messageBody, setMessageBody] = useState('')
  const [chatError, setChatError] = useState<string | null>(null)
  const [chatNotice, setChatNotice] = useState<string | null>(null)
  const [chatLoading, setChatLoading] = useState(false)
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)
  const [cooldownRemaining, setCooldownRemaining] = useState<number | null>(null)

  const clearAuth = (notifyServer = true) => {
    setAuthToken(null)
    setAuthNickname(null)
    setAuthIsAdmin(false)
    setAuthNicknameInput('')
    setAuthPasswordInput('')
    setAuthError(null)
    setChatNotice(null)
    if (chatStreamRef.current) {
      chatStreamRef.current.close()
      chatStreamRef.current = null
    }
    window.localStorage.removeItem(CHAT_STORAGE_KEY)
    if (notifyServer) {
      void fetch(`${CHAT_API_URL}/auth/logout`, {
        method: 'POST',
      }).catch((error) => {
        console.warn('Failed to clear chat session cookie', error)
      })
    }
  }

  const appendChatMessage = (message: ChatMessage) => {
    setChatMessages((prev) => {
      if (prev.some((entry) => entry.id === message.id)) {
        return prev
      }
      const next = [...prev, message]
      return next.length > 100 ? next.slice(-100) : next
    })
  }

  const replaceDeletedMessage = (messageId: number) => {
    setChatMessages((prev) =>
      prev.map((entry) =>
        entry.id === messageId
          ? { ...entry, body: 'message deleted' }
          : entry,
      ),
    )
  }

  const redactMessagesByNickname = (nickname: string) => {
    setChatMessages((prev) =>
      prev.map((entry) =>
        entry.nickname === nickname
          ? { ...entry, body: 'message deleted' }
          : entry,
      ),
    )
  }

  const removeMessagesByNickname = (nickname: string) => {
    setChatMessages((prev) =>
      prev.filter((entry) => entry.nickname !== nickname),
    )
  }

  const attachChatStreamHandlers = useEffectEvent((
    stream: EventSource,
    options: {
      includePrivateEvents: boolean
      viewerNickname: string | null
    },
  ) => {
    stream.addEventListener('ready', () => {
      setChatError(null)
    })

    stream.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data) as ChatMessage
        appendChatMessage(message)
        setChatError(null)
      } catch (error) {
        console.warn('Failed to parse chat message', error)
      }
    })

    stream.addEventListener('clear', () => {
      setChatMessages([])
    })

    stream.addEventListener('delete', (event) => {
      try {
        const payload = JSON.parse(event.data) as { id?: number }
        if (!payload.id) {
          return
        }
        replaceDeletedMessage(payload.id)
      } catch (error) {
        console.warn('Failed to parse delete event', error)
      }
    })

    stream.addEventListener('purge', (event) => {
      try {
        const payload = JSON.parse(event.data) as { nickname?: string }
        if (!payload.nickname) {
          return
        }
        redactMessagesByNickname(payload.nickname)
      } catch (error) {
        console.warn('Failed to parse purge event', error)
      }
    })

    if (options.includePrivateEvents) {
      stream.addEventListener('warn', (event) => {
        try {
          const payload = JSON.parse(event.data) as { nickname?: string }
          if (!payload.nickname || payload.nickname !== options.viewerNickname) {
            return
          }
          setChatNotice('you have been warned for your previous message')
        } catch (error) {
          console.warn('Failed to parse warn event', error)
        }
      })

      stream.addEventListener('ban', (event) => {
        try {
          const payload = JSON.parse(event.data) as { nickname?: string }
          if (!payload.nickname || payload.nickname !== options.viewerNickname) {
            return
          }
          clearAuth()
          setChatError('your account has been banned')
        } catch (error) {
          console.warn('Failed to parse ban event', error)
        }
      })
    }

    stream.addEventListener('error', () => {
      setChatError('Chat connection lost. Reconnecting...')
    })
  })

  const fetchMessages = useEffectEvent(async () => {
    if (!authToken) {
      return false
    }

    setChatLoading(true)
    setChatError(null)

    try {
      const response = await fetch(`${CHAT_API_URL}/messages`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      })

      if (response.status === 401) {
        clearAuth()
        return false
      }
      if (response.status === 403) {
        clearAuth()
        setChatError('your account has been banned')
        return false
      }

      if (!response.ok) {
        throw new Error('Failed to load messages')
      }

      const payload = (await response.json()) as {
        messages: ChatMessage[]
        user?: {
          nickname: string
          isAdmin: boolean
        }
      }
      setChatMessages(payload.messages)
      if (payload.user) {
        setAuthNickname(payload.user.nickname)
        setAuthIsAdmin(payload.user.isAdmin)
        window.localStorage.setItem(
          CHAT_STORAGE_KEY,
          JSON.stringify({
            nickname: payload.user.nickname,
            token: authToken,
            isAdmin: payload.user.isAdmin,
          }),
        )
      }
      return true
    } catch (error) {
      console.warn('Failed to load chat messages', error)
      setChatError('Unable to load messages. Try again in a moment.')
      return false
    } finally {
      setChatLoading(false)
    }
  })

  const fetchPublicMessages = async () => {
    setChatLoading(true)
    setChatError(null)

    try {
      const response = await fetch(`${CHAT_API_URL}/messages/public`)
      if (!response.ok) {
        throw new Error('Failed to load public messages')
      }

      const payload = (await response.json()) as { messages: ChatMessage[] }
      setChatMessages(payload.messages)
    } catch (error) {
      console.warn('Failed to load public chat messages', error)
      setChatError('Unable to load messages. Try again in a moment.')
    } finally {
      setChatLoading(false)
    }
  }

  useEffect(() => {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY)
    if (!raw) {
      return
    }

    try {
      const stored = JSON.parse(raw) as {
        nickname?: string
        token?: string
        isAdmin?: boolean
      }
      if (stored?.token && stored?.nickname) {
        setAuthToken(stored.token)
        setAuthNickname(stored.nickname)
        setAuthIsAdmin(Boolean(stored.isAdmin))
      }
    } catch (error) {
      console.warn('Failed to read stored chat auth', error)
    }
  }, [])

  useEffect(() => {
    if (!authToken) {
      if (chatStreamRef.current) {
        chatStreamRef.current.close()
        chatStreamRef.current = null
      }
      void fetchPublicMessages()
      const publicStreamUrl = new URL(
        `${CHAT_API_URL}/messages/public/stream`,
        window.location.origin,
      )
      const publicStream = new EventSource(publicStreamUrl.toString())
      chatStreamRef.current = publicStream
      attachChatStreamHandlers(publicStream, {
        includePrivateEvents: false,
        viewerNickname: null,
      })

      return () => {
        publicStream.close()
        if (chatStreamRef.current === publicStream) {
          chatStreamRef.current = null
        }
      }
    }

    let disposed = false
    let stream: EventSource | null = null

    void (async () => {
      const canConnect = await fetchMessages()
      if (!canConnect || disposed) {
        return
      }

      const streamUrl = new URL(`${CHAT_API_URL}/messages/stream`, window.location.origin)
      stream = new EventSource(streamUrl.toString())
      chatStreamRef.current = stream
      attachChatStreamHandlers(stream, {
        includePrivateEvents: true,
        viewerNickname: authNickname,
      })
    })()

    return () => {
      disposed = true
      stream?.close()
      if (stream && chatStreamRef.current === stream) {
        chatStreamRef.current = null
      }
    }
  }, [authNickname, authToken])

  useEffect(() => {
    if (!chatScrollRef.current) {
      return
    }

    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
  }, [chatMessages.length])

  useEffect(() => {
    const chatInput = chatInputRef.current
    if (!chatInput) {
      return
    }

    chatInput.style.height = 'auto'
    chatInput.style.height = `${chatInput.scrollHeight}px`
  }, [messageBody])

  useEffect(() => {
    if (!cooldownUntil) {
      setCooldownRemaining(null)
      return
    }

    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))
      setCooldownRemaining(remaining)
      if (remaining === 0) {
        setCooldownUntil(null)
      }
    }

    updateRemaining()
    const timer = window.setInterval(updateRemaining, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [cooldownUntil])

  const handleAuthSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAuthError(null)
    setAuthLoading(true)

    try {
      const response = await fetch(
        `${CHAT_API_URL}/auth/${authMode === 'login' ? 'login' : 'register'}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            nickname: authNicknameInput.trim(),
            password: authPasswordInput,
          }),
        },
      )

      const payload = (await response.json()) as {
        nickname?: string
        token?: string
        isAdmin?: boolean
        error?: string
      }

      if (!response.ok || !payload.token || !payload.nickname) {
        setAuthError(payload.error || 'Unable to sign in. Check your details.')
        return
      }

      setAuthToken(payload.token)
      setAuthNickname(payload.nickname)
      setAuthIsAdmin(Boolean(payload.isAdmin))
      setAuthPasswordInput('')
      setMessageBody('')
      setChatNotice(null)
      window.localStorage.setItem(
        CHAT_STORAGE_KEY,
        JSON.stringify({
          nickname: payload.nickname,
          token: payload.token,
          isAdmin: Boolean(payload.isAdmin),
        }),
      )
    } catch (error) {
      console.warn('Auth failed', error)
      setAuthError('Unable to sign in. Try again in a moment.')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleSendMessage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!authToken) {
      return
    }

    if (cooldownUntil && Date.now() < cooldownUntil) {
      setChatError("slow down, don't spam!")
      return
    }

    const trimmed = messageBody.replace(/[\r\n]+/g, ' ').trim()
    if (!trimmed) {
      return
    }

    setChatError(null)

    try {
      const response = await fetch(`${CHAT_API_URL}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ body: trimmed }),
      })

      if (response.status === 401) {
        clearAuth()
        return
      }

      const payload = (await response.json()) as {
        error?: string
        cooldownSeconds?: number
      }

      if (!response.ok) {
        if (response.status === 403) {
          clearAuth()
          setChatError(payload.error || 'your account has been banned')
          return
        }
        if (response.status === 429 && payload.cooldownSeconds) {
          setCooldownUntil(Date.now() + payload.cooldownSeconds * 1000)
          setChatError(payload.error || "slow down, don't spam!")
          return
        }
        setChatError(payload.error || 'Message failed to send.')
        return
      }

      setMessageBody('')
    } catch (error) {
      console.warn('Failed to send chat message', error)
      setChatError('Message failed to send.')
    }
  }

  const toggleAuthMode = () => {
    setAuthMode((prev) => {
      setChatNotice(null)
      return prev === 'login' ? 'register' : 'login'
    })
  }

  return {
    authError,
    authIsAdmin,
    authLoading,
    authMode,
    authNickname,
    authNicknameInput,
    authPasswordInput,
    authToken,
    chatError,
    chatInputRef,
    chatLoading,
    chatMessages,
    chatNotice,
    chatScrollRef,
    clearAuth,
    cooldownRemaining,
    cooldownUntil,
    handleAuthSubmit,
    handleSendMessage,
    messageBody,
    redactMessagesByNickname,
    removeMessagesByNickname,
    replaceDeletedMessage,
    setAuthNicknameInput,
    setAuthPasswordInput,
    setChatError,
    setMessageBody,
    toggleAuthMode,
  }
}
