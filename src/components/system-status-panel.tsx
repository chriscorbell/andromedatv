import type { ReactNode } from 'react'
import type { DiagnosticsStatusPayload } from '../types/status'

type SystemStatusPanelProps = {
  error: string | null
  loading: boolean
  onRetry: () => void
  status: DiagnosticsStatusPayload | null
}

function formatRelativeTime(value: string | null) {
  if (!value) {
    return 'not yet'
  }

  const deltaMs = Date.now() - Date.parse(value)
  if (!Number.isFinite(deltaMs)) {
    return 'unknown'
  }

  const seconds = Math.max(0, Math.round(deltaMs / 1000))
  if (seconds < 60) {
    return `${seconds}s ago`
  }

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ago`
  }

  const hours = Math.round(minutes / 60)
  return `${hours}h ago`
}

function formatDuration(ms: number | null) {
  if (ms === null) {
    return 'n/a'
  }

  if (ms < 1000) {
    return `${ms}ms`
  }

  return `${(ms / 1000).toFixed(1)}s`
}

function formatUptime(ms: number) {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }

  return `${seconds}s`
}

function getStateClass(state: string) {
  switch (state) {
    case 'healthy':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
    case 'degraded':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-100'
    case 'offline':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-100'
    default:
      return 'border-sky-500/30 bg-sky-500/10 text-zinc-100'
  }
}

function StatusCard({
  children,
  title,
}: {
  children: ReactNode
  title: string
}) {
  return (
    <section className="border border-zinc-800 bg-black/30 p-4">
      <h3 className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">
        {title}
      </h3>
      <div className="mt-3 space-y-2 text-sm text-zinc-300">{children}</div>
    </section>
  )
}

function MetricRow({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-zinc-500">{label}</span>
      <span className="text-right text-zinc-200">{value}</span>
    </div>
  )
}

export function SystemStatusPanel({
  error,
  loading,
  onRetry,
  status,
}: SystemStatusPanelProps) {
  return (
    <section className="mt-5 border border-zinc-800 bg-[#070707] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="ui-header text-sm font-extrabold text-zinc-100">
            diagnostics
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Live backend health, schedule freshness, and chat activity.
          </p>
        </div>
        <button
          type="button"
          className="border border-zinc-700 px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-zinc-200 transition hover:border-zinc-400"
          onClick={onRetry}
        >
          Refresh
        </button>
      </div>

      {loading && (
        <div className="mt-4 border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-zinc-100">
          Refreshing diagnostics…
        </div>
      )}

      {error && (
        <div className="mt-4 border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {error}
        </div>
      )}

      {status && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <StatusCard title="server">
            <MetricRow label="Uptime" value={formatUptime(status.server.uptimeMs)} />
            <MetricRow label="Node" value={status.server.nodeVersion} />
            <MetricRow
              label="SSE heartbeat"
              value={status.server.heartbeatActive ? 'active' : 'idle'}
            />
            <MetricRow
              label="Chat clients"
              value={`${status.server.publicChatClients} public / ${status.server.privateChatClients} private`}
            />
          </StatusCard>

          <StatusCard title="schedule">
            <div
              className={`inline-flex w-fit border px-2 py-1 text-[10px] uppercase tracking-[0.2em] ${getStateClass(status.schedule.state)}`}
            >
              {status.schedule.state}
            </div>
            <MetricRow
              label="Last success"
              value={formatRelativeTime(status.schedule.lastSuccessAt)}
            />
            <MetricRow
              label="Last fetch"
              value={formatRelativeTime(status.schedule.lastFetchedAt)}
            />
            <MetricRow
              label="Last duration"
              value={formatDuration(status.schedule.lastDurationMs)}
            />
            <MetricRow
              label="Lineup items"
              value={status.schedule.itemCount ?? 'n/a'}
            />
            {status.schedule.lastFailureMessage && (
              <div className="border border-zinc-800 bg-black/30 px-3 py-2 text-xs text-zinc-400">
                Last error: {status.schedule.lastFailureMessage}
              </div>
            )}
          </StatusCard>

          <StatusCard title="chat">
            <MetricRow
              label="Last message"
              value={formatRelativeTime(status.chat.lastMessageAt)}
            />
            <MetricRow
              label="Last sender"
              value={status.chat.lastMessageNickname ?? 'n/a'}
            />
            <MetricRow
              label="Last admin action"
              value={
                status.chat.lastAdminActionType
                  ? `${status.chat.lastAdminActionType} (${status.chat.lastAdminTarget ?? 'n/a'})`
                  : 'none'
              }
            />
            <MetricRow
              label="Last auth failure"
              value={status.chat.lastAuthFailureReason ?? 'none'}
            />
          </StatusCard>

          <StatusCard title="stream proxy">
            <MetricRow
              label="Last proxy hit"
              value={formatRelativeTime(status.iptv.lastProxyRequestAt)}
            />
            <MetricRow
              label="Last rewritten playlist"
              value={formatRelativeTime(status.iptv.lastPlaylistRewriteAt)}
            />
            <MetricRow
              label="Rewrite path"
              value={status.iptv.lastPlaylistRewritePath ?? 'n/a'}
            />
            <MetricRow
              label="Last proxy error"
              value={status.iptv.lastProxyError ?? 'none'}
            />
          </StatusCard>
        </div>
      )}
    </section>
  )
}
