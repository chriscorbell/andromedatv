import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VideoPlayer } from './video-player'

function renderVideoPlayer(
  overrides: Partial<ComponentProps<typeof VideoPlayer>> = {},
) {
  const defaultProps: ComponentProps<typeof VideoPlayer> = {
    controlsVisible: false,
    isMuted: true,
    onFullscreen: vi.fn(),
    onMouseEnter: vi.fn(),
    onMouseLeave: vi.fn(),
    onMouseMove: vi.fn(),
    onRetryPlayback: vi.fn(),
    onToggleMute: vi.fn(),
    onVolumeChange: vi.fn(),
    playbackState: 'live',
    playbackStatusDetail: 'Live now',
    videoFrameRef: { current: null },
    videoRef: { current: null },
    volume: 0.6,
  }

  return render(<VideoPlayer {...defaultProps} {...overrides} />)
}

describe('VideoPlayer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits 5 seconds before showing a connecting status overlay', () => {
    vi.useFakeTimers()

    renderVideoPlayer({
      playbackState: 'connecting',
      playbackStatusDetail: 'Connecting to live stream...',
    })

    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(4999)
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByRole('status')).toHaveTextContent(
      'connecting to live stream...',
    )
    expect(screen.getByText('connecting to live stream...')).toBeInTheDocument()
    expect(screen.queryByText('Live playback')).not.toBeInTheDocument()
    expect(screen.queryByText('Connecting stream')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'retry now' }),
    ).not.toBeInTheDocument()
  })

  it('shows retry affordances after the delay when playback stays offline', () => {
    vi.useFakeTimers()
    const handleRetryPlayback = vi.fn()

    renderVideoPlayer({
      onRetryPlayback: handleRetryPlayback,
      playbackState: 'offline',
      playbackStatusDetail: 'Stream unavailable. Retrying automatically...',
    })

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'stream unavailable. retrying automatically...',
    )
    expect(screen.queryByText('Live playback')).not.toBeInTheDocument()
    expect(screen.queryByText('Stream unavailable')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'retry now' }))
    expect(handleRetryPlayback).toHaveBeenCalledTimes(1)
  })

  it('hides degraded-state messaging once playback is live', () => {
    renderVideoPlayer()

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
