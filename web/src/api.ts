import type { User } from './types'

/**
 * The access token lives only in memory. The refresh token is an httpOnly
 * cookie the browser sends to /api/auth/refresh; JavaScript never sees it.
 */
let accessToken: string | null = null
let refreshing: Promise<{ accessToken: string; user: User } | null> | null = null
const listeners = new Set<(user: User | null) => void>()

export const getAccessToken = () => accessToken
export const onSessionChange = (fn: (user: User | null) => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export class ApiError extends Error {
  status: number
  details?: { path: string; message: string }[]
  constructor(status: number, message: string, details?: { path: string; message: string }[]) {
    super(message)
    this.status = status
    this.details = details
  }
}

export function setSession(token: string | null, user: User | null) {
  accessToken = token
  listeners.forEach((fn) => fn(user))
}

/** Single-flight refresh: concurrent 401s share one refresh request. */
export function refreshSession() {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    .then(async (r) => {
      if (!r.ok) return null
      const data = (await r.json()) as { accessToken: string; user: User }
      accessToken = data.accessToken
      return data
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers)
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  let body = init.body
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(init.json)
  }
  const res = await fetch(`/api${path}`, { ...init, headers, body, credentials: 'same-origin' })
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    const s = await refreshSession()
    if (s) return api<T>(path, init, false)
    setSession(null, null)
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.details)
  return data as T
}

export const errorText = (e: unknown) =>
  e instanceof ApiError && e.details?.length
    ? e.details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join('; ')
    : e instanceof Error
      ? e.message
      : 'Something went wrong'
