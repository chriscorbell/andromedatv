import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { DiagnosticsStatusPayload } from '../types/status'

const STATUS_REFRESH_MS = 15_000

export function useSystemStatus(enabled: boolean) {
  const [status, setStatus] = useState<DiagnosticsStatusPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    if (!enabled) {
      return
    }

    let cancelled = false
    let timeoutId: number | null = null

    const loadStatus = async () => {
      setLoading(true)

      try {
        const { data, response } = await api.status.get()
        if (!response.ok) {
          throw new Error('Failed to load diagnostics')
        }

        if (!cancelled) {
          setStatus(data)
          setError(null)
        }
      } catch (loadError) {
        console.warn('Failed to load diagnostics', loadError)
        if (!cancelled) {
          setError('Diagnostics are temporarily unavailable.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          timeoutId = window.setTimeout(() => {
            void loadStatus()
          }, STATUS_REFRESH_MS)
        }
      }
    }

    void loadStatus()

    return () => {
      cancelled = true
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [enabled, retryKey])

  return {
    error,
    loading,
    retry: () => setRetryKey((prev) => prev + 1),
    status,
  }
}
