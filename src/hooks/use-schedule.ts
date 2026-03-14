import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { ScheduleItem } from '../types/schedule'

const fallbackSchedule: ScheduleItem[] = [
  {
    title: 'Angel Cop',
    episode: 'S01E03 The Death Warrant',
    time: 'LIVE',
    description: 'A captured criminal reveals the depths of the Red May conspiracy.',
    live: true,
  },
  { title: 'Genocyber', time: '8:46 PM - 9:13 PM' },
  { title: 'Dragon Ball Z', time: '9:13 PM - 9:37 PM' },
  { title: 'Mobile Suit Gundam', time: '9:37 PM - 9:52 PM' },
  { title: 'Bubblegum Crisis: Tokyo 2040', time: '9:52 PM - 10:09 PM' },
  { title: 'Trigun', time: '10:09 PM - 10:25 PM' },
  { title: 'Cowboy Bebop', time: '10:25 PM - 10:41 PM' },
]

type ScheduleState = 'loading' | 'ready' | 'refreshing' | 'stale' | 'offline'

export function useSchedule() {
  const [schedule, setSchedule] = useState<ScheduleItem[]>(fallbackSchedule)
  const [expandedScheduleKey, setExpandedScheduleKey] = useState<string | null>(
    null,
  )
  const [scheduleState, setScheduleState] = useState<ScheduleState>('loading')
  const [scheduleStatusDetail, setScheduleStatusDetail] = useState(
    'Loading the latest schedule...',
  )
  const [reloadKey, setReloadKey] = useState(0)
  const hasLoadedLiveScheduleRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let timeoutId: number | null = null

    const setScheduleUiState = (
      nextState: ScheduleState,
      detail: string,
    ) => {
      setScheduleState((current) => (current === nextState ? current : nextState))
      setScheduleStatusDetail((current) => (current === detail ? current : detail))
    }

    const loadSchedule = async (reason: 'initial' | 'poll' | 'manual') => {
      if (!hasLoadedLiveScheduleRef.current) {
        setScheduleUiState('loading', 'Loading the latest schedule...')
      } else if (reason === 'manual') {
        setScheduleUiState('refreshing', 'Refreshing the schedule...')
      }

      try {
        const { data, response } = await api.schedule.get()
        if (!response.ok) {
          throw new Error('Failed to load normalized schedule')
        }

        if (!cancelled && Array.isArray(data.schedule) && data.schedule.length > 0) {
          hasLoadedLiveScheduleRef.current = true
          setSchedule(data.schedule)
        }
        if (!cancelled) {
          if (Array.isArray(data.schedule)) {
            hasLoadedLiveScheduleRef.current = true
          }
          setScheduleUiState('ready', 'Schedule is up to date.')
        }

        const nextRefreshMs = Math.min(
          Math.max(data.refreshAfterMs ?? 60_000, 15_000),
          5 * 60_000,
        )
        if (!cancelled) {
          timeoutId = window.setTimeout(() => {
            void loadSchedule('poll')
          }, nextRefreshMs)
        }
      } catch (error) {
        console.warn('Failed to load schedule', error)
        if (!cancelled) {
          if (hasLoadedLiveScheduleRef.current) {
            setScheduleUiState(
              'stale',
              'Showing the last known lineup while we retry.',
            )
          } else {
            setScheduleUiState(
              'offline',
              'Unable to load the schedule yet. Retrying automatically...',
            )
          }
          timeoutId = window.setTimeout(() => {
            void loadSchedule('poll')
          }, 30_000)
        }
      }
    }

    void loadSchedule(reloadKey === 0 ? 'initial' : 'manual')

    return () => {
      cancelled = true
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [reloadKey])

  const syncScheduleTitleTooltip = (target: HTMLSpanElement) => {
    const isTruncated = target.scrollWidth > target.clientWidth
    if (isTruncated) {
      target.title = target.dataset.fullTitle || target.textContent || ''
      return
    }

    target.removeAttribute('title')
  }

  const toggleScheduleItem = (itemKey: string) => {
    setExpandedScheduleKey((prev) => (prev === itemKey ? null : itemKey))
  }

  const retrySchedule = () => {
    setReloadKey((prev) => prev + 1)
  }

  return {
    expandedScheduleKey,
    schedule,
    scheduleState,
    scheduleStatusDetail,
    syncScheduleTitleTooltip,
    toggleScheduleItem,
    retrySchedule,
  }
}
