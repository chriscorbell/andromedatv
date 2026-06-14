import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronDown } from '@fortawesome/free-solid-svg-icons'
import { ServiceStatusBanner } from './service-status-banner'
import type { ScheduleItem } from '../types/schedule'

type SchedulePanelProps = {
  expandedScheduleKey: string | null
  getStreamDate?: () => number | null
  onToggleItem: (itemKey: string) => void
  schedule: ScheduleItem[]
  scheduleState: 'loading' | 'ready' | 'refreshing' | 'stale' | 'offline'
  scheduleStatusDetail: string
  syncTitleTooltip: (target: HTMLSpanElement) => void
}

function formatScheduleTime(item: ScheduleItem) {
  if (!item.startAt || !item.stopAt) {
    return item.time
  }

  const start = new Date(item.startAt)
  const stop = new Date(item.stopAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(stop.getTime())) {
    return item.time
  }

  const options: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
  }
  const startLabel = start.toLocaleTimeString([], options)
  const stopLabel = stop.toLocaleTimeString([], options)
  return `${startLabel} - ${stopLabel}`
}

type ItemBounds = { start: number; stop: number }

function getItemBounds(item: ScheduleItem): ItemBounds | null {
  if (!item.startAt || !item.stopAt) {
    return null
  }

  const start = new Date(item.startAt).getTime()
  const stop = new Date(item.stopAt).getTime()
  if (Number.isNaN(start) || Number.isNaN(stop) || stop <= start) {
    return null
  }

  return { start, stop }
}

function liveProgress(bounds: ItemBounds, now: number) {
  const progress = (now - bounds.start) / (bounds.stop - bounds.start)
  return Math.min(1, Math.max(0, progress))
}

export function SchedulePanel({
  expandedScheduleKey,
  getStreamDate,
  onToggleItem,
  schedule,
  scheduleState,
  scheduleStatusDetail,
  syncTitleTooltip,
}: SchedulePanelProps) {
  // "Now" for liveness/progress: prefer the stream's playhead time, falling back
  // to wall-clock when the player hasn't reported a position yet (before HLS
  // attaches, or no PDT). Held in state and re-sampled once a second so the live
  // row and progress bar keep pace with the stream between schedule polls. The
  // impure clock read happens in the effect, never during render.
  const [effectiveNow, setEffectiveNow] = useState(() => Date.now())
  useEffect(() => {
    const sampleNow = () => setEffectiveNow(getStreamDate?.() ?? Date.now())
    sampleNow()
    const intervalId = window.setInterval(sampleNow, 1000)
    return () => window.clearInterval(intervalId)
  }, [getStreamDate])

  return (
    <div className="flex h-[30vh] shrink-0 min-h-0 flex-col border-b border-[var(--color-edge)]">
      <div className="sec-head px-5 pt-4 pb-2.5">
        <span>schedule</span>
      </div>
      {scheduleState !== 'ready' && (
        <ServiceStatusBanner
          detail={scheduleStatusDetail}
          label="Schedule"
          state={
            scheduleState === 'loading'
              ? 'connecting'
              : scheduleState === 'refreshing'
                ? 'refreshing'
                : scheduleState
          }
        />
      )}
      <div className="scrollbar-minimal min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <ul className="flex flex-col gap-0.5">
          {schedule.map((item) => {
            const bounds = getItemBounds(item)

            // Drop shows the playhead has already passed so the live row sits at
            // the top of the list instead of trailing finished episodes.
            if (bounds && effectiveNow >= bounds.stop) {
              return null
            }

            // A row is live only once the playhead actually reaches it. Items
            // without timestamps fall back to the server's live hint.
            const isLive = bounds
              ? effectiveNow >= bounds.start && effectiveNow < bounds.stop
              : Boolean(item.live)

            const itemTime = formatScheduleTime(item)
            const itemKey = `${item.title}-${item.startAt ?? item.time ?? 'schedule-item'}`
            const isExpanded = expandedScheduleKey === itemKey
            const releaseInfo = item.airDate ?? item.year
            const hasDetails = Boolean(
              item.episode || releaseInfo || item.description,
            )
            const progress = isLive && bounds ? liveProgress(bounds, effectiveNow) : null

            return (
              <li
                key={itemKey}
                className={`schedule-item ${isLive ? 'schedule-row-live' : ''}`}
              >
                <button
                  type="button"
                  className="schedule-row flex w-full items-center gap-2 px-2 py-2.5 text-left transition-colors"
                  onClick={() => onToggleItem(itemKey)}
                  aria-expanded={isExpanded}
                  data-expanded={isExpanded}
                  data-clickable={hasDetails}
                  disabled={!hasDetails}
                >
                  {hasDetails && (
                    // Fixed-width box so the title's left edge is deterministic
                    // (px-2 + w-3 + gap-2 = 1.75rem) and the expanded details can
                    // align to it exactly — see .schedule-details padding-left.
                    <span className="flex w-3 shrink-0 items-center justify-center">
                      <FontAwesomeIcon
                        icon={faChevronDown}
                        className="schedule-chevron text-[11px]"
                      />
                    </span>
                  )}
                  <span className="schedule-title flex min-w-0 flex-1 items-center gap-2">
                    {isLive && <span className="now-dot" />}
                    <span
                      className="min-w-0 truncate"
                      data-full-title={item.title}
                      onMouseEnter={(event) =>
                        syncTitleTooltip(event.currentTarget)
                      }
                    >
                      {item.title}
                    </span>
                  </span>
                  {isLive ? (
                    <span className="live-label shrink-0 whitespace-nowrap">
                      LIVE
                    </span>
                  ) : (
                    <span className="schedule-time font-data shrink-0 whitespace-nowrap">
                      {itemTime}
                    </span>
                  )}
                </button>
                {isLive && progress !== null && (
                  <div className="schedule-progress">
                    <div style={{ width: `${progress * 100}%` }} />
                  </div>
                )}
                {hasDetails && (
                  <div
                    className="schedule-details"
                    data-expanded={isExpanded}
                  >
                    {(item.episode || releaseInfo) && (
                      <div className="schedule-meta">
                        {item.episode
                          ? `${item.episode}${releaseInfo ? ` – ${releaseInfo}` : ''}`
                          : `Movie – ${releaseInfo}`}
                      </div>
                    )}
                    {item.description && (
                      <p className="prose-body text-[var(--color-muted)]">
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
