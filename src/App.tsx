import { useEffect, useRef, useState } from 'react'
import andromedaIcon from './assets/andromeda.png'
import { AdminConfirmModal } from './components/admin-confirm-modal'
import { AboutModal } from './components/about-modal'
import { ChatAuthForm } from './components/chat-auth-form'
import { ChatComposer } from './components/chat-composer'
import { ChatMessageList } from './components/chat-message-list'
import { AdminMenuModal } from './components/admin-menu-modal'
import { AdminMessageActionsModal } from './components/admin-message-actions-modal'
import { SchedulePanel } from './components/schedule-panel'
import { VideoPlayer } from './components/video-player'
import { useAdminControls } from './hooks/use-admin-controls'
import { useChat } from './hooks/use-chat'
import { useSchedule } from './hooks/use-schedule'
import { useVideoPlayer } from './hooks/use-video-player'

function App() {
  const [infoVisible, setInfoVisible] = useState(false)
  const [infoActive, setInfoActive] = useState(false)
  const infoCloseTimeoutRef = useRef<number | null>(null)
  const {
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
  } = useChat()
  const {
    adminConfirm,
    adminMenu,
    adminMessageActions,
    backToAdminMain,
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
  } = useAdminControls({
    authIsAdmin,
    authToken,
    onRedactMessagesByNickname: redactMessagesByNickname,
    onRemoveMessagesByNickname: removeMessagesByNickname,
    onReplaceDeletedMessage: replaceDeletedMessage,
    setChatError,
  })
  const {
    controlsVisible,
    handleFullscreen,
    handleToggleMute,
    handleVolumeChange,
    isMuted,
    scheduleHideControls,
    showControls,
    videoFrameRef,
    videoRef,
    volume,
  } = useVideoPlayer()
  const {
    expandedScheduleKey,
    schedule,
    syncScheduleTitleTooltip,
    toggleScheduleItem,
  } = useSchedule()

  const openInfo = () => {
    if (infoCloseTimeoutRef.current) {
      window.clearTimeout(infoCloseTimeoutRef.current)
      infoCloseTimeoutRef.current = null
    }

    setInfoVisible(true)
    setInfoActive(false)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setInfoActive(true)
      })
    })
  }

  const closeInfo = () => {
    setInfoActive(false)
    if (infoCloseTimeoutRef.current) {
      window.clearTimeout(infoCloseTimeoutRef.current)
    }
    infoCloseTimeoutRef.current = window.setTimeout(() => {
      setInfoVisible(false)
    }, 220)
  }

  useEffect(() => {
    if (!infoVisible) {
      return
    }

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeInfo()
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
    }
  }, [infoVisible])

  useEffect(() => {
    return () => {
      if (infoCloseTimeoutRef.current) {
        window.clearTimeout(infoCloseTimeoutRef.current)
      }
    }
  }, [])

  return (
    <div className="ui-body h-dvh w-full bg-[#050505] text-zinc-100">
      <div className="flex h-full w-full flex-col border border-zinc-800">
        <header className="flex h-12 items-center gap-3 border-b border-zinc-800 px-4 text-xs text-zinc-300">
          <img
            src={andromedaIcon}
            alt="andromeda"
            className="h-3.5 w-3.5 object-contain"
          />
          <span className="ui-header font-extrabold">andromeda</span>
          <button
            type="button"
            className="ml-auto inline-flex h-6 w-6 items-center justify-center text-zinc-500 transition hover:text-zinc-200 cursor-pointer"
            onClick={openInfo}
            aria-label="About andromeda"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 10v6" />
              <path d="M12 7h.01" />
            </svg>
          </button>
        </header>
        <div className="layout-shell flex min-h-0 flex-1 flex-col animate-[fadeIn_700ms_ease-out] motion-reduce:animate-none lg:grid lg:grid-cols-[auto_minmax(240px,1fr)]">
          <VideoPlayer
            controlsVisible={controlsVisible}
            isMuted={isMuted}
            onFullscreen={handleFullscreen}
            onMouseEnter={showControls}
            onMouseLeave={scheduleHideControls}
            onMouseMove={showControls}
            onToggleMute={handleToggleMute}
            onVolumeChange={handleVolumeChange}
            videoFrameRef={videoFrameRef}
            videoRef={videoRef}
            volume={volume}
          />

          <aside className="flex min-h-0 flex-1 flex-col border-t border-zinc-800 lg:border-l lg:border-t-0">
            <SchedulePanel
              expandedScheduleKey={expandedScheduleKey}
              onToggleItem={toggleScheduleItem}
              schedule={schedule}
              syncTitleTooltip={syncScheduleTitleTooltip}
            />

            <div className="flex min-h-0 flex-[2] flex-col border-t border-zinc-800">
              <header className="flex h-12 items-center border-b border-zinc-800 px-4 text-zinc-300">
                <span className="ui-header font-extrabold">chat</span>
                {authNickname && (
                  <span className="ml-auto text-zinc-500">
                    signed in as <span className="text-zinc-200">{authNickname}</span>
                  </span>
                )}
              </header>
              {authToken ? (
                <>
                  <div
                    ref={chatScrollRef}
                    className="scrollbar-minimal min-h-0 flex-1 overflow-y-auto"
                  >
                    <ChatMessageList
                      loading={chatLoading}
                      messages={chatMessages}
                      onAdminAction={
                        authIsAdmin ? openAdminMessageActions : undefined
                      }
                    />
                  </div>
                  <ChatComposer
                    authIsAdmin={authIsAdmin}
                    chatError={chatError}
                    chatLoading={chatLoading}
                    chatNotice={chatNotice}
                    cooldownRemaining={cooldownRemaining}
                    disabled={Boolean(cooldownUntil)}
                    messageBody={messageBody}
                    onMessageBodyChange={setMessageBody}
                    onOpenAdminMenu={openAdminMenu}
                    onSignOut={() => clearAuth()}
                    onSubmit={handleSendMessage}
                    textareaRef={chatInputRef}
                  />
                </>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div
                    ref={chatScrollRef}
                    className="scrollbar-minimal min-h-0 flex-1 overflow-y-auto"
                  >
                    <ChatMessageList
                      loading={chatLoading}
                      messages={chatMessages}
                      onAdminAction={
                        authIsAdmin ? openAdminMessageActions : undefined
                      }
                    />
                  </div>
                  <ChatAuthForm
                    authError={authError}
                    authLoading={authLoading}
                    authMode={authMode}
                    chatError={chatError}
                    chatLoading={chatLoading}
                    nickname={authNicknameInput}
                    onAuthModeToggle={toggleAuthMode}
                    onNicknameChange={setAuthNicknameInput}
                    onPasswordChange={setAuthPasswordInput}
                    onSubmit={handleAuthSubmit}
                    password={authPasswordInput}
                  />
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
      <AdminMenuModal
        active={adminMenu.active}
        onBack={() => void backToAdminMain()}
        onClose={closeAdminMenu}
        onOpenClearChatConfirm={openClearChatConfirm}
        onOpenUserView={(view) => void openAdminMenuView(view)}
        onSearchChange={setAdminUserSearch}
        onUserAction={handleAdminUserAction}
        search={adminMenu.userSearch}
        userList={adminMenu.userList}
        userLoading={adminMenu.userLoading}
        view={adminMenu.view}
        viewAnimating={adminMenu.viewAnimating}
        visible={adminMenu.visible}
      />
      <AdminMessageActionsModal
        active={adminMessageActions.active}
        onClose={closeAdminMessageActions}
        onSelectAction={selectAdminMessageAction}
        target={adminMessageActions.target}
        visible={adminMessageActions.visible}
      />
      <AdminConfirmModal
        active={adminConfirm.active}
        body={adminConfirm.body}
        onCancel={cancelAdminConfirm}
        onConfirm={() => void confirmAdminAction()}
        title={adminConfirm.title}
        visible={adminConfirm.visible}
      />
      <AboutModal
        active={infoActive}
        onClose={closeInfo}
        visible={infoVisible}
      />
    </div>
  )
}

export default App
