import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SchedulePanel } from './schedule-panel'

vi.mock('./schedule-clock', () => ({
  ScheduleClock: function ScheduleClockMock() {
    return <span data-testid="schedule-clock">12:00:00 PM</span>
  },
}))

describe('SchedulePanel', () => {
  it('renders details for an expanded item and toggles clickable rows', () => {
    const handleToggle = vi.fn()
    const handleTooltipSync = vi.fn()

    render(
      <SchedulePanel
        expandedScheduleKey="Angel Cop-live"
        onToggleItem={handleToggle}
        onRetrySchedule={vi.fn()}
        schedule={[
          {
            title: 'Angel Cop',
            time: 'live',
            live: true,
            episode: 'S01E02 The Beginning',
            description: 'Pilot & more',
          },
          {
            title: 'Genocyber',
            time: '8:30 PM - 9:00 PM',
          },
        ]}
        scheduleState="ready"
        scheduleStatusDetail="Schedule is up to date."
        syncTitleTooltip={handleTooltipSync}
      />,
    )

    expect(screen.getByTestId('schedule-clock')).toBeInTheDocument()
    expect(screen.getByText('Angel Cop')).toBeInTheDocument()
    expect(screen.getByText('S01E02 The Beginning')).toBeInTheDocument()
    expect(screen.getByText('Pilot & more')).toBeInTheDocument()
    expect(screen.getByText('LIVE')).toBeInTheDocument()

    const expandedButton = screen.getByRole('button', { name: /angel cop/i })
    fireEvent.click(expandedButton)
    expect(handleToggle).toHaveBeenCalledWith('Angel Cop-live')

    const disabledButton = screen.getByRole('button', { name: /genocyber/i })
    expect(disabledButton).toBeDisabled()
  })

  it('syncs the title tooltip when hovering over a title', () => {
    const handleTooltipSync = vi.fn()

    render(
      <SchedulePanel
        expandedScheduleKey={null}
        onToggleItem={vi.fn()}
        onRetrySchedule={vi.fn()}
        schedule={[
          {
            title: 'Bubblegum Crisis',
            time: '9:00 PM - 9:30 PM',
            description: 'Classic OVA',
          },
        ]}
        scheduleState="ready"
        scheduleStatusDetail="Schedule is up to date."
        syncTitleTooltip={handleTooltipSync}
      />,
    )

    fireEvent.mouseEnter(screen.getByText('Bubblegum Crisis'))
    expect(handleTooltipSync).toHaveBeenCalledTimes(1)
    expect(handleTooltipSync.mock.calls[0]?.[0]).toBeInstanceOf(HTMLSpanElement)
  })

  it('formats schedule times in the viewer timezone from start and stop timestamps', () => {
    const startAt = '2026-03-15T15:50:00.000Z'
    const stopAt = '2026-03-15T16:20:00.000Z'
    const options: Intl.DateTimeFormatOptions = {
      hour: 'numeric',
      minute: '2-digit',
    }
    const expectedLabel = `${new Date(startAt).toLocaleTimeString([], options)} - ${new Date(stopAt).toLocaleTimeString([], options)}`

    render(
      <SchedulePanel
        expandedScheduleKey={null}
        onToggleItem={vi.fn()}
        onRetrySchedule={vi.fn()}
        schedule={[
          {
            title: 'Genocyber',
            startAt,
            stopAt,
          },
        ]}
        scheduleState="ready"
        scheduleStatusDetail="Schedule is up to date."
        syncTitleTooltip={vi.fn()}
      />,
    )

    expect(screen.getByText(expectedLabel)).toBeInTheDocument()
  })

  it('shows degraded schedule status and supports manual retry', () => {
    const handleRetry = vi.fn()

    render(
      <SchedulePanel
        expandedScheduleKey={null}
        onToggleItem={vi.fn()}
        onRetrySchedule={handleRetry}
        schedule={[
          {
            title: 'Angel Cop',
            time: 'LIVE',
            live: true,
          },
        ]}
        scheduleState="offline"
        scheduleStatusDetail="Unable to load the schedule yet. Retrying automatically..."
        syncTitleTooltip={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Unavailable')
    expect(
      screen.getByText('Unable to load the schedule yet. Retrying automatically...'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }))
    expect(handleRetry).toHaveBeenCalledTimes(1)
  })
})
