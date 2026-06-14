import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type {
  AdminAction,
  AdminConfirmReturnView,
  AdminMenuView,
  AdminMessageActionTarget,
  AdminUserLists,
  AdminUserLoading,
} from '../types/admin'

type UseAdminControlsOptions = {
  authIsAdmin: boolean
  onRedactMessagesByNickname: (nickname: string) => void
  onRemoveMessagesByNickname: (nickname: string) => void
  onReplaceDeletedMessage: (messageId: number) => void
  setChatError: (value: string | null) => void
}

const emptyUserLists: AdminUserLists = {
  active: [],
  banned: [],
}

const emptyUserLoading: AdminUserLoading = {
  active: false,
  banned: false,
}

const getAdminConfirmCopy = (action: AdminAction | null) => {
  if (!action) {
    return { body: '', title: '' }
  }

  if (action.kind === 'clear') {
    return {
      title: 'clear chat history?',
      body: 'this removes all messages, including system logs.',
    }
  }

  if (action.kind === 'delete') {
    return {
      title: 'delete this message?',
      body: 'the message will be replaced with "message deleted".',
    }
  }

  if (action.kind === 'warn') {
    return {
      title: 'delete and warn this user?',
      body: 'the message will be deleted and the user will be warned.',
    }
  }

  if (action.kind === 'ban') {
    return {
      title: `ban ${action.nickname}?`,
      body: 'the user will be banned and their messages will be redacted.',
    }
  }

  if (action.kind === 'unban') {
    return {
      title: `unban ${action.nickname}?`,
      body: 'the user will be able to log in and chat again.',
    }
  }

  return {
    title: `delete user ${action.nickname}?`,
    body: 'the user account and all their messages will be permanently deleted.',
  }
}

export function useAdminControls({
  authIsAdmin,
  onRedactMessagesByNickname,
  onRemoveMessagesByNickname,
  onReplaceDeletedMessage,
  setChatError,
}: UseAdminControlsOptions) {
  const [adminAction, setAdminAction] = useState<AdminAction | null>(null)
  const [adminMessageActionTarget, setAdminMessageActionTarget] =
    useState<AdminMessageActionTarget | null>(null)
  const [adminConfirmReturnView, setAdminConfirmReturnView] =
    useState<AdminConfirmReturnView>(null)
  const [adminConfirmRestoreOnClose, setAdminConfirmRestoreOnClose] =
    useState(false)
  const [adminConfirmOpen, setAdminConfirmOpen] = useState(false)
  const [adminConfirmVisible, setAdminConfirmVisible] = useState(false)
  const [adminConfirmActive, setAdminConfirmActive] = useState(false)
  const adminConfirmTimeoutRef = useRef<number | null>(null)
  const [adminMessageActionsOpen, setAdminMessageActionsOpen] = useState(false)
  const [adminMessageActionsVisible, setAdminMessageActionsVisible] =
    useState(false)
  const [adminMessageActionsActive, setAdminMessageActionsActive] =
    useState(false)
  const adminMessageActionsTimeoutRef = useRef<number | null>(null)
  const [adminMenuOpen, setAdminMenuOpen] = useState(false)
  const [adminMenuVisible, setAdminMenuVisible] = useState(false)
  const [adminMenuActive, setAdminMenuActive] = useState(false)
  const adminMenuTimeoutRef = useRef<number | null>(null)
  const [adminMenuView, setAdminMenuView] = useState<AdminMenuView>('active')
  const [adminMenuViewAnimating, setAdminMenuViewAnimating] = useState(false)
  const [adminUserLists, setAdminUserLists] =
    useState<AdminUserLists>(emptyUserLists)
  const [adminUserSearch, setAdminUserSearch] = useState('')
  const [adminUserLoading, setAdminUserLoading] =
    useState<AdminUserLoading>(emptyUserLoading)

  const fetchAdminUsers = useCallback(async (view: 'active' | 'banned') => {
    if (!authIsAdmin) {
      setAdminMenuOpen(false)
      setChatError('Admin authorization required.')
      return
    }

    setAdminUserLoading((current) => ({ ...current, [view]: true }))
    try {
      const endpoint = view === 'active' ? 'active' : 'banned'
      const { data, response } = await api.admin.getUsers(endpoint)

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setChatError('Admin authorization failed.')
          setAdminMenuOpen(false)
          return
        }
        setChatError('Failed to load user list.')
        return
      }

      setAdminUserLists((current) => ({
        ...current,
        [view]: data.users,
      }))
    } catch (error) {
      console.warn('Failed to fetch admin users', error)
      setChatError('Failed to load user list.')
    } finally {
      setAdminUserLoading((current) => ({ ...current, [view]: false }))
    }
  }, [authIsAdmin, setChatError])

  const fetchAllAdminUsers = useCallback(async () => {
    await Promise.all([
      fetchAdminUsers('active'),
      fetchAdminUsers('banned'),
    ])
  }, [fetchAdminUsers])

  const openAdminConfirm = useCallback((
    action: AdminAction,
    returnView: AdminConfirmReturnView = null,
  ) => {
    if (!authIsAdmin) {
      return
    }

    setAdminAction(action)
    setAdminConfirmReturnView(returnView)
    setAdminConfirmRestoreOnClose(false)
    setAdminConfirmOpen(true)
  }, [authIsAdmin])

  const performAdminAction = useCallback(async (action: AdminAction) => {
    if (!authIsAdmin) {
      setChatError('Admin authorization required.')
      return
    }

    try {
      if (action.kind === 'clear') {
        const { response } = await api.admin.clear()

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            setChatError('Admin authorization failed.')
            return
          }
          setChatError('Failed to clear chat history.')
          return
        }

        setChatError(null)
        return
      }

      if (action.kind === 'delete') {
        const { response } = await api.admin.deleteMessage(action.messageId)

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            setChatError('Admin authorization failed.')
            return
          }
          setChatError('Failed to delete message.')
          return
        }

        onReplaceDeletedMessage(action.messageId)
        setChatError(null)
        return
      }

      if (action.kind === 'warn') {
        const { response } = await api.admin.warnUser(action.messageId)

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            setChatError('Admin authorization failed.')
            return
          }
          setChatError('Failed to warn user.')
          return
        }

        onReplaceDeletedMessage(action.messageId)
        setChatError(null)
        return
      }

      if (action.kind === 'ban') {
        const { response } = await api.admin.banUser(action.nickname)

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            setChatError('Admin authorization failed.')
            return
          }
          setChatError('Failed to ban user.')
          return
        }

        onRedactMessagesByNickname(action.nickname)
        setChatError(null)
        return
      }

      if (action.kind === 'unban') {
        const { response } = await api.admin.unbanUser(action.nickname)

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            setChatError('Admin authorization failed.')
            return
          }
          setChatError('Failed to unban user.')
          return
        }

        setChatError(null)
        return
      }

      const { response } = await api.admin.deleteUser(action.nickname)

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setChatError('Admin authorization failed.')
          return
        }
        setChatError('Failed to delete user.')
        return
      }

      onRemoveMessagesByNickname(action.nickname)
      setChatError(null)
    } catch (error) {
      console.warn('Failed to run admin action', error)
      setChatError('Admin action failed.')
    }
  }, [
    authIsAdmin,
    onRedactMessagesByNickname,
    onRemoveMessagesByNickname,
    onReplaceDeletedMessage,
    setChatError,
  ])

  const restoreAdminView = useCallback(() => {
    const returnView = adminConfirmRestoreOnClose ? adminConfirmReturnView : null
    setAdminAction(null)
    setAdminConfirmReturnView(null)
    setAdminConfirmRestoreOnClose(false)

    if (!returnView) {
      return
    }

    if (returnView === 'message-actions') {
      if (adminMessageActionTarget) {
        setAdminMessageActionsOpen(true)
      }
      return
    }

    setAdminMenuView(returnView)
    setAdminMenuOpen(true)
    void fetchAllAdminUsers()
  }, [
    adminConfirmRestoreOnClose,
    adminConfirmReturnView,
    adminMessageActionTarget,
    fetchAllAdminUsers,
  ])

  const confirmAdminAction = useCallback(async () => {
    setAdminConfirmRestoreOnClose(
      adminConfirmReturnView !== null &&
        adminConfirmReturnView !== 'message-actions',
    )
    setAdminConfirmOpen(false)
    if (!adminAction) {
      return
    }

    await performAdminAction(adminAction)
  }, [adminAction, adminConfirmReturnView, performAdminAction])

  const cancelAdminConfirm = useCallback(() => {
    setAdminConfirmRestoreOnClose(adminConfirmReturnView !== null)
    setAdminConfirmOpen(false)
  }, [adminConfirmReturnView])

  const closeAdminMessageActions = useCallback(() => {
    setAdminMessageActionsOpen(false)
  }, [])

  const closeAdminMenu = useCallback(() => {
    setAdminMenuOpen(false)
  }, [])

  const openAdminMenu = useCallback(() => {
    if (!authIsAdmin) {
      return
    }

    setAdminMenuView('active')
    setAdminUserSearch('')
    setAdminMenuOpen(true)
    void fetchAllAdminUsers()
  }, [authIsAdmin, fetchAllAdminUsers])

  const openAdminMessageActions = useCallback((messageId: number, nickname: string) => {
    if (!authIsAdmin) {
      return
    }

    setAdminMessageActionTarget({ messageId, nickname })
    setAdminMessageActionsOpen(true)
  }, [authIsAdmin])

  const selectAdminMessageAction = useCallback((
    action: Extract<AdminAction, { kind: 'delete' | 'warn' | 'ban' }>,
  ) => {
    openAdminConfirm(action, 'message-actions')
    setAdminMessageActionsOpen(false)
  }, [openAdminConfirm])

  const openAdminMenuView = useCallback((view: 'active' | 'banned') => {
    setAdminUserSearch('')
    setAdminMenuViewAnimating(true)
    setAdminMenuView(view)
    window.requestAnimationFrame(() => {
      setAdminMenuViewAnimating(false)
    })
  }, [])

  const handleAdminUserAction = useCallback((action: AdminAction) => {
    openAdminConfirm(action, adminMenuView)
    setAdminMenuOpen(false)
  }, [adminMenuView, openAdminConfirm])

  const openClearChatConfirm = useCallback(() => {
    openAdminConfirm({ kind: 'clear' }, adminMenuView)
    setAdminMenuOpen(false)
  }, [adminMenuView, openAdminConfirm])

  useEffect(() => {
    if (adminConfirmTimeoutRef.current) {
      window.clearTimeout(adminConfirmTimeoutRef.current)
      adminConfirmTimeoutRef.current = null
    }

    if (adminConfirmOpen) {
      setAdminConfirmVisible(true)
      setAdminConfirmActive(false)
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setAdminConfirmActive(true)
        })
      })
      return
    }

    if (adminConfirmVisible) {
      setAdminConfirmActive(false)
      adminConfirmTimeoutRef.current = window.setTimeout(() => {
        setAdminConfirmVisible(false)
        restoreAdminView()
      }, 200)
    }
  }, [adminConfirmOpen, adminConfirmVisible, restoreAdminView])

  useEffect(() => {
    if (adminMessageActionsTimeoutRef.current) {
      window.clearTimeout(adminMessageActionsTimeoutRef.current)
      adminMessageActionsTimeoutRef.current = null
    }

    if (adminMessageActionsOpen) {
      setAdminMessageActionsVisible(true)
      setAdminMessageActionsActive(false)
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setAdminMessageActionsActive(true)
        })
      })
      return
    }

    if (adminMessageActionsVisible) {
      setAdminMessageActionsActive(false)
      adminMessageActionsTimeoutRef.current = window.setTimeout(() => {
        setAdminMessageActionsVisible(false)
      }, 200)
    }
  }, [adminMessageActionsOpen, adminMessageActionsVisible])

  useEffect(() => {
    if (adminMenuTimeoutRef.current) {
      window.clearTimeout(adminMenuTimeoutRef.current)
      adminMenuTimeoutRef.current = null
    }

    if (adminMenuOpen) {
      setAdminMenuVisible(true)
      setAdminMenuActive(false)
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setAdminMenuActive(true)
        })
      })
      return
    }

    if (adminMenuVisible) {
      setAdminMenuActive(false)
      adminMenuTimeoutRef.current = window.setTimeout(() => {
        setAdminMenuVisible(false)
        setAdminMenuView('active')
        setAdminUserLists(emptyUserLists)
        setAdminUserLoading(emptyUserLoading)
        setAdminUserSearch('')
      }, 200)
    }
  }, [adminMenuOpen, adminMenuVisible])

  const handleOverlayKey = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      if (adminConfirmOpen) {
        cancelAdminConfirm()
      }
      if (adminMenuOpen) {
        closeAdminMenu()
      }
      if (adminMessageActionsOpen) {
        closeAdminMessageActions()
      }
      return
    }

    if (event.key === 'Enter' && adminConfirmOpen) {
      void confirmAdminAction()
    }
  }, [
    adminConfirmOpen,
    adminMenuOpen,
    adminMessageActionsOpen,
    cancelAdminConfirm,
    closeAdminMenu,
    closeAdminMessageActions,
    confirmAdminAction,
  ])

  useEffect(() => {
    if (!adminConfirmOpen && !adminMenuOpen && !adminMessageActionsOpen) {
      return
    }

    const handleKey = (event: KeyboardEvent) => {
      handleOverlayKey(event)
    }

    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
    }
  }, [adminConfirmOpen, adminMenuOpen, adminMessageActionsOpen, handleOverlayKey])

  useEffect(() => {
    return () => {
      if (adminConfirmTimeoutRef.current) {
        window.clearTimeout(adminConfirmTimeoutRef.current)
      }
      if (adminMessageActionsTimeoutRef.current) {
        window.clearTimeout(adminMessageActionsTimeoutRef.current)
      }
      if (adminMenuTimeoutRef.current) {
        window.clearTimeout(adminMenuTimeoutRef.current)
      }
    }
  }, [])

  const adminConfirmCopy = getAdminConfirmCopy(adminAction)

  return {
    adminConfirm: {
      active: adminConfirmActive,
      body: adminConfirmCopy.body,
      tone: adminAction?.kind === 'unban' ? 'accent' as const : 'danger' as const,
      title: adminConfirmCopy.title,
      visible: adminConfirmVisible,
    },
    adminMenu: {
      active: adminMenuActive,
      userLists: adminUserLists,
      userLoading: adminUserLoading,
      userSearch: adminUserSearch,
      view: adminMenuView,
      viewAnimating: adminMenuViewAnimating,
      visible: adminMenuVisible,
    },
    adminMessageActions: {
      active: adminMessageActionsActive,
      target: adminMessageActionTarget,
      visible: adminMessageActionsVisible,
    },
    cancelAdminConfirm,
    closeAdminMenu,
    closeAdminMessageActions,
    confirmAdminAction,
    handleAdminUserAction,
    openAdminMenu,
    openAdminMenuView,
    openAdminMessageActions,
    openClearChatConfirm,
    selectAdminMessageAction,
    setAdminUserSearch,
  }
}
