type ServiceStatusBannerProps = {
  detail: string
  label: string
  onRetry?: () => void
  retryLabel?: string
  state: 'connecting' | 'reconnecting' | 'refreshing' | 'stale' | 'offline'
}

function getStatusTitle(state: ServiceStatusBannerProps['state']) {
  switch (state) {
    case 'connecting':
      return 'Connecting'
    case 'reconnecting':
      return 'Reconnecting'
    case 'refreshing':
      return 'Refreshing'
    case 'stale':
      return 'Delayed'
    case 'offline':
      return 'Unavailable'
  }
}

function getStatusClasses(state: ServiceStatusBannerProps['state']) {
  switch (state) {
    case 'offline':
      return 'border-[rgba(247,118,142,0.3)] bg-[rgba(247,118,142,0.1)] text-[var(--color-accent-red)]'
    case 'stale':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-100'
    default:
      return 'border-[rgba(31,214,166,0.3)] bg-[var(--color-acc-tint)] text-[var(--color-app-fg)]'
  }
}

export function ServiceStatusBanner({
  detail,
  label,
  onRetry,
  retryLabel = 'Retry now',
  state,
}: ServiceStatusBannerProps) {
  return (
    <div
      role={state === 'offline' ? 'alert' : 'status'}
      aria-live={state === 'offline' ? 'assertive' : 'polite'}
      className={`flex items-center gap-3 border-b px-4 py-2.5 text-xs ${getStatusClasses(state)}`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-[0.24em] text-zinc-400">
          {label}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold uppercase tracking-[0.18em]">
            {getStatusTitle(state)}
          </span>
          <span className="min-w-0 text-zinc-200">{detail}</span>
        </div>
      </div>
      {onRetry && (
        <button
          type="button"
          className="shrink-0 border border-zinc-500 bg-black/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-zinc-100 transition hover:border-zinc-300"
          onClick={onRetry}
        >
          {retryLabel}
        </button>
      )}
    </div>
  )
}
