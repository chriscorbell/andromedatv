import { ScheduleClock } from './schedule-clock'
import { ServiceStatusBanner } from './service-status-banner'
import type { ScheduleItem } from '../types/schedule'

type SchedulePanelProps = {
  expandedScheduleKey: string | null
  onToggleItem: (itemKey: string) => void
  onRetrySchedule: () => void
  schedule: ScheduleItem[]
  scheduleState: 'loading' | 'ready' | 'refreshing' | 'stale' | 'offline'
  scheduleStatusDetail: string
  syncTitleTooltip: (target: HTMLSpanElement) => void
}

export function SchedulePanel({
  expandedScheduleKey,
  onToggleItem,
  onRetrySchedule,
  schedule,
  scheduleState,
  scheduleStatusDetail,
  syncTitleTooltip,
}: SchedulePanelProps) {
  return (
    <div className="flex min-h-0 flex-[1] flex-col">
      <header className="flex h-12 items-center border-b border-zinc-800 px-4 text-xs text-zinc-300">
        <span className="ui-header font-extrabold">schedule</span>
        <ScheduleClock />
      </header>
      {scheduleState !== 'ready' && (
        <ServiceStatusBanner
          detail={scheduleStatusDetail}
          label="schedule sync"
          onRetry={
            scheduleState === 'loading' ? undefined : onRetrySchedule
          }
          state={
            scheduleState === 'loading'
              ? 'connecting'
              : scheduleState === 'refreshing'
                ? 'refreshing'
                : scheduleState
          }
        />
      )}
      <div className="scrollbar-minimal min-h-0 flex-1 overflow-y-auto">
        <ul className="divide-y divide-zinc-800">
          {schedule.map((item) => {
            const itemKey = `${item.title}-${item.time}`
            const isExpanded = expandedScheduleKey === itemKey
            const hasDetails = Boolean(item.episode || item.description)

            return (
              <li
                key={itemKey}
                className="text-zinc-300"
              >
                <button
                  type="button"
                  className={`schedule-row flex w-full items-center gap-3 rounded-md px-4 py-3 text-left text-zinc-100 transition ${hasDetails ? 'hover:bg-zinc-900/60 hover:text-white' : ''}`}
                  onClick={() => onToggleItem(itemKey)}
                  aria-expanded={isExpanded}
                  data-expanded={isExpanded}
                  data-clickable={hasDetails}
                  disabled={!hasDetails}
                >
                  <span
                    className="min-w-0 flex-1 truncate text-zinc-400"
                    data-full-title={item.title}
                    onMouseEnter={(event) =>
                      syncTitleTooltip(event.currentTarget)
                    }
                  >
                    {item.title}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 whitespace-nowrap">
                    {item.live ? (
                      <span className="flex items-center gap-2 whitespace-nowrap text-zinc-200">
                        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-accent-red)]" />
                        LIVE
                      </span>
                    ) : (
                      <span className="whitespace-nowrap text-zinc-500">
                        {item.time}
                      </span>
                    )}
                    {hasDetails && (
                      <svg
                        viewBox="0 0 24 24"
                        className="schedule-chevron h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    )}
                  </span>
                </button>
                {hasDetails && (
                  <div
                    className="schedule-details"
                    data-expanded={isExpanded}
                  >
                    {item.episode && (
                      <div className="text-xs text-zinc-500">
                        {item.episode}
                      </div>
                    )}
                    {item.description && (
                      <p className="text-xs text-zinc-400">
                        {item.description}
                      </p>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
