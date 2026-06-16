import { useCallback, useEffect, useRef, useState } from 'react'
import type Hls from 'hls.js/light'
import { useVideoPlayerControls } from './use-video-player-controls'

const HLS_URL = '/iptv/session/1/hls.m3u8'
const PLAYBACK_DEBUG_STORAGE_KEY = 'andromeda:playback-debug'
// If 'playing' has not fired this long after a (re)start, assume the attempt
// wedged and restart it. This is a single timer per attempt, not a poll loop —
// hls.js already detects and nudges buffer stalls on its own.
const STARTUP_GUARD_MS = 15_000
// Restart with this delay after a fatal error so we back off the upstream.
const RESTART_DELAY_MS = 2_000
// Escalate to the "offline" UI (manual retry affordance) after this many
// consecutive failed recovery attempts.
const MAX_RECOVERY_ATTEMPTS = 3

type HlsCtor = typeof import('hls.js/light').default
type PlaybackState = 'connecting' | 'live' | 'reconnecting' | 'offline'
type PlaybackTransport = 'native' | 'hls'

type PlaybackMetric = {
  detail?: string
  event: string
  transport: PlaybackTransport
  ts: string
}

let cachedHlsCtor: HlsCtor | null = null
let cachedHlsCtorPromise: Promise<HlsCtor | null> | null = null

async function loadSharedHlsCtor() {
  if (cachedHlsCtor) {
    return cachedHlsCtor
  }

  if (cachedHlsCtorPromise) {
    return cachedHlsCtorPromise
  }

  cachedHlsCtorPromise = import('hls.js/light')
    .then((module) => {
      if (!module.default.isSupported()) {
        return null
      }

      cachedHlsCtor = module.default
      return cachedHlsCtor
    })
    .catch((error) => {
      console.warn('Failed to load hls.js', error)
      return null
    })
    .finally(() => {
      cachedHlsCtorPromise = null
    })

  return cachedHlsCtorPromise
}

// Pick the playback transport. hls.js (Media Source Extensions) is preferred
// whenever it is supported because it transmuxes the MPEG-TS segments and
// manages the live buffer reliably across browsers. Native HLS is only a
// fallback for engines without MSE (e.g. iOS Safari). This deliberately ignores
// a truthy `canPlayType('application/vnd.apple.mpegurl')` when hls.js is
// available: Chrome on macOS reports "maybe" there but cannot decode the raw TS
// segments, which is what previously sent it down a stalling native path.
export function selectPlaybackTransport(options: {
  hlsJsSupported: boolean
  nativeHlsSupported: boolean
}): PlaybackTransport | 'none' {
  if (options.hlsJsSupported) {
    return 'hls'
  }
  if (options.nativeHlsSupported) {
    return 'native'
  }
  return 'none'
}

function shouldRecordPlaybackMetrics() {
  if (import.meta.env.DEV) {
    return true
  }

  try {
    return window.localStorage.getItem(PLAYBACK_DEBUG_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function recordPlaybackMetric(metric: PlaybackMetric) {
  if (!shouldRecordPlaybackMetrics()) {
    return
  }

  const metricsWindow = window as Window & {
    __andromedaPlaybackMetrics?: PlaybackMetric[]
  }
  const existingMetrics = metricsWindow.__andromedaPlaybackMetrics ?? []
  metricsWindow.__andromedaPlaybackMetrics = [...existingMetrics.slice(-24), metric]
  console.info('[andromeda.playback]', { scope: 'andromeda.playback', ...metric })
}

export function useVideoPlayer() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const videoFrameRef = useRef<HTMLDivElement | null>(null)
  const hlsRef = useRef<Hls | null>(null)
  const forcePlaybackRecoveryRef = useRef<() => void>(() => {})
  const [playbackState, setPlaybackState] = useState<PlaybackState>('connecting')
  const [playbackStatusDetail, setPlaybackStatusDetail] = useState(
    'Connecting to live stream...',
  )
  const {
    controlsVisible,
    handleFullscreen,
    handleRetryPlayback,
    handleToggleMute,
    handleVolumeChange,
    isMuted,
    scheduleHideControls,
    showControls,
    volume,
  } = useVideoPlayerControls({
    forcePlaybackRecoveryRef,
    videoFrameRef,
    videoRef,
  })

  // Wall-clock timestamp (epoch ms) of the frame currently on screen, derived
  // from the stream's EXT-X-PROGRAM-DATE-TIME tags. This trails real time by the
  // live-edge buffer (and any pre-roll bump), so the schedule uses it instead of
  // Date.now() to stay aligned with what's actually playing. Null until known.
  const getStreamDate = useCallback((): number | null => {
    const hls = hlsRef.current
    if (hls) {
      const playingDate = hls.playingDate
      if (playingDate) {
        const ms = playingDate.getTime()
        if (!Number.isNaN(ms)) {
          return ms
        }
      }
    }

    const video = videoRef.current as
      | (HTMLVideoElement & { getStartDate?: () => Date })
      | null
    if (video && typeof video.getStartDate === 'function') {
      const startMs = video.getStartDate().getTime()
      if (!Number.isNaN(startMs)) {
        return startMs + video.currentTime * 1000
      }
    }

    return null
  }, [])

  useEffect(() => {
    const video = videoRef.current

    if (!video) {
      return
    }

    let disposed = false
    let transport: PlaybackTransport = 'hls'
    let playbackStartedOnce = false
    let attemptPlaying = false
    let recoveryAttempts = 0
    let restartTimeout: number | null = null
    let playRetryTimeout: number | null = null
    let startupGuardTimeout: number | null = null

    const clearRestartTimer = () => {
      if (restartTimeout !== null) {
        window.clearTimeout(restartTimeout)
        restartTimeout = null
      }
    }

    const clearPlayRetryTimer = () => {
      if (playRetryTimeout !== null) {
        window.clearTimeout(playRetryTimeout)
        playRetryTimeout = null
      }
    }

    const clearStartupGuard = () => {
      if (startupGuardTimeout !== null) {
        window.clearTimeout(startupGuardTimeout)
        startupGuardTimeout = null
      }
    }

    const destroyHls = () => {
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }

    const logMetric = (event: string, detail?: string) => {
      recordPlaybackMetric({
        detail,
        event,
        transport,
        ts: new Date().toISOString(),
      })
    }

    const setPlaybackUiState = (nextState: PlaybackState, detail: string) => {
      setPlaybackState((current) => (current === nextState ? current : nextState))
      setPlaybackStatusDetail((current) => (current === detail ? current : detail))
    }

    const markConnecting = (detail = 'Connecting to live stream...') => {
      setPlaybackUiState('connecting', detail)
    }

    const markReconnecting = (detail = 'Reconnecting to the live stream...') => {
      setPlaybackUiState(playbackStartedOnce ? 'reconnecting' : 'connecting', detail)
    }

    const markOffline = (detail = 'Stream unavailable. Still retrying...') => {
      setPlaybackUiState('offline', detail)
    }

    const markStarting = () => {
      if (playbackStartedOnce) {
        markReconnecting()
      } else {
        markConnecting()
      }
    }

    const getStreamUrl = () =>
      `${HLS_URL}${HLS_URL.includes('?') ? '&' : '?'}ts=${Date.now()}`

    const tryPlay = (delay = 0) => {
      clearPlayRetryTimer()
      playRetryTimeout = window.setTimeout(() => {
        const playAttempt = video.play()
        if (!playAttempt) {
          return
        }

        void playAttempt.catch(() => {
          if (document.visibilityState === 'visible' && !video.ended) {
            tryPlay(1000)
          }
        })
      }, delay)
    }

    const armStartupGuard = () => {
      clearStartupGuard()
      attemptPlaying = false
      startupGuardTimeout = window.setTimeout(() => {
        if (!disposed && !attemptPlaying) {
          logMetric('attempt_degraded', 'Playback did not start; restarting.')
          recoveryAttempts += 1
          restart(0)
        }
      }, STARTUP_GUARD_MS)
    }

    const startNative = () => {
      transport = 'native'
      destroyHls()
      logMetric('attempt_started', 'Native HLS playback')
      markStarting()
      video.src = getStreamUrl()
      video.load()
      tryPlay(0)
      armStartupGuard()
    }

    const startHls = (HlsImpl: HlsCtor) => {
      transport = 'hls'
      logMetric('attempt_started', 'hls.js playback')
      markStarting()
      destroyHls()

      const hls = new HlsImpl({
        enableWorker: true,
        lowLatencyMode: false,
        // Treat the channel as an unbounded live window and sit a few segments
        // back from the live edge so brief upstream hiccups don't underrun.
        liveDurationInfinity: true,
        liveSyncDurationCount: 3,
        // Bound memory growth over hours of continuous playback.
        backBufferLength: 30,
        maxBufferLength: 30,
        manifestLoadingTimeOut: 20_000,
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 1500,
        levelLoadingTimeOut: 20_000,
        levelLoadingMaxRetry: 6,
        levelLoadingRetryDelay: 1500,
        fragLoadingTimeOut: 20_000,
      })

      hlsRef.current = hls

      hls.on(HlsImpl.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(getStreamUrl())
      })

      hls.on(HlsImpl.Events.MANIFEST_PARSED, () => {
        tryPlay(0)
      })

      hls.on(HlsImpl.Events.LEVEL_LOADED, () => {
        if (video.paused) {
          tryPlay(0)
        }
      })

      hls.on(HlsImpl.Events.ERROR, (_event, data) => {
        // hls.js detects and nudges buffer stalls itself; just surface the
        // buffering state so the overlay can appear if it persists.
        if (data.details === HlsImpl.ErrorDetails.BUFFER_STALLED_ERROR) {
          markReconnecting('Playback stalled. Reconnecting...')
          return
        }

        if (!data.fatal) {
          return
        }

        recoveryAttempts += 1
        logMetric('attempt_degraded', `Fatal ${data.type}: ${data.details}`)

        if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
          markOffline('Stream unavailable. Retrying automatically...')
        } else {
          markReconnecting()
        }

        const isManifestOrLevelLoadError =
          data.details === HlsImpl.ErrorDetails.MANIFEST_LOAD_ERROR ||
          data.details === HlsImpl.ErrorDetails.MANIFEST_LOAD_TIMEOUT ||
          data.details === HlsImpl.ErrorDetails.LEVEL_EMPTY_ERROR ||
          data.details === HlsImpl.ErrorDetails.LEVEL_LOAD_ERROR ||
          data.details === HlsImpl.ErrorDetails.LEVEL_LOAD_TIMEOUT

        if (
          data.type === HlsImpl.ErrorTypes.NETWORK_ERROR &&
          !isManifestOrLevelLoadError
        ) {
          // Transient segment-loading failure: resume loading in place.
          hls.startLoad()
          tryPlay(500)
          return
        }

        if (
          data.type === HlsImpl.ErrorTypes.MEDIA_ERROR &&
          recoveryAttempts < 2
        ) {
          markReconnecting('Trying to recover video playback...')
          hls.recoverMediaError()
          tryPlay(250)
          return
        }

        // Manifest/level load failures, repeated media errors, and anything
        // else: tear down and reload the playlist with a fresh cache-buster.
        restart(RESTART_DELAY_MS)
      })

      hls.attachMedia(video)
      armStartupGuard()
    }

    const start = () => {
      const HlsImpl = cachedHlsCtor
      if (HlsImpl) {
        startHls(HlsImpl)
        return
      }
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        startNative()
        return
      }
      markOffline('This browser cannot play the live stream.')
    }

    const restart = (delay = RESTART_DELAY_MS) => {
      clearRestartTimer()
      clearStartupGuard()
      restartTimeout = window.setTimeout(() => {
        if (!disposed) {
          start()
        }
      }, delay)
    }

    const handlePlaying = () => {
      attemptPlaying = true
      playbackStartedOnce = true
      recoveryAttempts = 0
      clearStartupGuard()
      clearPlayRetryTimer()
      logMetric('attempt_live', 'Playback reached the live state.')
      setPlaybackUiState('live', 'Live now')
    }

    const handleReady = () => {
      if (video.paused) {
        tryPlay(0)
      }
    }

    const handleWaiting = () => {
      if (playbackStartedOnce) {
        markReconnecting('Playback stalled. Reconnecting...')
      } else {
        markConnecting('Buffering the live stream...')
      }
    }

    const handleVideoError = () => {
      // hls.js owns recovery while it is attached; this is mainly the native path.
      if (transport === 'native') {
        recoveryAttempts += 1
        if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
          markOffline('Stream unavailable. Retrying automatically...')
        } else {
          markReconnecting()
        }
        restart(RESTART_DELAY_MS)
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && video.paused && !video.ended) {
        tryPlay(0)
      }
    }

    forcePlaybackRecoveryRef.current = () => {
      recoveryAttempts = 0
      clearRestartTimer()
      clearPlayRetryTimer()
      logMetric('manual_retry', 'Manual playback retry requested.')
      markReconnecting('Retrying the live stream...')
      start()
    }

    video.addEventListener('loadedmetadata', handleReady)
    video.addEventListener('canplay', handleReady)
    video.addEventListener('playing', handlePlaying)
    video.addEventListener('waiting', handleWaiting)
    video.addEventListener('stalled', handleWaiting)
    video.addEventListener('error', handleVideoError)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    void loadSharedHlsCtor().then((HlsImpl) => {
      if (disposed) {
        return
      }

      const transportChoice = selectPlaybackTransport({
        hlsJsSupported: Boolean(HlsImpl),
        nativeHlsSupported: Boolean(
          video.canPlayType('application/vnd.apple.mpegurl'),
        ),
      })

      logMetric('transport_selected', transportChoice)

      if (transportChoice === 'hls' && HlsImpl) {
        startHls(HlsImpl)
      } else if (transportChoice === 'native') {
        startNative()
      } else {
        markOffline('This browser cannot play the live stream.')
      }
    })

    return () => {
      disposed = true
      video.removeEventListener('loadedmetadata', handleReady)
      video.removeEventListener('canplay', handleReady)
      video.removeEventListener('playing', handlePlaying)
      video.removeEventListener('waiting', handleWaiting)
      video.removeEventListener('stalled', handleWaiting)
      video.removeEventListener('error', handleVideoError)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      clearRestartTimer()
      clearPlayRetryTimer()
      clearStartupGuard()
      forcePlaybackRecoveryRef.current = () => {}
      destroyHls()
      video.removeAttribute('src')
      video.load()
    }
  }, [])

  return {
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
  }
}
