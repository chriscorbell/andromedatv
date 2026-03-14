import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
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
  it('shows a connecting status overlay while the stream is starting', () => {
    renderVideoPlayer({
      playbackState: 'connecting',
      playbackStatusDetail: 'Connecting to live stream...',
    })

    expect(screen.getByRole('status')).toHaveTextContent('Connecting stream')
    expect(screen.getByText('Connecting to live stream...')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Retry now' }),
    ).not.toBeInTheDocument()
  })

  it('offers an immediate retry action when playback is offline', () => {
    const handleRetryPlayback = vi.fn()

    renderVideoPlayer({
      onRetryPlayback: handleRetryPlayback,
      playbackState: 'offline',
      playbackStatusDetail: 'Stream unavailable. Retrying automatically...',
    })

    expect(screen.getByRole('alert')).toHaveTextContent('Stream unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }))
    expect(handleRetryPlayback).toHaveBeenCalledTimes(1)
  })

  it('hides degraded-state messaging once playback is live', () => {
    renderVideoPlayer()

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
