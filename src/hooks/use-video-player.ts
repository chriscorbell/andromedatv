import { useEffect, useRef, useState } from 'react'
import type Hls from 'hls.js/light'
import { useVideoPlayerControls } from './use-video-player-controls'

const HLS_URL = '/iptv/session/1/hls.m3u8'
const PLAYBACK_WATCHDOG_INTERVAL_MS = 10_000
const PLAYBACK_DEBUG_STORAGE_KEY = 'andromeda:playback-debug'

type HlsCtor = typeof import('hls.js/light').default
type PlaybackState = 'connecting' | 'live' | 'reconnecting' | 'offline'
type PlaybackTransport = 'native' | 'hls'

type PlaybackMetric = {
  attempt: number
  detail?: string
  durationMs?: number
  event: string
  phase: 'recovery' | 'startup'
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

  const payload = {
    scope: 'andromeda.playback',
    ...metric,
  }

  const metricsWindow = window as Window & {
    __andromedaPlaybackMetrics?: PlaybackMetric[]
  }
  const existingMetrics = metricsWindow.__andromedaPlaybackMetrics ?? []
  metricsWindow.__andromedaPlaybackMetrics = [...existingMetrics.slice(-24), metric]
  console.info('[andromeda.playback]', payload)
}

export function useVideoPlayer() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const videoFrameRef = useRef<HTMLDivElement | null>(null)
  const hlsRef = useRef<Hls | null>(null)
  const hlsRestartTimeoutRef = useRef<number | null>(null)
  const playbackRetryTimeoutRef = useRef<number | null>(null)
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

  useEffect(() => {
    const video = videoRef.current

    if (!video) {
      return
    }

    const supportsNativeHls = Boolean(
      video.canPlayType('application/vnd.apple.mpegurl'),
    )

    const clearRestartTimer = () => {
      if (hlsRestartTimeoutRef.current) {
        window.clearTimeout(hlsRestartTimeoutRef.current)
        hlsRestartTimeoutRef.current = null
      }
    }

    const clearPlaybackRetryTimer = () => {
      if (playbackRetryTimeoutRef.current) {
        window.clearTimeout(playbackRetryTimeoutRef.current)
        playbackRetryTimeoutRef.current = null
      }
    }

    const destroyHls = () => {
      if (!hlsRef.current) {
        return
      }
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    let recoveryInProgress = false
    let playbackWatchdogTimeout: number | null = null
    let startupRestartTimeout: number | null = null
    let lastPlaybackTime = 0
    let stalledChecks = 0
    let recoveryAttempts = 0
    let startupAttempts = 0
    let manifestLoaded = false
    let playbackStarted = false
    let playbackStartedOnce = false
    let disposed = false
    let hlsSupportKnown = supportsNativeHls
    let activePlaybackAttempt:
      | {
          attempt: number
          phase: 'recovery' | 'startup'
          startedAtMs: number
          transport: PlaybackTransport
        }
      | null = null

    const setPlaybackUiState = (
      nextState: PlaybackState,
      detail: string,
    ) => {
      setPlaybackState((current) =>
        current === nextState ? current : nextState,
      )
      setPlaybackStatusDetail((current) =>
        current === detail ? current : detail,
      )
    }

    const markConnecting = (detail = 'Connecting to live stream...') => {
      setPlaybackUiState('connecting', detail)
    }

    const markRecovering = (
      detail = 'Reconnecting to the live stream...',
    ) => {
      setPlaybackUiState(
        playbackStartedOnce ? 'reconnecting' : 'connecting',
        detail,
      )
    }

    const markOffline = (detail = 'Stream unavailable. Still retrying...') => {
      setPlaybackUiState('offline', detail)
    }

    const clearStartupRestartTimer = () => {
      if (startupRestartTimeout) {
        window.clearTimeout(startupRestartTimeout)
        startupRestartTimeout = null
      }
    }

    const clearPlaybackWatchdog = () => {
      if (playbackWatchdogTimeout !== null) {
        window.clearTimeout(playbackWatchdogTimeout)
        playbackWatchdogTimeout = null
      }
    }

    const beginPlaybackAttempt = (
      phase: 'recovery' | 'startup',
      transport: PlaybackTransport,
      detail: string,
    ) => {
      let attempt = 1
      if (phase === 'startup') {
        startupAttempts += 1
        attempt = startupAttempts
      } else {
        attempt = Math.max(1, recoveryAttempts)
      }

      activePlaybackAttempt = {
        attempt,
        phase,
        startedAtMs: performance.now(),
        transport,
      }

      recordPlaybackMetric({
        attempt,
        detail,
        event: 'attempt_started',
        phase,
        transport,
        ts: new Date().toISOString(),
      })
    }

    const completePlaybackAttempt = (detail: string) => {
      if (!activePlaybackAttempt) {
        return
      }

      const completedAttempt = activePlaybackAttempt
      activePlaybackAttempt = null

      recordPlaybackMetric({
        attempt: completedAttempt.attempt,
        detail,
        durationMs: Math.round(performance.now() - completedAttempt.startedAtMs),
        event: 'attempt_succeeded',
        phase: completedAttempt.phase,
        transport: completedAttempt.transport,
        ts: new Date().toISOString(),
      })
    }

    const failPlaybackAttempt = (detail: string) => {
      if (!activePlaybackAttempt) {
        return
      }

      const failedAttempt = activePlaybackAttempt
      activePlaybackAttempt = null

      recordPlaybackMetric({
        attempt: failedAttempt.attempt,
        detail,
        durationMs: Math.round(performance.now() - failedAttempt.startedAtMs),
        event: 'attempt_degraded',
        phase: failedAttempt.phase,
        transport: failedAttempt.transport,
        ts: new Date().toISOString(),
      })
    }

    const loadHlsCtor = async () => {
      const ctor = await loadSharedHlsCtor()
      if (disposed) {
        return null
      }

      hlsSupportKnown = Boolean(ctor)
      return ctor
    }

    const getStreamUrl = () =>
      `${HLS_URL}${HLS_URL.includes('?') ? '&' : '?'}ts=${Date.now()}`

    const scheduleStartupRestart = (delay = 12_000) => {
      if (!supportsNativeHls && !hlsSupportKnown) {
        return
      }

      if (playbackStartedOnce) {
        markRecovering('The stream is taking longer than expected. Retrying...')
      } else {
        markConnecting('Connecting to live stream...')
      }

      clearStartupRestartTimer()
      startupRestartTimeout = window.setTimeout(() => {
        if (!playbackStarted) {
          void restartStream(0)
        }
      }, delay)
    }

    const schedulePlaybackRetry = (delay = 750) => {
      clearPlaybackRetryTimer()
      playbackRetryTimeoutRef.current = window.setTimeout(() => {
        const playAttempt = video.play()
        if (!playAttempt) {
          return
        }

        void playAttempt.catch(() => {
          if (document.visibilityState === 'visible' && !video.ended) {
            schedulePlaybackRetry(1000)
          }
        })
      }, delay)
    }

    const handleReady = () => {
      manifestLoaded = true
      stalledChecks = 0
      lastPlaybackTime = video.currentTime
      if (!playbackStarted) {
        markRecovering(
          playbackStartedOnce
            ? 'Buffering the live stream...'
            : 'Connecting to live stream...',
        )
      }

      if (video.paused) {
        schedulePlaybackRetry(0)
        return
      }

      clearPlaybackRetryTimer()
    }

    const handlePlaying = () => {
      recoveryAttempts = 0
      playbackStarted = true
      playbackStartedOnce = true
      manifestLoaded = true
      stalledChecks = 0
      lastPlaybackTime = video.currentTime
      setPlaybackUiState('live', 'Live now')
      completePlaybackAttempt('Playback reached the live state.')
      clearPlaybackRetryTimer()
      clearStartupRestartTimer()
    }

    const restartStream = async (delay = 1500) => {
      recoveryAttempts += 1
      failPlaybackAttempt('Scheduling a playback restart.')
      if (recoveryAttempts >= 3) {
        markOffline('Stream unavailable. Retrying automatically...')
      } else {
        markRecovering('Reconnecting to the live stream...')
      }

      clearRestartTimer()
      clearStartupRestartTimer()
      hlsRestartTimeoutRef.current = window.setTimeout(() => {
        if (supportsNativeHls) {
          startNativeStream('Automatic recovery restart')
          return
        }

        void startHls('Automatic recovery restart')
      }, delay)
    }

    const startNativeStream = (detail = 'Starting native HLS playback') => {
      playbackStarted = false
      manifestLoaded = false
      beginPlaybackAttempt(
        playbackStartedOnce ? 'recovery' : 'startup',
        'native',
        detail,
      )
      if (playbackStartedOnce) {
        markRecovering('Reconnecting to the live stream...')
      } else {
        markConnecting('Connecting to live stream...')
      }
      clearRestartTimer()
      clearStartupRestartTimer()
      destroyHls()
      video.pause()
      video.src = getStreamUrl()
      video.load()
      schedulePlaybackRetry(0)
      scheduleStartupRestart()
    }

    const startHls = async (detail = 'Starting hls.js playback') => {
      playbackStarted = false
      manifestLoaded = false
      beginPlaybackAttempt(
        playbackStartedOnce ? 'recovery' : 'startup',
        'hls',
        detail,
      )
      if (playbackStartedOnce) {
        markRecovering('Reconnecting to the live stream...')
      } else {
        markConnecting('Connecting to live stream...')
      }
      clearStartupRestartTimer()
      destroyHls()

      const HlsImpl = await loadHlsCtor()
      if (!HlsImpl || disposed) {
        return
      }

      const hls = new HlsImpl({
        enableWorker: true,
        lowLatencyMode: false,
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
        scheduleStartupRestart()
      })

      hls.on(HlsImpl.Events.MANIFEST_PARSED, () => {
        manifestLoaded = true
        schedulePlaybackRetry(0)
      })

      hls.on(HlsImpl.Events.LEVEL_LOADED, () => {
        manifestLoaded = true
        if (video.paused) {
          schedulePlaybackRetry(0)
        }
      })

      hls.on(HlsImpl.Events.ERROR, (_event, data) => {
        if (!data.fatal) {
          return
        }

        failPlaybackAttempt(`Fatal ${data.type.toLowerCase()} error: ${data.details}`)

        if (data.type === HlsImpl.ErrorTypes.NETWORK_ERROR) {
          if (
            !playbackStarted ||
            data.details === HlsImpl.ErrorDetails.MANIFEST_LOAD_ERROR ||
            data.details === HlsImpl.ErrorDetails.MANIFEST_LOAD_TIMEOUT ||
            data.details === HlsImpl.ErrorDetails.LEVEL_EMPTY_ERROR ||
            data.details === HlsImpl.ErrorDetails.LEVEL_LOAD_ERROR ||
            data.details === HlsImpl.ErrorDetails.LEVEL_LOAD_TIMEOUT
          ) {
            void restartStream(1500)
            return
          }

          markRecovering('Lost contact with the stream. Reconnecting...')
          hls.startLoad()
          schedulePlaybackRetry(500)
          scheduleStartupRestart(8000)
          return
        }

        if (data.type === HlsImpl.ErrorTypes.MEDIA_ERROR) {
          if (recoveryInProgress || !manifestLoaded) {
            void restartStream(1500)
            return
          }

          markRecovering('Trying to recover video playback...')
          recoveryInProgress = true
          hls.recoverMediaError()
          schedulePlaybackRetry(250)
          window.setTimeout(() => {
            recoveryInProgress = false
          }, 1500)
          return
        }

        void restartStream(1500)
      })

      hls.attachMedia(video)
    }

    const nudgePlayback = () => {
      if (!video.paused || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        markRecovering(
          playbackStartedOnce
            ? 'Playback stalled. Reconnecting...'
            : 'Connecting to live stream...',
        )
      }
      if (hlsRef.current) {
        hlsRef.current.startLoad()
      }
      schedulePlaybackRetry(0)
    }

    const schedulePlaybackWatchdog = () => {
      clearPlaybackWatchdog()
      if (disposed || document.visibilityState === 'hidden') {
        return
      }

      playbackWatchdogTimeout = window.setTimeout(() => {
        playbackWatchdogTimeout = null

        if (video.ended) {
          lastPlaybackTime = video.currentTime
          stalledChecks = 0
          schedulePlaybackWatchdog()
          return
        }

        if (video.paused) {
          lastPlaybackTime = video.currentTime
          stalledChecks = 0
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            schedulePlaybackRetry(0)
          }
          schedulePlaybackWatchdog()
          return
        }

        const currentTime = video.currentTime
        if (currentTime <= lastPlaybackTime + 0.01) {
          stalledChecks += 1
        } else {
          stalledChecks = 0
        }

        lastPlaybackTime = currentTime

        if (stalledChecks >= 3) {
          stalledChecks = 0
          nudgePlayback()
        }

        schedulePlaybackWatchdog()
      }, PLAYBACK_WATCHDOG_INTERVAL_MS)
    }

    const handleWaiting = () => {
      nudgePlayback()
    }

    const handleVideoError = () => {
      if (!playbackStarted) {
        void restartStream(1500)
        return
      }

      nudgePlayback()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (video.paused) {
          nudgePlayback()
        }
        schedulePlaybackWatchdog()
        return
      }

      clearPlaybackWatchdog()
    }

    forcePlaybackRecoveryRef.current = () => {
      recoveryAttempts = 0
      failPlaybackAttempt('Manual playback retry requested.')
      markRecovering('Retrying the live stream...')
      clearRestartTimer()
      clearPlaybackRetryTimer()
      clearStartupRestartTimer()

      if (supportsNativeHls) {
        startNativeStream('Manual retry')
        return
      }

      void startHls('Manual retry')
    }

    video.addEventListener('loadedmetadata', handleReady)
    video.addEventListener('canplay', handleReady)
    video.addEventListener('playing', handlePlaying)
    video.addEventListener('error', handleVideoError)
    video.addEventListener('waiting', handleWaiting)
    video.addEventListener('stalled', handleWaiting)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    if (supportsNativeHls) {
      startNativeStream('Initial player startup')
    } else {
      void startHls('Initial player startup')
    }
    schedulePlaybackWatchdog()

    return () => {
      disposed = true
      video.removeEventListener('loadedmetadata', handleReady)
      video.removeEventListener('canplay', handleReady)
      video.removeEventListener('playing', handlePlaying)
      video.removeEventListener('error', handleVideoError)
      video.removeEventListener('waiting', handleWaiting)
      video.removeEventListener('stalled', handleWaiting)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      clearPlaybackWatchdog()
      clearRestartTimer()
      clearPlaybackRetryTimer()
      clearStartupRestartTimer()
      activePlaybackAttempt = null
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
