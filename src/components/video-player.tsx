import { useEffect, useState } from 'react'
import type { ChangeEventHandler, RefObject } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faExpand,
  faVolumeHigh,
  faVolumeXmark,
} from '@fortawesome/free-solid-svg-icons'

const PLAYBACK_OVERLAY_DELAY_MS = 5000

type VideoPlayerProps = {
  controlsVisible: boolean
  isMuted: boolean
  onFullscreen: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
  onMouseMove: () => void
  onRetryPlayback: () => void
  onToggleMute: () => void
  onVolumeChange: ChangeEventHandler<HTMLInputElement>
  playbackState: 'connecting' | 'live' | 'reconnecting' | 'offline'
  playbackStatusDetail: string
  videoFrameRef: RefObject<HTMLDivElement | null>
  videoRef: RefObject<HTMLVideoElement | null>
  volume: number
}

export function VideoPlayer({
  controlsVisible,
  isMuted,
  onFullscreen,
  onMouseEnter,
  onMouseLeave,
  onMouseMove,
  onRetryPlayback,
  onToggleMute,
  onVolumeChange,
  playbackState,
  playbackStatusDetail,
  videoFrameRef,
  videoRef,
  volume,
}: VideoPlayerProps) {
  const [playbackOverlayVisible, setPlaybackOverlayVisible] = useState(false)
  const isPlaybackDegraded = playbackState !== 'live'
  const showPlaybackOverlay = isPlaybackDegraded && playbackOverlayVisible
  const canRetryPlayback = playbackState !== 'connecting'
  const playbackAccentClass =
    playbackState === 'offline'
      ? 'border-[rgba(247,118,142,0.4)] bg-[rgba(20,12,14,0.92)] text-[var(--color-accent-red)]'
      : 'border-[var(--color-edge-strong)] bg-[rgba(14,15,17,0.86)] text-[var(--color-app-fg)]'
  const playbackRole = playbackState === 'offline' ? 'alert' : 'status'

  useEffect(() => {
    if (!isPlaybackDegraded) {
      const resetTimeoutId = window.setTimeout(() => {
        setPlaybackOverlayVisible(false)
      }, 0)

      return () => {
        window.clearTimeout(resetTimeoutId)
      }
    }

    if (playbackOverlayVisible) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setPlaybackOverlayVisible(true)
    }, PLAYBACK_OVERLAY_DELAY_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [isPlaybackDegraded, playbackOverlayVisible])

  return (
    <div className="flex h-full min-h-0 shrink-0 items-stretch justify-center bg-black">
      <div
        ref={videoFrameRef}
        className="video-frame scanlines relative aspect-[4/3] h-full w-auto overflow-hidden bg-black"
        onMouseMove={onMouseMove}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onFocusCapture={onMouseEnter}
      >
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-contain"
          muted
          autoPlay
          preload="auto"
          playsInline
          onContextMenu={(event) => event.preventDefault()}
        />
        {showPlaybackOverlay && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 p-4">
            <div
              role={playbackRole}
              aria-live={playbackState === 'offline' ? 'assertive' : 'polite'}
              className={`pointer-events-auto flex w-full max-w-sm flex-col gap-3 rounded-2xl border px-4 py-4 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-md ${playbackAccentClass}`}
            >
              <p className="text-[0.875rem] leading-relaxed">
                {playbackStatusDetail}
              </p>
              {canRetryPlayback && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--color-edge-strong)] bg-white/[0.04] px-3 py-1.5 text-[0.75rem] font-semibold text-[var(--color-app-fg)] transition-colors hover:border-[var(--color-faint)] hover:bg-white/[0.08] focus-visible:outline-none focus-visible:border-[var(--color-accent)]"
                    onClick={onRetryPlayback}
                  >
                    Retry now
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        <div
          className={`absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full border border-[var(--color-edge-strong)] bg-[rgba(14,15,17,0.82)] px-2 py-1.5 shadow-lg shadow-black/40 backdrop-blur-md transition-[opacity,transform] duration-200 ${controlsVisible ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0'}`}
        >
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--color-accent)] focus-visible:outline-none focus-visible:text-[var(--color-accent)]"
            onClick={onToggleMute}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? (
              <FontAwesomeIcon icon={faVolumeXmark} className="text-[15px]" />
            ) : (
              <FontAwesomeIcon icon={faVolumeHigh} className="text-[15px]" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={volume}
            onChange={onVolumeChange}
            style={{
              background: `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${(isMuted ? 0 : volume) * 100}%, var(--color-subtle) ${(isMuted ? 0 : volume) * 100}%, var(--color-subtle) 100%)`,
            }}
            className="volume-slider mx-0.5 h-1 w-24 cursor-pointer"
            aria-label="Volume"
          />
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--color-accent)] focus-visible:outline-none focus-visible:text-[var(--color-accent)]"
            onClick={onFullscreen}
            aria-label="Toggle fullscreen"
          >
            <FontAwesomeIcon icon={faExpand} className="text-[15px]" />
          </button>
        </div>
      </div>
    </div>
  )
}
