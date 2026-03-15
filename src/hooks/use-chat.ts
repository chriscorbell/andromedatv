import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react'
import {
  api,
  type ChatAuthPayload,
  type ChatMessage,
  type ChatMessagesPayload,
  type ChatMutationErrorPayload,
  type ChatPublicMessagesPayload,
} from '../lib/api'

type ChatConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline'
type SessionFetchResult = 'authenticated' | 'banned' | 'guest' | 'failed'

function setConnectionStatus(
  setChatConnectionState: Dispatch<SetStateAction<ChatConnectionState>>,
  setChatConnectionDetail: Dispatch<SetStateAction<string>>,
  nextState: ChatConnectionState,
  detail: string,
) {
  setChatConnectionState((current) =>
    current === nextState ? current : nextState,
  )
  setChatConnectionDetail((current) => (current === detail ? current : detail))
}

export function useChat() {
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null)
  const chatStreamRef = useRef<EventSource | null>(null)
  const messageStatusTimeoutRef = useRef<number | null>(null)
  const chatConnectionFailuresRef = useRef(0)
  const chatConnectedOnceRef = useRef(false)
  const viewerNicknameRef = useRef<string | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authSessionActive, setAuthSessionActive] = useState(false)
  const [hasHydratedSession, setHasHydratedSession] = useState(false)
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

  const applyChatConnectionStatus = (
    nextState: ChatConnectionState,
    detail: string,
  ) => {
    setConnectionStatus(
      setChatConnectionState,
      setChatConnectionDetail,
      nextState,
      detail,
    )
  }

  const markChatRecovering = (detail: string) => {
    applyChatConnectionStatus(
      chatConnectedOnceRef.current ? 'reconnecting' : 'connecting',
      detail,
    )
  }

  const markChatLive = (detail: string) => {
    chatConnectionFailuresRef.current = 0
    chatConnectedOnceRef.current = true
    applyChatConnectionStatus('live', detail)
  }

  const markChatOffline = (detail: string) => {
    applyChatConnectionStatus('offline', detail)
  }

  const closeChatStream = () => {
    if (chatStreamRef.current) {
      chatStreamRef.current.close()
      chatStreamRef.current = null
    }
  }

  const clearAuthenticatedState = (preserveMessages = true) => {
    setAuthSessionActive(false)
    setAuthNickname(null)
    setAuthIsAdmin(false)
    viewerNicknameRef.current = null
    setChatNotice(null)
    setMessageStatus(null)
    if (!preserveMessages) {
      setChatMessages([])
    }
  }

  const clearAuth = (notifyServer = true) => {
    clearAuthenticatedState()
    setHasHydratedSession(true)
    setAuthNicknameInput('')
    setAuthPasswordInput('')
    setAuthError(null)
    closeChatStream()
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

  const applyAuthenticatedPayload = (payload: ChatMessagesPayload) => {
    setChatMessages(Array.isArray(payload.messages) ? payload.messages : [])
    if (payload.user) {
      setAuthSessionActive(true)
      setAuthNickname(payload.user.nickname)
      setAuthIsAdmin(payload.user.isAdmin)
      viewerNicknameRef.current = payload.user.nickname
    }
  }

  const fetchAuthenticatedMessages = useEffectEvent(async (
    mode: 'bootstrap' | 'authenticated',
  ): Promise<SessionFetchResult> => {
    setChatLoading(true)
    markChatRecovering(
      mode === 'bootstrap'
        ? 'Checking your chat session...'
        : chatConnectedOnceRef.current
          ? 'Reconnecting to signed-in chat...'
          : 'Connecting to signed-in chat...',
    )

    try {
      const { data, response } = await api.chat.getMessages()

      if (response.status === 401) {
        clearAuthenticatedState()
        return 'guest'
      }

      if (response.status === 403) {
        clearAuthenticatedState()
        setChatError('your account has been banned')
        return 'banned'
      }

      if (!response.ok) {
        throw new Error('Failed to load messages')
      }

      applyAuthenticatedPayload(data as ChatMessagesPayload)
      return 'authenticated'
    } catch (error) {
      console.warn('Failed to load chat messages', error)
      markChatOffline(
        mode === 'bootstrap'
          ? 'Unable to check your chat session right now. Retrying automatically...'
          : 'Unable to load signed-in chat right now. Retrying automatically...',
      )
      return 'failed'
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
      setChatMessages(Array.isArray(payload.messages) ? payload.messages : [])
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
    let disposed = false
    let stream: EventSource | null = null

    const connectPublicStream = async () => {
      if (chatConnectedOnceRef.current) {
        applyChatConnectionStatus('reconnecting', 'Returning to public chat...')
      } else {
        applyChatConnectionStatus('connecting', 'Connecting to public chat...')
      }

      await fetchPublicMessages()
      if (disposed) {
        return
      }

      stream = new EventSource(api.chat.publicStreamUrl())
      chatStreamRef.current = stream
      attachChatStreamHandlers(stream, {
        includePrivateEvents: false,
        viewerNickname: null,
      })
    }

    const connectPrivateStream = async (mode: 'bootstrap' | 'authenticated') => {
      const result = await fetchAuthenticatedMessages(mode)
      if (disposed) {
        return
      }

      if (result === 'authenticated') {
        stream = new EventSource(api.chat.privateStreamUrl())
        chatStreamRef.current = stream
        attachChatStreamHandlers(stream, {
          includePrivateEvents: true,
          viewerNickname: viewerNicknameRef.current,
        })
        return
      }

      if (mode === 'bootstrap') {
        setHasHydratedSession(true)
      }

      if (result === 'guest' || result === 'banned') {
        await connectPublicStream()
      }
    }

    closeChatStream()

    if (authSessionActive) {
      if (chatConnectedOnceRef.current) {
        applyChatConnectionStatus('reconnecting', 'Reconnecting to signed-in chat...')
      } else {
        applyChatConnectionStatus('connecting', 'Connecting to signed-in chat...')
      }
      void connectPrivateStream('authenticated')
    } else if (!hasHydratedSession) {
      applyChatConnectionStatus('connecting', 'Checking your chat session...')
      void connectPrivateStream('bootstrap')
    } else {
      void connectPublicStream()
    }

    return () => {
      disposed = true
      stream?.close()
      if (stream && chatStreamRef.current === stream) {
        chatStreamRef.current = null
      }
    }
  }, [
    authSessionActive,
    connectionRetryKey,
    hasHydratedSession,
  ])

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

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
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

      if (!response.ok || !parsedPayload.nickname) {
        setAuthError(parsedPayload.error || 'Unable to sign in. Check your details.')
        return
      }

      setAuthSessionActive(true)
      setHasHydratedSession(true)
      setAuthNickname(parsedPayload.nickname)
      setAuthIsAdmin(Boolean(parsedPayload.isAdmin))
      viewerNicknameRef.current = parsedPayload.nickname
      setAuthPasswordInput('')
      setMessageBody('')
      setChatNotice(null)
      setChatError(null)
      setMessageStatus(null)
    } catch (error) {
      console.warn('Auth failed', error)
      setAuthError('Unable to sign in. Try again in a moment.')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleSendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!authSessionActive) {
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
      const { data: payload, response } = await api.chat.sendMessage(trimmed)

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
    closeChatStream()

    if (authSessionActive) {
      markChatRecovering('Retrying signed-in chat...')
    } else if (!hasHydratedSession) {
      markChatRecovering('Retrying chat session check...')
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
    authSessionActive,
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
    handleAuthNicknameChange,
    handleAuthPasswordChange,
    handleAuthSubmit,
    handleMessageBodyChange,
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
    toggleAuthMode,
  }
}
