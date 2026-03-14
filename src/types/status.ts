export type DiagnosticsStatusPayload = {
  server: {
    heartbeatActive: boolean
    nodeVersion: string
    privateChatClients: number
    publicChatClients: number
    rateLimitedUsers: number
    startedAt: string
    uptimeMs: number
  }
  schedule: {
    cacheExpiresAt: string | null
    itemCount: number | null
    lastDurationMs: number | null
    lastFailureAt: string | null
    lastFailureMessage: string | null
    lastFetchedAt: string | null
    lastRefreshAfterMs: number | null
    lastSuccessAt: string | null
    state: 'starting' | 'healthy' | 'degraded' | 'offline'
  }
  chat: {
    lastAdminActionAt: string | null
    lastAdminActionType: string | null
    lastAdminTarget: string | null
    lastAuthFailureAt: string | null
    lastAuthFailureReason: string | null
    lastMessageAt: string | null
    lastMessageNickname: string | null
    lastPrivateConnectAt: string | null
    lastPrivateDisconnectAt: string | null
    lastPublicConnectAt: string | null
    lastPublicDisconnectAt: string | null
    privateClients: number
    publicClients: number
  }
  iptv: {
    lastPlaylistRewriteAt: string | null
    lastPlaylistRewritePath: string | null
    lastProxyError: string | null
    lastProxyErrorAt: string | null
    lastProxyRequestAt: string | null
    lastProxyRequestPath: string | null
  }
}
