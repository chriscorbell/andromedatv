import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'

const HLS_URL = '/iptv/session/1/hls.m3u8'

export function useVideoPlayer() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const videoFrameRef = useRef<HTMLDivElement | null>(null)
  const hlsRef = useRef<Hls | null>(null)
  const hlsRestartTimeoutRef = useRef<number | null>(null)
  const playbackRetryTimeoutRef = useRef<number | null>(null)
  const hideTimeoutRef = useRef<number | null>(null)
  const [isMuted, setIsMuted] = useState(true)
  const [volume, setVolume] = useState(0.6)
  const [controlsVisible, setControlsVisible] = useState(false)

  useEffect(() => {
    const video = videoRef.current

    if (!video) {
      return
    }

    const supportsNativeHls = Boolean(
      video.canPlayType('application/vnd.apple.mpegurl'),
    )
    const canUseHlsJs = Hls.isSupported()

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
    let playbackWatchdog: number | null = null
    let startupRestartTimeout: number | null = null
    let lastPlaybackTime = 0
    let stalledChecks = 0
    let manifestLoaded = false
    let playbackStarted = false

    const clearStartupRestartTimer = () => {
      if (startupRestartTimeout) {
        window.clearTimeout(startupRestartTimeout)
        startupRestartTimeout = null
      }
    }

    const getStreamUrl = () =>
      `${HLS_URL}${HLS_URL.includes('?') ? '&' : '?'}ts=${Date.now()}`

    const scheduleStartupRestart = (delay = 12_000) => {
      if (!supportsNativeHls && !canUseHlsJs) {
        return
      }

      clearStartupRestartTimer()
      startupRestartTimeout = window.setTimeout(() => {
        if (!playbackStarted) {
          restartStream(0)
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

      if (video.paused) {
        schedulePlaybackRetry(0)
        return
      }

      clearPlaybackRetryTimer()
    }

    const handlePlaying = () => {
      playbackStarted = true
      manifestLoaded = true
      stalledChecks = 0
      lastPlaybackTime = video.currentTime
      clearPlaybackRetryTimer()
      clearStartupRestartTimer()
    }

    const restartStream = (delay = 1500) => {
      clearRestartTimer()
      clearStartupRestartTimer()
      hlsRestartTimeoutRef.current = window.setTimeout(() => {
        if (supportsNativeHls) {
          startNativeStream()
          return
        }

        if (canUseHlsJs) {
          startHls()
        }
      }, delay)
    }

    const startNativeStream = () => {
      playbackStarted = false
      manifestLoaded = false
      clearRestartTimer()
      clearStartupRestartTimer()
      destroyHls()
      video.pause()
      video.src = getStreamUrl()
      video.load()
      schedulePlaybackRetry(0)
      scheduleStartupRestart()
    }

    const startHls = () => {
      playbackStarted = false
      manifestLoaded = false
      clearStartupRestartTimer()
      destroyHls()

      const hls = new Hls({
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

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(getStreamUrl())
        scheduleStartupRestart()
      })

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        manifestLoaded = true
        schedulePlaybackRetry(0)
      })

      hls.on(Hls.Events.LEVEL_LOADED, () => {
        manifestLoaded = true
        if (video.paused) {
          schedulePlaybackRetry(0)
        }
      })

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) {
          return
        }

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (
            !playbackStarted ||
            data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
            data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT ||
            data.details === Hls.ErrorDetails.LEVEL_EMPTY_ERROR ||
            data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR ||
            data.details === Hls.ErrorDetails.LEVEL_LOAD_TIMEOUT
          ) {
            restartStream(1500)
            return
          }

          hls.startLoad()
          schedulePlaybackRetry(500)
          scheduleStartupRestart(8000)
          return
        }

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if (recoveryInProgress || !manifestLoaded) {
            restartStream(1500)
            return
          }

          recoveryInProgress = true
          hls.recoverMediaError()
          schedulePlaybackRetry(250)
          window.setTimeout(() => {
            recoveryInProgress = false
          }, 1500)
          return
        }

        restartStream(1500)
      })

      hls.attachMedia(video)
    }

    const nudgePlayback = () => {
      if (hlsRef.current) {
        hlsRef.current.startLoad()
      }
      schedulePlaybackRetry(0)
    }

    const handleWaiting = () => {
      nudgePlayback()
    }

    const handleVideoError = () => {
      if (!playbackStarted) {
        restartStream(1500)
        return
      }

      nudgePlayback()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && video.paused) {
        nudgePlayback()
      }
    }

    video.addEventListener('loadedmetadata', handleReady)
    video.addEventListener('canplay', handleReady)
    video.addEventListener('playing', handlePlaying)
    video.addEventListener('error', handleVideoError)
    video.addEventListener('waiting', handleWaiting)
    video.addEventListener('stalled', handleWaiting)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    if (supportsNativeHls) {
      startNativeStream()
    } else if (canUseHlsJs) {
      startHls()
    } else {
      return () => {
        video.removeEventListener('loadedmetadata', handleReady)
        video.removeEventListener('canplay', handleReady)
        video.removeEventListener('playing', handlePlaying)
        video.removeEventListener('error', handleVideoError)
        video.removeEventListener('waiting', handleWaiting)
        video.removeEventListener('stalled', handleWaiting)
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        clearRestartTimer()
        clearPlaybackRetryTimer()
        clearStartupRestartTimer()
        destroyHls()
      }
    }

    playbackWatchdog = window.setInterval(() => {
      if (video.ended) {
        lastPlaybackTime = video.currentTime
        stalledChecks = 0
        return
      }

      if (video.paused) {
        lastPlaybackTime = video.currentTime
        stalledChecks = 0
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          schedulePlaybackRetry(0)
        }
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
    }, 10_000)

    return () => {
      video.removeEventListener('loadedmetadata', handleReady)
      video.removeEventListener('canplay', handleReady)
      video.removeEventListener('playing', handlePlaying)
      video.removeEventListener('error', handleVideoError)
      video.removeEventListener('waiting', handleWaiting)
      video.removeEventListener('stalled', handleWaiting)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (playbackWatchdog) {
        window.clearInterval(playbackWatchdog)
      }
      clearRestartTimer()
      clearPlaybackRetryTimer()
      clearStartupRestartTimer()
      destroyHls()
      video.removeAttribute('src')
      video.load()
    }
  }, [])

  useEffect(() => {
    if (!videoRef.current) {
      return
    }

    videoRef.current.muted = isMuted
  }, [isMuted])

  useEffect(() => {
    if (!videoRef.current) {
      return
    }

    videoRef.current.volume = volume
  }, [volume])

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current)
      }
    }
  }, [])

  const handleToggleMute = () => {
    setIsMuted((prev) => !prev)
  }

  const handleVolumeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value)
    setVolume(next)
    if (next > 0 && isMuted) {
      setIsMuted(false)
    }
  }

  const handleFullscreen = () => {
    const frame = videoFrameRef.current
    if (!frame) {
      return
    }

    if (document.fullscreenElement) {
      void document.exitFullscreen()
      return
    }

    void frame.requestFullscreen()
  }

  const showControls = () => {
    setControlsVisible(true)
    if (hideTimeoutRef.current) {
      window.clearTimeout(hideTimeoutRef.current)
    }
    hideTimeoutRef.current = window.setTimeout(() => {
      setControlsVisible(false)
    }, 2200)
  }

  const scheduleHideControls = () => {
    if (hideTimeoutRef.current) {
      window.clearTimeout(hideTimeoutRef.current)
    }
    hideTimeoutRef.current = window.setTimeout(() => {
      setControlsVisible(false)
    }, 600)
  }

  return {
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
  }
}
