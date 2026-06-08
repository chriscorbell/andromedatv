import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hlsMock = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void

  let supported = true
  const instances: MockHls[] = []

  class MockHls {
    static Events = {
      ERROR: 'ERROR',
      LEVEL_LOADED: 'LEVEL_LOADED',
      MANIFEST_PARSED: 'MANIFEST_PARSED',
      MEDIA_ATTACHED: 'MEDIA_ATTACHED',
    } as const

    static ErrorTypes = {
      MEDIA_ERROR: 'MEDIA_ERROR',
      NETWORK_ERROR: 'NETWORK_ERROR',
    } as const

    static ErrorDetails = {
      LEVEL_EMPTY_ERROR: 'LEVEL_EMPTY_ERROR',
      LEVEL_LOAD_ERROR: 'LEVEL_LOAD_ERROR',
      LEVEL_LOAD_TIMEOUT: 'LEVEL_LOAD_TIMEOUT',
      MANIFEST_LOAD_ERROR: 'MANIFEST_LOAD_ERROR',
      MANIFEST_LOAD_TIMEOUT: 'MANIFEST_LOAD_TIMEOUT',
    } as const

    static isSupported() {
      return supported
    }

    destroyed = false
    handlers = new Map<string, Handler>()
    loadedSources: string[] = []

    constructor() {
      instances.push(this)
    }

    attachMedia() {
      this.handlers.get(MockHls.Events.MEDIA_ATTACHED)?.()
    }

    destroy() {
      this.destroyed = true
    }

    loadSource(source: string) {
      this.loadedSources.push(source)
    }

    on(eventName: string, handler: Handler) {
      this.handlers.set(eventName, handler)
    }

    recoverMediaError() {}

    startLoad() {}
  }

  return {
    MockHls,
    instances,
    reset() {
      supported = true
      instances.length = 0
    },
    setSupported(value: boolean) {
      supported = value
    },
  }
})

vi.mock('hls.js/light', () => ({
  default: hlsMock.MockHls,
}))

async function renderVideoPlayerHook() {
  const { useVideoPlayer } = await import('./use-video-player')

  function HookHarness() {
    const { videoRef } = useVideoPlayer()

    return <video ref={videoRef} />
  }

  const renderResult = render(<HookHarness />)
  const video = renderResult.container.querySelector('video')
  if (!video) {
    throw new Error('Expected HookHarness to render a video element')
  }

  return { ...renderResult, video }
}

describe('useVideoPlayer', () => {
  beforeEach(() => {
    vi.resetModules()
    hlsMock.reset()
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe')
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('prefers hls.js when native HLS is also advertised', async () => {
    const { video } = await renderVideoPlayerHook()

    await waitFor(() => expect(hlsMock.instances).toHaveLength(1))
    await waitFor(() =>
      expect(hlsMock.instances[0].loadedSources[0]).toMatch(
        /^\/iptv\/session\/1\/hls\.m3u8\?ts=/,
      ),
    )

    expect(video.getAttribute('src')).toBeNull()
  })

  it('falls back to native HLS when hls.js is unavailable', async () => {
    hlsMock.setSupported(false)
    const { video } = await renderVideoPlayerHook()

    await waitFor(() =>
      expect(video.getAttribute('src')).toMatch(
        /^\/iptv\/session\/1\/hls\.m3u8\?ts=/,
      ),
    )

    expect(hlsMock.instances).toHaveLength(0)
  })
})
