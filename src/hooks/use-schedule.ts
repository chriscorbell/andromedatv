import { useEffect, useState } from 'react'
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

export function useSchedule() {
  const [schedule, setSchedule] = useState<ScheduleItem[]>(fallbackSchedule)
  const [expandedScheduleKey, setExpandedScheduleKey] = useState<string | null>(
    null,
  )

  useEffect(() => {
    let cancelled = false
    let timeoutId: number | null = null

    const loadSchedule = async () => {
      try {
        const { data, response } = await api.schedule.get()
        if (!response.ok) {
          throw new Error('Failed to load normalized schedule')
        }

        if (!cancelled && data.schedule?.length) {
          setSchedule(data.schedule)
        }

        const nextRefreshMs = Math.min(
          Math.max(data.refreshAfterMs ?? 60_000, 15_000),
          5 * 60_000,
        )
        if (!cancelled) {
          timeoutId = window.setTimeout(() => {
            void loadSchedule()
          }, nextRefreshMs)
        }
      } catch (error) {
        console.warn('Failed to load schedule', error)
        if (!cancelled) {
          timeoutId = window.setTimeout(() => {
            void loadSchedule()
          }, 30_000)
        }
      }
    }

    void loadSchedule()

    return () => {
      cancelled = true
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [])

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

  return {
    expandedScheduleKey,
    schedule,
    syncScheduleTitleTooltip,
    toggleScheduleItem,
  }
}
