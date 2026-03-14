import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSchedule } from './use-schedule'
import { api } from '../lib/api'

vi.mock('../lib/api', () => ({
  api: {
    schedule: {
      get: vi.fn(),
    },
  },
}))

describe('useSchedule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces offline state on initial failure and recovers on manual retry', async () => {
    const getSchedule = vi.mocked(api.schedule.get)
    getSchedule
      .mockResolvedValueOnce({
        data: {},
        response: {
          ok: false,
        } as Response,
      })
      .mockResolvedValueOnce({
        data: {
          refreshAfterMs: 60_000,
          schedule: [
            {
              title: 'Angel Cop',
              time: 'LIVE',
              live: true,
            },
          ],
        },
        response: {
          ok: true,
        } as Response,
      })

    const { result } = renderHook(() => useSchedule())

    await waitFor(() => {
      expect(result.current.scheduleState).toBe('offline')
    })
    expect(result.current.scheduleStatusDetail).toContain(
      'Unable to load the schedule yet',
    )

    act(() => {
      result.current.retrySchedule()
    })

    await waitFor(() => {
      expect(result.current.scheduleState).toBe('ready')
    })
    expect(result.current.schedule[0]?.title).toBe('Angel Cop')
  })
})
