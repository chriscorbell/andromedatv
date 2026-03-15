import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MutableRefObject,
  type RefObject,
} from 'react'

type UseVideoPlayerControlsOptions = {
  forcePlaybackRecoveryRef: MutableRefObject<() => void>
  videoFrameRef: RefObject<HTMLDivElement | null>
  videoRef: RefObject<HTMLVideoElement | null>
}

export function useVideoPlayerControls({
  forcePlaybackRecoveryRef,
  videoFrameRef,
  videoRef,
}: UseVideoPlayerControlsOptions) {
  const hideTimeoutRef = useRef<number | null>(null)
  const [isMuted, setIsMuted] = useState(true)
  const [volume, setVolume] = useState(0.6)
  const [controlsVisible, setControlsVisible] = useState(false)

  useEffect(() => {
    if (!videoRef.current) {
      return
    }

    videoRef.current.muted = isMuted
  }, [isMuted, videoRef])

  useEffect(() => {
    if (!videoRef.current) {
      return
    }

    videoRef.current.volume = volume
  }, [videoRef, volume])

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

  const handleVolumeChange = (event: ChangeEvent<HTMLInputElement>) => {
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

  const handleRetryPlayback = () => {
    forcePlaybackRecoveryRef.current()
    showControls()
  }

  return {
    controlsVisible,
    handleFullscreen,
    handleRetryPlayback,
    handleToggleMute,
    handleVolumeChange,
    isMuted,
    scheduleHideControls,
    showControls,
    volume,
  }
}
