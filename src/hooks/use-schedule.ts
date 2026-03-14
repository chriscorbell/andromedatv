import { useEffect, useState } from 'react'
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

const parseXmltvDate = (value?: string | null) => {
  if (!value) {
    return null
  }

  const [stamp, offset = ''] = value.trim().split(' ')
  if (!stamp || stamp.length < 14) {
    return null
  }

  const year = Number(stamp.slice(0, 4))
  const month = Number(stamp.slice(4, 6)) - 1
  const day = Number(stamp.slice(6, 8))
  const hour = Number(stamp.slice(8, 10))
  const minute = Number(stamp.slice(10, 12))
  const second = Number(stamp.slice(12, 14))

  let dateUtc = Date.UTC(year, month, day, hour, minute, second)

  if (offset && /^[+-]\d{4}$/.test(offset)) {
    const sign = offset.startsWith('-') ? -1 : 1
    const offsetHours = Number(offset.slice(1, 3))
    const offsetMinutes = Number(offset.slice(3, 5))
    const totalMinutes = sign * (offsetHours * 60 + offsetMinutes)
    dateUtc -= totalMinutes * 60_000
  }

  return new Date(dateUtc)
}

const formatTimeRange = (start?: Date, stop?: Date) => {
  if (!start || !stop) {
    return undefined
  }

  const options: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
  }
  const startLabel = start.toLocaleTimeString([], options)
  const stopLabel = stop.toLocaleTimeString([], options)
  return `${startLabel} - ${stopLabel}`
}

const cleanXmltvText = (value?: string | null) => {
  if (!value) {
    return undefined
  }

  const normalized = value.replace(/<br\s*\/?\s*>/gi, '\n')
  const container = document.createElement('div')
  container.innerHTML = normalized
  const text = container.textContent
    ?.replace(/\s+\n/g, '\n')
    .replace(/\n?\s*Source:\s*[^\n]+\s*$/i, '')
    .trim()
  return text || undefined
}

const parseEpisodePrefix = (program: Element) => {
  const episodeNode = program.querySelector('episode-num')
  if (!episodeNode) {
    return undefined
  }

  const system = episodeNode.getAttribute('system') || 'xmltv_ns'
  const raw = episodeNode.textContent?.trim()
  if (!raw) {
    return undefined
  }

  if (system === 'xmltv_ns') {
    const [seasonRaw, episodeRaw] = raw.split('.')
    const seasonIndex = Number(seasonRaw)
    const episodeIndex = Number(episodeRaw)
    if (Number.isFinite(seasonIndex) && Number.isFinite(episodeIndex)) {
      const season = String(seasonIndex + 1).padStart(2, '0')
      const episode = String(episodeIndex + 1).padStart(2, '0')
      return `S${season}E${episode}`
    }
  }

  const match = raw.match(/S(\d+)E(\d+)/i)
  if (match) {
    const season = String(Number(match[1])).padStart(2, '0')
    const episode = String(Number(match[2])).padStart(2, '0')
    return `S${season}E${episode}`
  }

  return undefined
}

export function useSchedule() {
  const [schedule, setSchedule] = useState<ScheduleItem[]>(fallbackSchedule)
  const [expandedScheduleKey, setExpandedScheduleKey] = useState<string | null>(
    null,
  )

  useEffect(() => {
    let cancelled = false
    let intervalId: number | null = null

    const loadSchedule = async () => {
      try {
        const response = await fetch('/iptv/xmltv.xml')
        if (!response.ok) {
          return
        }

        const xmlText = await response.text()
        const doc = new DOMParser().parseFromString(xmlText, 'text/xml')
        const allPrograms = Array.from(doc.querySelectorAll('programme'))
        const channelNodes = Array.from(doc.querySelectorAll('channel'))
        const channelMatch = channelNodes.find((channel) => {
          const names = Array.from(channel.querySelectorAll('display-name'))
            .map((node) => node.textContent?.trim()?.toLowerCase())
            .filter(Boolean)
          return (
            names.includes('1') ||
            names.includes('1 andromeda') ||
            names.includes('andromeda')
          )
        })
        const channelId = channelMatch?.getAttribute('id') ?? '1'
        const channelPrograms = allPrograms.filter(
          (program) => program.getAttribute('channel') === channelId,
        )
        const programs = channelPrograms.length ? channelPrograms : allPrograms

        const items = programs
          .map((program): ScheduleItem | null => {
            const title = program.querySelector('title')?.textContent?.trim()
            if (!title) {
              return null
            }

            const episodeTitle = cleanXmltvText(
              program.querySelector('sub-title')?.textContent,
            )
            const episodePrefix = parseEpisodePrefix(program)
            const episode = episodeTitle
              ? `${episodePrefix ? `${episodePrefix} ` : ''}${episodeTitle}`
              : episodePrefix
            const description = cleanXmltvText(
              program.querySelector('desc')?.textContent,
            )
            const start = parseXmltvDate(program.getAttribute('start')) || undefined
            const stop = parseXmltvDate(program.getAttribute('stop')) || undefined

            return {
              title,
              start,
              stop,
              ...(episode ? { episode } : {}),
              ...(description ? { description } : {}),
            }
          })
          .filter((item): item is ScheduleItem => item !== null)
          .sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0))

        if (!items.length || cancelled) {
          return
        }

        const now = new Date()
        const currentIndex = items.findIndex(
          (item) =>
            item.start && item.stop && item.start <= now && now < item.stop,
        )
        const startIndex = currentIndex >= 0 ? currentIndex : 0

        const sliced = items.slice(startIndex, startIndex + 25).map((item, idx) => {
          const isLive = idx === 0 && currentIndex >= 0
          return {
            ...item,
            live: isLive,
            time: isLive ? 'live' : formatTimeRange(item.start, item.stop),
          }
        })

        if (!cancelled) {
          setSchedule(sliced)
        }
      } catch (error) {
        console.warn('Failed to load schedule', error)
      }
    }

    void loadSchedule()

    intervalId = window.setInterval(() => {
      void loadSchedule()
    }, 10_000)

    return () => {
      cancelled = true
      if (intervalId) {
        window.clearInterval(intervalId)
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
