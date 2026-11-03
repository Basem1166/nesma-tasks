import { useCallback, useEffect, useState } from 'react'
import { api, errorText } from './api'

/** Fetch JSON on mount / when `path` changes, with a manual reload. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!path)

  const reload = useCallback(async () => {
    if (!path) return
    setLoading(true)
    try {
      setData(await api<T>(path))
      setError(null)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, error, loading, reload, setData }
}

export const fmtDate = (iso: string | null, withTime = false) =>
  iso
    ? new Date(iso).toLocaleString(undefined, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
    : '—'

export function relTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  const abs = Math.abs(diff)
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (abs < 60) return 'just now'
  if (abs < 3600) return fmt.format(-Math.round(diff / 60), 'minute')
  if (abs < 86400) return fmt.format(-Math.round(diff / 3600), 'hour')
  return fmt.format(-Math.round(diff / 86400), 'day')
}

export function dueLabel(iso: string | null, done: boolean) {
  if (!iso) return 'No deadline'
  if (done) return fmtDate(iso)
  const ms = new Date(iso).getTime() - Date.now()
  if (ms < 0) {
    const late = Math.floor(-ms / 86_400_000)
    return late >= 1 ? `${late} day${late > 1 ? 's' : ''} overdue` : 'Overdue'
  }
  const days = Math.floor(ms / 86_400_000)
  if (days === 0) return ms < 3_600_000 ? 'Due within the hour' : `Due in ${Math.floor(ms / 3_600_000)}h`
  if (days === 1) return 'Due tomorrow'
  return `Due in ${days} days`
}
