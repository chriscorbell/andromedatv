import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusPage } from './status-page'

describe('StatusPage', () => {
  it('renders a dedicated public diagnostics view', () => {
    render(
      <StatusPage
        diagnosticsError={null}
        diagnosticsLoading={false}
        diagnosticsStatus={{
          server: {
            heartbeatActive: true,
            nodeVersion: 'v22.0.0',
            privateChatClients: 1,
            publicChatClients: 2,
            rateLimitedUsers: 0,
            startedAt: new Date().toISOString(),
            uptimeMs: 120_000,
          },
          schedule: {
            cacheExpiresAt: new Date().toISOString(),
            itemCount: 12,
            lastDurationMs: 400,
            lastFailureAt: null,
            lastFailureMessage: null,
            lastFetchedAt: new Date().toISOString(),
            lastRefreshAfterMs: 60_000,
            lastSuccessAt: new Date().toISOString(),
            state: 'healthy',
          },
          chat: {
            lastAdminActionAt: null,
            lastAdminActionType: null,
            lastAdminTarget: null,
            lastAuthFailureAt: null,
            lastAuthFailureReason: null,
            lastMessageAt: new Date().toISOString(),
            lastMessageNickname: 'viewer1',
            lastPrivateConnectAt: null,
            lastPrivateDisconnectAt: null,
            lastPublicConnectAt: null,
            lastPublicDisconnectAt: null,
            privateClients: 1,
            publicClients: 2,
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
        onRetryDiagnostics={() => {}}
      />,
    )

    expect(screen.getByText('Service status')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'back to app' }),
    ).toHaveAttribute('href', '/')
    expect(screen.getByText(/public diagnostics/i)).toBeInTheDocument()
  })
})
