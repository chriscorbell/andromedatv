import { lazy, Suspense } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleInfo, faShield } from '@fortawesome/free-solid-svg-icons'
import andromedaIcon from './assets/andromeda.png'
import { AboutModal } from './components/about-modal'
import { ChatAuthForm } from './components/chat-auth-form'
import { ChatComposer } from './components/chat-composer'
import { ChatMessageList } from './components/chat-message-list'
import { SchedulePanel } from './components/schedule-panel'
import { ServiceStatusBanner } from './components/service-status-banner'
import { VideoPlayer } from './components/video-player'
import { useAdminControls } from './hooks/use-admin-controls'
import { useAboutModal } from './hooks/use-about-modal'
import { useChat } from './hooks/use-chat'
import { useSchedule } from './hooks/use-schedule'
import { useVideoPlayer } from './hooks/use-video-player'

const AdminOverlays = lazy(() => import('./components/admin-overlays'))

function MainApp() {
  const { closeInfo, infoActive, infoVisible, openInfo } = useAboutModal()
  const {
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
    setChatError,
    toggleAuthMode,
  } = useChat()
  const {
    adminConfirm,
    adminMenu,
    adminMessageActions,
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
    getStreamDate,
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

  return (
    <div className="ui-body h-dvh w-full bg-black text-[var(--color-app-fg)]">
      <div className="stage flex h-full w-full overflow-hidden">
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

        <aside className="sidebar flex min-h-0 min-w-[340px] flex-1 flex-col border-l border-[var(--color-edge)] animate-[fadeIn_700ms_ease-out] motion-reduce:animate-none">
          <header className="topbar flex h-[60px] shrink-0 items-center gap-3 px-5">
            <img
              src={andromedaIcon}
              alt="Andromeda"
              className="h-3.5 w-3.5 object-contain"
            />
            <span className="brand">Andromeda</span>
            <div className="ml-auto flex items-center gap-1">
              {authIsAdmin && authSessionActive && (
                <button
                  type="button"
                  className="info-btn inline-flex h-7 w-7 items-center justify-center cursor-pointer"
                  onClick={openAdminMenu}
                  aria-label="Open admin menu"
                >
                  <FontAwesomeIcon icon={faShield} className="text-[15px]" />
                </button>
              )}
              <button
                type="button"
                className="info-btn inline-flex h-7 w-7 items-center justify-center cursor-pointer"
                onClick={openInfo}
                aria-label="About Andromeda"
              >
                <FontAwesomeIcon icon={faCircleInfo} className="text-[17px]" />
              </button>
            </div>
          </header>

          <SchedulePanel
            expandedScheduleKey={expandedScheduleKey}
            getStreamDate={getStreamDate}
            onToggleItem={toggleScheduleItem}
            schedule={schedule}
            scheduleState={scheduleState}
            scheduleStatusDetail={scheduleStatusDetail}
            syncTitleTooltip={syncScheduleTitleTooltip}
          />

          <div className="flex min-h-0 flex-1 flex-col border-t border-[var(--color-edge)]">
            <div className="sec-head px-5 pt-3.5 pb-2">
              <span>chat</span>
            </div>
            {chatConnectionState !== 'live' && (
                <ServiceStatusBanner
                  detail={chatConnectionDetail}
                  label="Chat"
                  state={chatConnectionState}
                />
              )}
              {authSessionActive ? (
                <>
                  <div
                    ref={chatScrollRef}
                    className="chat-fade scrollbar-minimal min-h-0 flex-1 overflow-y-auto"
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
                    authNickname={authNickname}
                    chatError={chatError}
                    chatLoading={chatLoading}
                    chatNotice={chatNotice}
                    cooldownRemaining={cooldownRemaining}
                    disabled={Boolean(cooldownUntil)}
                    messageSending={messageSending}
                    messageStatus={messageStatus}
                    messageBody={messageBody}
                    onMessageBodyChange={handleMessageBodyChange}
                    onSignOut={() => clearAuth()}
                    onSubmit={handleSendMessage}
                    textareaRef={chatInputRef}
                  />
                </>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div
                    ref={chatScrollRef}
                    className="chat-fade scrollbar-minimal min-h-0 flex-1 overflow-y-auto"
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
      {shouldRenderAdminOverlays && (
        <Suspense fallback={null}>
          <AdminOverlays
            adminConfirm={adminConfirm}
            adminMenu={adminMenu}
            adminMessageActions={adminMessageActions}
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

export default MainApp
