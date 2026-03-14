import type { ChangeEventHandler, RefObject } from 'react'

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
  const showPlaybackOverlay = playbackState !== 'live'
  const canRetryPlayback = playbackState !== 'connecting'
  const playbackTitle =
    playbackState === 'offline'
      ? 'Stream unavailable'
      : playbackState === 'reconnecting'
        ? 'Reconnecting stream'
        : 'Connecting stream'
  const playbackAccentClass =
    playbackState === 'offline'
      ? 'border-rose-500/40 bg-rose-500/12 text-rose-100'
      : 'border-sky-500/40 bg-black/72 text-zinc-100'
  const playbackRole = playbackState === 'offline' ? 'alert' : 'status'

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
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-[0.28em] text-zinc-400">
                  Live playback
                </p>
                <h2 className="text-sm font-semibold uppercase tracking-[0.2em]">
                  {playbackTitle}
                </h2>
                <p className="text-sm leading-relaxed text-zinc-200">
                  {playbackStatusDetail}
                </p>
              </div>
              {canRetryPlayback && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="border border-zinc-500 bg-black/40 px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-zinc-100 transition hover:border-zinc-300"
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
          className={`pointer-events-none absolute bottom-2 right-2 inline-flex items-center justify-end bg-black/60 px-3 py-2 text-[11px] text-zinc-200 transition-opacity duration-200 ${controlsVisible ? 'opacity-100' : 'opacity-0'}`}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="pointer-events-auto inline-flex h-6 w-6 items-center justify-center border border-zinc-700 text-zinc-200 transition hover:border-zinc-400"
              onClick={onToggleMute}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? (
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M10 8.5L7.2 11H5v2h2.2l2.8 2.5V8.5z" />
                  <path d="M15 9l4 6" />
                  <path d="M19 9l-4 6" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M10 8.5L7.2 11H5v2h2.2l2.8 2.5V8.5z" />
                  <path d="M14 10a3 3 0 010 4" />
                  <path d="M16.5 8a6 6 0 010 8" />
                </svg>
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={volume}
              onChange={onVolumeChange}
              className="volume-slider pointer-events-auto h-1 w-24 cursor-pointer"
              aria-label="Volume"
            />
            <button
              type="button"
              className="pointer-events-auto border border-zinc-700 p-1 text-zinc-200 transition hover:border-zinc-400"
              onClick={onFullscreen}
              aria-label="Toggle fullscreen"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M8 4H4v4" />
                <path d="M16 4h4v4" />
                <path d="M4 16v4h4" />
                <path d="M20 16v4h-4" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
