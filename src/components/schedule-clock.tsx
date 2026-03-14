import { useEffect, useRef, useState } from 'react'

const CLOCK_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour12: true,
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
}
const CLOCK_ANIMATION_MS = 220
const clockFormatter = new Intl.DateTimeFormat(undefined, CLOCK_TIME_FORMAT)

type ClockPart = {
  type: Intl.DateTimeFormatPartTypes
  value: string
}

const getClockParts = (date: Date) =>
  clockFormatter
    .formatToParts(date)
    .filter(
      (part) =>
        part.type === 'hour' ||
        part.type === 'minute' ||
        part.type === 'second' ||
        part.type === 'dayPeriod' ||
        part.type === 'literal',
    )

const areClockPartsEqual = (left: ClockPart[], right: ClockPart[]) =>
  left.length === right.length &&
  left.every(
    (part, index) =>
      part.type === right[index]?.type && part.value === right[index]?.value,
  )

const isAnimatedClockPartType = (
  type: Intl.DateTimeFormatPartTypes,
): type is 'hour' | 'minute' | 'second' =>
  type === 'hour' || type === 'minute' || type === 'second'

function AnimatedClockPart({
  type,
  value,
  previousValue,
}: {
  type: 'hour' | 'minute' | 'second'
  value: string
  previousValue?: string
}) {
  const width = type === 'hour' ? 2 : value.length
  const paddedValue = value.padStart(width, ' ')
  const paddedPreviousValue = previousValue?.padStart(width, ' ')
  const nextChars = Array.from(paddedValue)
  const previousChars = paddedPreviousValue
    ? Array.from(paddedPreviousValue)
    : undefined

  return (
    <span className="clock-part" data-type={type}>
      {nextChars.map((char, index) => {
        const previousChar = previousChars?.[index]
        const isAnimating = previousChar !== undefined && previousChar !== char
        const displayChar = char === ' ' ? '\u00A0' : char
        const previousDisplayChar =
          previousChar === ' ' ? '\u00A0' : previousChar

        return (
          <span
            key={`${type}-${index}`}
            className="clock-slot"
            data-animating={isAnimating}
          >
            {isAnimating ? (
              <>
                <span className="clock-char clock-char-previous" aria-hidden="true">
                  {previousDisplayChar}
                </span>
                <span className="clock-char clock-char-next">{displayChar}</span>
              </>
            ) : (
              <span className="clock-char">{displayChar}</span>
            )}
          </span>
        )
      })}
    </span>
  )
}

export function ScheduleClock() {
  const [clockParts, setClockParts] = useState<ClockPart[]>(() =>
    getClockParts(new Date()),
  )
  const [previousClockParts, setPreviousClockParts] = useState<ClockPart[] | null>(
    null,
  )
  const animationTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => {
      const nextClockParts = getClockParts(new Date())

      setClockParts((currentClockParts) => {
        if (areClockPartsEqual(currentClockParts, nextClockParts)) {
          return currentClockParts
        }

        if (animationTimeoutRef.current) {
          window.clearTimeout(animationTimeoutRef.current)
        }

        setPreviousClockParts(currentClockParts)
        animationTimeoutRef.current = window.setTimeout(() => {
          setPreviousClockParts(null)
          animationTimeoutRef.current = null
        }, CLOCK_ANIMATION_MS)

        return nextClockParts
      })
    }, 1000)

    return () => {
      window.clearInterval(timer)
      if (animationTimeoutRef.current) {
        window.clearTimeout(animationTimeoutRef.current)
      }
    }
  }, [])

  const clockLabel = clockParts.map((part) => part.value).join('')

  return (
    <span className="clock ml-auto text-zinc-500" aria-label={clockLabel}>
      {clockParts.map((part, index) =>
        part.type === 'literal' ? (
          <span
            key={`literal-${index}`}
            className="clock-literal"
            aria-hidden="true"
          >
            {part.value}
          </span>
        ) : part.type === 'dayPeriod' ? (
          <span
            key={`day-period-${index}`}
            className="clock-day-period"
            aria-hidden="true"
          >
            {part.value}
          </span>
        ) : isAnimatedClockPartType(part.type) ? (
          <AnimatedClockPart
            key={`${part.type}-${index}`}
            type={part.type}
            value={part.value}
            previousValue={
              previousClockParts?.[index]?.type === part.type
                ? previousClockParts[index].value
                : undefined
            }
          />
        ) : null,
      )}
    </span>
  )
}
