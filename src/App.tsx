import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import andromedaIcon from './assets/andromeda.png'
import { AboutModal } from './components/about-modal'
import { ChatAuthForm } from './components/chat-auth-form'
import { ChatComposer } from './components/chat-composer'
import { ChatMessageList } from './components/chat-message-list'
import { SchedulePanel } from './components/schedule-panel'
import { ServiceStatusBanner } from './components/service-status-banner'
import { VideoPlayer } from './components/video-player'
import { useAdminControls } from './hooks/use-admin-controls'
import { useChat } from './hooks/use-chat'
import { useSchedule } from './hooks/use-schedule'
import { useVideoPlayer } from './hooks/use-video-player'

const AdminOverlays = lazy(() => import('./components/admin-overlays'))

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
    handleAuthNicknameChange,
    handleAuthPasswordChange,
    handleMessageBodyChange,
    handleSendMessage,
    messageBody,
    messageSending,
    messageStatus,
    redactMessagesByNickname,
    removeMessagesByNickname,
    replaceDeletedMessage,
    retryChatConnection,
    setChatError,
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
    handleRetryPlayback,
    handleToggleMute,
    handleVolumeChange,
    isMuted,
    playbackState,
    playbackStatusDetail,
    scheduleHideControls,
    showControls,
    videoFrameRef,
    videoRef,
    volume,
  } = useVideoPlayer()
  const {
    expandedScheduleKey,
    retrySchedule,
    schedule,
    scheduleState,
    scheduleStatusDetail,
    syncScheduleTitleTooltip,
    toggleScheduleItem,
  } = useSchedule()
  const shouldRenderAdminOverlays =
    authIsAdmin ||
    adminMenu.visible ||
    adminMessageActions.visible ||
    adminConfirm.visible

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
            onRetryPlayback={handleRetryPlayback}
            onToggleMute={handleToggleMute}
            onVolumeChange={handleVolumeChange}
            playbackState={playbackState}
            playbackStatusDetail={playbackStatusDetail}
            videoFrameRef={videoFrameRef}
            videoRef={videoRef}
            volume={volume}
          />

          <aside className="flex min-h-0 flex-1 flex-col border-t border-zinc-800 lg:border-l lg:border-t-0">
            <SchedulePanel
              expandedScheduleKey={expandedScheduleKey}
              onToggleItem={toggleScheduleItem}
              onRetrySchedule={retrySchedule}
              schedule={schedule}
              scheduleState={scheduleState}
              scheduleStatusDetail={scheduleStatusDetail}
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
              {chatConnectionState !== 'live' && (
                <ServiceStatusBanner
                  detail={chatConnectionDetail}
                  label="chat status"
                  onRetry={
                    chatConnectionState === 'connecting'
                      ? undefined
                      : retryChatConnection
                  }
                  state={chatConnectionState}
                />
              )}
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
                    messageSending={messageSending}
                    messageStatus={messageStatus}
                    messageBody={messageBody}
                    onMessageBodyChange={handleMessageBodyChange}
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
                    onNicknameChange={handleAuthNicknameChange}
                    onPasswordChange={handleAuthPasswordChange}
                    onSubmit={handleAuthSubmit}
                    password={authPasswordInput}
                  />
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
      {shouldRenderAdminOverlays && (
        <Suspense fallback={null}>
          <AdminOverlays
            adminConfirm={adminConfirm}
            adminMenu={adminMenu}
            adminMessageActions={adminMessageActions}
            onBack={() => void backToAdminMain()}
            onCancelConfirm={cancelAdminConfirm}
            onCloseMenu={closeAdminMenu}
            onCloseMessageActions={closeAdminMessageActions}
            onConfirm={() => void confirmAdminAction()}
            onOpenClearChatConfirm={openClearChatConfirm}
            onOpenUserView={(view) => void openAdminMenuView(view)}
            onSearchChange={setAdminUserSearch}
            onSelectAction={selectAdminMessageAction}
            onUserAction={handleAdminUserAction}
          />
        </Suspense>
      )}
      <AboutModal
        active={infoActive}
        onClose={closeInfo}
        visible={infoVisible}
      />
    </div>
  )
}

export default App
