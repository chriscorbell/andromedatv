import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  api,
  type ChatAuthPayload,
  type ChatMessage,
  type ChatMessagesPayload,
  type ChatMutationErrorPayload,
  type ChatPublicMessagesPayload,
} from '../lib/api'

const CHAT_STORAGE_KEY = 'andromeda-chat-auth'
type ChatConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline'

export function useChat() {
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null)
  const chatStreamRef = useRef<EventSource | null>(null)
  const messageStatusTimeoutRef = useRef<number | null>(null)
  const chatConnectionFailuresRef = useRef(0)
  const chatConnectedOnceRef = useRef(false)
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
  const [messageSending, setMessageSending] = useState(false)
  const [messageStatus, setMessageStatus] = useState<string | null>(null)
  const [chatConnectionState, setChatConnectionState] =
    useState<ChatConnectionState>('connecting')
  const [chatConnectionDetail, setChatConnectionDetail] = useState(
    'Connecting to public chat...',
  )
  const [connectionRetryKey, setConnectionRetryKey] = useState(0)

  const setChatConnectionStatus = (
    nextState: ChatConnectionState,
    detail: string,
  ) => {
    setChatConnectionState((current) =>
      current === nextState ? current : nextState,
    )
    setChatConnectionDetail((current) => (current === detail ? current : detail))
  }

  const markChatRecovering = (detail: string) => {
    setChatConnectionStatus(
      chatConnectedOnceRef.current ? 'reconnecting' : 'connecting',
      detail,
    )
  }

  const markChatLive = (detail: string) => {
    chatConnectionFailuresRef.current = 0
    chatConnectedOnceRef.current = true
    setChatConnectionStatus('live', detail)
  }

  const markChatOffline = (detail: string) => {
    setChatConnectionStatus('offline', detail)
  }

  const clearAuth = (notifyServer = true) => {
    setAuthToken(null)
    setAuthNickname(null)
    setAuthIsAdmin(false)
    setAuthNicknameInput('')
    setAuthPasswordInput('')
    setAuthError(null)
    setChatNotice(null)
    setMessageStatus(null)
    if (chatStreamRef.current) {
      chatStreamRef.current.close()
      chatStreamRef.current = null
    }
    window.localStorage.removeItem(CHAT_STORAGE_KEY)
    if (notifyServer) {
      void api.chat.logout().catch((error) => {
        console.warn('Failed to clear chat session cookie', error)
      })
    }
  }

  const clearMessageStatusSoon = () => {
    if (messageStatusTimeoutRef.current) {
      window.clearTimeout(messageStatusTimeoutRef.current)
    }
    messageStatusTimeoutRef.current = window.setTimeout(() => {
      setMessageStatus(null)
      messageStatusTimeoutRef.current = null
    }, 2400)
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
      markChatLive(
        options.includePrivateEvents
          ? 'Signed-in chat is live.'
          : 'Public chat is live.',
      )
    })

    stream.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data) as ChatMessage
        appendChatMessage(message)
        markChatLive(
          options.includePrivateEvents
            ? 'Signed-in chat is live.'
            : 'Public chat is live.',
        )
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
      chatConnectionFailuresRef.current += 1
      if (chatConnectionFailuresRef.current >= 3) {
        markChatOffline('Chat is unavailable right now. Retrying automatically...')
        return
      }

      markChatRecovering('Chat connection lost. Reconnecting...')
    })
  })

  const fetchMessages = useEffectEvent(async () => {
    if (!authToken) {
      return false
    }

    setChatLoading(true)
    markChatRecovering(
      chatConnectedOnceRef.current
        ? 'Reconnecting to signed-in chat...'
        : 'Connecting to signed-in chat...',
    )

    try {
      const { data, response } = await api.chat.getMessages(authToken)

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

      const payload = data as ChatMessagesPayload
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
      markChatOffline(
        'Unable to load signed-in chat right now. Retrying automatically...',
      )
      return false
    } finally {
      setChatLoading(false)
    }
  })

  const fetchPublicMessages = useEffectEvent(async () => {
    setChatLoading(true)
    markChatRecovering(
      chatConnectedOnceRef.current
        ? 'Reconnecting to public chat...'
        : 'Connecting to public chat...',
    )

    try {
      const { data, response } = await api.chat.getPublicMessages()
      if (!response.ok) {
        throw new Error('Failed to load public messages')
      }

      const payload = data as ChatPublicMessagesPayload
      setChatMessages(payload.messages)
    } catch (error) {
      console.warn('Failed to load public chat messages', error)
      markChatOffline(
        'Unable to load public chat right now. Retrying automatically...',
      )
    } finally {
      setChatLoading(false)
    }
  })

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
      if (chatConnectedOnceRef.current) {
        setChatConnectionState('reconnecting')
        setChatConnectionDetail('Returning to public chat...')
      } else {
        setChatConnectionState('connecting')
        setChatConnectionDetail('Connecting to public chat...')
      }
      void fetchPublicMessages()
      const publicStream = new EventSource(api.chat.publicStreamUrl())
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

    if (chatConnectedOnceRef.current) {
      setChatConnectionState('reconnecting')
      setChatConnectionDetail('Reconnecting to signed-in chat...')
    } else {
      setChatConnectionState('connecting')
      setChatConnectionDetail('Connecting to signed-in chat...')
    }

    void (async () => {
      const canConnect = await fetchMessages()
      if (!canConnect || disposed) {
        return
      }

      stream = new EventSource(api.chat.privateStreamUrl())
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
  }, [authNickname, authToken, connectionRetryKey])

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

  useEffect(() => {
    return () => {
      if (messageStatusTimeoutRef.current) {
        window.clearTimeout(messageStatusTimeoutRef.current)
      }
    }
  }, [])

  const handleAuthSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAuthError(null)
    setAuthLoading(true)

    try {
      const { data: payload, response } = await api.chat.submitAuth(
        authMode,
        authNicknameInput.trim(),
        authPasswordInput,
      )
      const parsedPayload = payload as ChatAuthPayload

      if (!response.ok || !parsedPayload.token || !parsedPayload.nickname) {
        setAuthError(parsedPayload.error || 'Unable to sign in. Check your details.')
        return
      }

      setAuthToken(parsedPayload.token)
      setAuthNickname(parsedPayload.nickname)
      setAuthIsAdmin(Boolean(parsedPayload.isAdmin))
      setAuthPasswordInput('')
      setMessageBody('')
      setChatNotice(null)
      setMessageStatus(null)
      window.localStorage.setItem(
        CHAT_STORAGE_KEY,
        JSON.stringify({
          nickname: parsedPayload.nickname,
          token: parsedPayload.token,
          isAdmin: Boolean(parsedPayload.isAdmin),
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
    setMessageStatus('Sending message...')
    setMessageSending(true)
    if (messageStatusTimeoutRef.current) {
      window.clearTimeout(messageStatusTimeoutRef.current)
      messageStatusTimeoutRef.current = null
    }

    try {
      const { data: payload, response } = await api.chat.sendMessage(
        authToken,
        trimmed,
      )

      if (response.status === 401) {
        clearAuth()
        return
      }

      const parsedPayload = payload as ChatMutationErrorPayload

      if (!response.ok) {
        if (response.status === 403) {
          clearAuth()
          setChatError(parsedPayload.error || 'your account has been banned')
          setMessageStatus(null)
          return
        }
        if (response.status === 429 && parsedPayload.cooldownSeconds) {
          setCooldownUntil(Date.now() + parsedPayload.cooldownSeconds * 1000)
          setChatError(parsedPayload.error || "slow down, don't spam!")
          setMessageStatus(null)
          return
        }
        setChatError(parsedPayload.error || 'Message failed to send.')
        setMessageStatus(null)
        return
      }

      setMessageBody('')
      setMessageStatus('Message sent.')
      clearMessageStatusSoon()
    } catch (error) {
      console.warn('Failed to send chat message', error)
      setChatError('Message failed to send.')
      setMessageStatus(null)
    } finally {
      setMessageSending(false)
    }
  }

  const toggleAuthMode = () => {
    setAuthMode((prev) => {
      setAuthError(null)
      setChatNotice(null)
      return prev === 'login' ? 'register' : 'login'
    })
  }

  const handleAuthNicknameChange = (value: string) => {
    setAuthNicknameInput(value)
    if (authError) {
      setAuthError(null)
    }
  }

  const handleAuthPasswordChange = (value: string) => {
    setAuthPasswordInput(value)
    if (authError) {
      setAuthError(null)
    }
  }

  const handleMessageBodyChange = (value: string) => {
    setMessageBody(value)
    if (chatError) {
      setChatError(null)
    }
    if (messageStatus === 'Message sent.') {
      setMessageStatus(null)
      if (messageStatusTimeoutRef.current) {
        window.clearTimeout(messageStatusTimeoutRef.current)
        messageStatusTimeoutRef.current = null
      }
    }
  }

  const retryChatConnection = () => {
    chatConnectionFailuresRef.current = 0
    if (chatStreamRef.current) {
      chatStreamRef.current.close()
      chatStreamRef.current = null
    }

    if (authToken) {
      markChatRecovering('Retrying signed-in chat...')
    } else {
      markChatRecovering('Retrying public chat...')
    }

    setConnectionRetryKey((prev) => prev + 1)
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
    chatConnectionDetail,
    chatConnectionState,
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
    messageSending,
    messageStatus,
    redactMessagesByNickname,
    removeMessagesByNickname,
    replaceDeletedMessage,
    retryChatConnection,
    setAuthError,
    setChatError,
    handleAuthNicknameChange,
    handleAuthPasswordChange,
    handleMessageBodyChange,
    toggleAuthMode,
  }
}
