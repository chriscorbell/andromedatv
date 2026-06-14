import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowsRotate,
  faClock,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'

type ServiceStatusBannerProps = {
  detail: string
  label: string
  state: 'connecting' | 'reconnecting' | 'refreshing' | 'stale' | 'offline'
}

type StatusTone = 'accent' | 'amber' | 'red'

type StatusConfig = {
  title: string
  icon: IconDefinition
  tone: StatusTone
  spin: boolean
}

const STATUS_CONFIG: Record<
  ServiceStatusBannerProps['state'],
  StatusConfig
> = {
  connecting: {
    title: 'Connecting',
    icon: faArrowsRotate,
    tone: 'accent',
    spin: true,
  },
  reconnecting: {
    title: 'Reconnecting',
    icon: faArrowsRotate,
    tone: 'accent',
    spin: true,
  },
  refreshing: {
    title: 'Refreshing',
    icon: faArrowsRotate,
    tone: 'accent',
    spin: true,
  },
  stale: { title: 'Delayed', icon: faClock, tone: 'amber', spin: false },
  offline: {
    title: 'Unavailable',
    icon: faTriangleExclamation,
    tone: 'red',
    spin: false,
  },
}

const TONE_CARD: Record<StatusTone, string> = {
  accent: 'border-[rgba(31,214,166,0.22)] bg-[rgba(31,214,166,0.06)]',
  amber: 'border-[rgba(245,158,11,0.22)] bg-[rgba(245,158,11,0.06)]',
  red: 'border-[rgba(247,118,142,0.22)] bg-[rgba(247,118,142,0.06)]',
}

const TONE_MARK: Record<StatusTone, string> = {
  accent: 'bg-[rgba(31,214,166,0.12)] text-[var(--color-accent)]',
  amber: 'bg-[rgba(245,158,11,0.13)] text-[#f3b765]',
  red: 'bg-[rgba(247,118,142,0.12)] text-[var(--color-accent-red)]',
}

const TONE_TITLE: Record<StatusTone, string> = {
  accent: 'text-[var(--color-accent)]',
  amber: 'text-[#f3b765]',
  red: 'text-[var(--color-accent-red)]',
}

export function ServiceStatusBanner({
  detail,
  label,
  state,
}: ServiceStatusBannerProps) {
  const { title, icon, tone, spin } = STATUS_CONFIG[state]

  return (
    <div
      role={state === 'offline' ? 'alert' : 'status'}
      aria-live={state === 'offline' ? 'assertive' : 'polite'}
      className={`mx-3 mb-2 mt-1 flex shrink-0 items-center gap-3 rounded-xl border px-3 py-2 text-[0.75rem] ${TONE_CARD[tone]}`}
    >
      <span
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[0.6875rem] ${TONE_MARK[tone]}`}
        aria-hidden="true"
      >
        <FontAwesomeIcon icon={icon} spin={spin} />
      </span>

      <div className="min-w-0 flex-1">
        <span className={`font-semibold ${TONE_TITLE[tone]}`}>
          {label} {title.toLowerCase()}
        </span>
        <p className="mt-0.5 text-[0.6875rem] leading-snug text-[var(--color-muted)]">
          {detail}
        </p>
      </div>
    </div>
  )
}
