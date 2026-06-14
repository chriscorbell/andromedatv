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
      ? 'border-rose-500/40 bg-rose-500/12 text-rose-100'
      : 'border-sky-500/40 bg-black/72 text-zinc-100'
  const playbackRole = playbackState === 'offline' ? 'alert' : 'status'
  const playbackMessage = playbackStatusDetail.toLowerCase()

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
    <div className="flex min-h-0 items-stretch lg:h-full">
      <div
        ref={videoFrameRef}
        className="video-frame scanlines relative aspect-[4/3] h-auto w-full max-h-[60vh] overflow-hidden bg-black lg:h-full lg:w-auto lg:max-h-full"
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
              className={`pointer-events-auto flex w-full max-w-sm flex-col gap-3 border px-4 py-4 shadow-[0_0_32px_rgba(0,0,0,0.35)] backdrop-blur-sm ${playbackAccentClass}`}
            >
              <p className="text-sm leading-relaxed text-zinc-200">
                {playbackMessage}
              </p>
              {canRetryPlayback && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="border border-zinc-500 bg-black/40 px-3 py-1.5 text-[11px] text-zinc-100 transition hover:border-zinc-300"
                    onClick={onRetryPlayback}
                  >
                    retry now
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        <div
          className={`pointer-events-none absolute bottom-3 right-3 inline-flex items-center justify-end border border-white/10 bg-black/60 px-1.5 py-1 text-zinc-200 shadow-lg shadow-black/40 backdrop-blur-md transition-opacity duration-200 ${controlsVisible ? 'opacity-100' : 'opacity-0'}`}
        >
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
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
                background: `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${(isMuted ? 0 : volume) * 100}%, rgba(255,255,255,0.18) ${(isMuted ? 0 : volume) * 100}%, rgba(255,255,255,0.18) 100%)`,
              }}
              className="volume-slider pointer-events-auto mx-1 h-1 w-24 cursor-pointer"
              aria-label="Volume"
            />
            <button
              type="button"
              className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
              onClick={onFullscreen}
              aria-label="Toggle fullscreen"
            >
              <FontAwesomeIcon icon={faExpand} className="text-[15px]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
