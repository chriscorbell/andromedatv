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
  accent: 'border-accent/22 bg-accent/6',
  amber: 'border-warning/22 bg-warning/6',
  red: 'border-accent-red/22 bg-accent-red/6',
}

const TONE_MARK: Record<StatusTone, string> = {
  accent: 'bg-accent/12 text-accent',
  amber: 'bg-warning/13 text-warning-text',
  red: 'bg-accent-red/12 text-accent-red',
}

const TONE_TITLE: Record<StatusTone, string> = {
  accent: 'text-accent',
  amber: 'text-warning-text',
  red: 'text-accent-red',
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
      className={`mx-3 mb-2 mt-1 flex shrink-0 items-center gap-3 rounded-xl border px-3 py-2 text-16 ${TONE_CARD[tone]}`}
    >
      <span
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-15 ${TONE_MARK[tone]}`}
        aria-hidden="true"
      >
        <FontAwesomeIcon icon={icon} spin={spin} />
      </span>

      <div className="min-w-0 flex-1">
        <span className={`font-semibold ${TONE_TITLE[tone]}`}>
          {label} {title.toLowerCase()}
        </span>
        <p className="mt-0.5 text-15 leading-snug text-[var(--color-muted)]">
          {detail}
        </p>
      </div>
    </div>
  )
}
