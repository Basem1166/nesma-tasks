import { useCallback, useEffect, useState } from 'react'
import { api, errorText } from './api'

/** Fetch on mount; `refresh` powers pull-to-refresh, `reload` is silent. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const reload = useCallback(async () => {
    if (!path) return
    try {
      setData(await api<T>(path))
      setError(null)
    } catch (e) {
      setError(errorText(e))
    }
  }, [path])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await reload()
    setRefreshing(false)
  }, [reload])

  useEffect(() => {
    // Fetch-on-mount: state is set after the network response, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()
  }, [reload])

  return { data, error, refreshing, reload, refresh, setData }
}
