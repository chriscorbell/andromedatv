import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SystemStatusPanel } from './system-status-panel'

describe('SystemStatusPanel', () => {
  it('renders diagnostics data and supports manual refresh', () => {
    const handleRetry = vi.fn()

    render(
      <SystemStatusPanel
        error={null}
        loading={false}
        onRetry={handleRetry}
        status={{
          server: {
            heartbeatActive: true,
            nodeVersion: 'v22.0.0',
            privateChatClients: 1,
            publicChatClients: 3,
            rateLimitedUsers: 0,
            startedAt: new Date().toISOString(),
            uptimeMs: 98_000,
          },
          schedule: {
            cacheExpiresAt: new Date().toISOString(),
            itemCount: 7,
            lastDurationMs: 420,
            lastFailureAt: null,
            lastFailureMessage: null,
            lastFetchedAt: new Date().toISOString(),
            lastRefreshAfterMs: 60_000,
            lastSuccessAt: new Date().toISOString(),
            state: 'healthy',
          },
          chat: {
            lastAdminActionAt: new Date().toISOString(),
            lastAdminActionType: 'warn_user',
            lastAdminTarget: 'noisyuser',
            lastAuthFailureAt: null,
            lastAuthFailureReason: null,
            lastMessageAt: new Date().toISOString(),
            lastMessageNickname: 'pilot',
            lastPrivateConnectAt: null,
            lastPrivateDisconnectAt: null,
            lastPublicConnectAt: null,
            lastPublicDisconnectAt: null,
            privateClients: 1,
            publicClients: 3,
          },
          iptv: {
            lastPlaylistRewriteAt: new Date().toISOString(),
            lastPlaylistRewritePath: '/session/1/hls.m3u8',
            lastProxyError: null,
            lastProxyErrorAt: null,
            lastProxyRequestAt: new Date().toISOString(),
            lastProxyRequestPath: '/session/1/hls.m3u8',
          },
        }}
      />,
    )

    expect(screen.getByText('diagnostics')).toBeInTheDocument()
    expect(screen.getByText('healthy')).toBeInTheDocument()
    expect(screen.getByText('pilot')).toBeInTheDocument()
    expect(screen.getByText('/session/1/hls.m3u8')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(handleRetry).toHaveBeenCalledTimes(1)
  })
})
