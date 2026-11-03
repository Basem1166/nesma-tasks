import Constants from 'expo-constants'
import * as SecureStore from 'expo-secure-store'
import type { User } from './types'

const RT_KEY = 'nesma.refreshToken'
const SERVER_KEY = 'nesma.serverUrl'

/**
 * Server URL, in priority order: a URL saved on the login screen,
 * EXPO_PUBLIC_API_URL, or (in development) the machine running Metro on port 4000.
 */
function defaultServer() {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL
  const host = Constants.expoConfig?.hostUri?.split(':')[0]
  return host ? `http://${host}:4000` : 'http://localhost:4000'
}

let serverUrl = defaultServer()
let accessToken: string | null = null
let refreshing: Promise<{ accessToken: string; user: User } | null> | null = null
let onSignedOut: (() => void) | null = null

export const getServerUrl = () => serverUrl
export const getAccessToken = () => accessToken
export const setSignedOutHandler = (fn: () => void) => {
  onSignedOut = fn
}

export async function loadServerUrl() {
  const saved = await SecureStore.getItemAsync(SERVER_KEY)
  if (saved) serverUrl = saved
  return serverUrl
}

export async function saveServerUrl(url: string) {
  serverUrl = url.replace(/\/+$/, '')
  await SecureStore.setItemAsync(SERVER_KEY, serverUrl)
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Mobile sessions keep the refresh token in the OS keystore (Keychain / Keystore). */
export async function storeSession(data: { accessToken: string; refreshToken: string }) {
  accessToken = data.accessToken
  await SecureStore.setItemAsync(RT_KEY, data.refreshToken)
}

/** Revokes the refresh token on the server, then forgets it locally. */
export async function revokeAndClearSession() {
  const refreshToken = await SecureStore.getItemAsync(RT_KEY)
  if (refreshToken) {
    await fetch(`${serverUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined)
  }
  await clearSession()
}

export async function clearSession() {
  accessToken = null
  await SecureStore.deleteItemAsync(RT_KEY)
}

export function refreshSession() {
  refreshing ??= (async () => {
    const refreshToken = await SecureStore.getItemAsync(RT_KEY)
    if (!refreshToken) return null
    try {
      const res = await fetch(`${serverUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken, client: 'mobile' }),
      })
      if (res.status === 401) {
        await clearSession()
        return null
      }
      if (!res.ok) return null
      const data = (await res.json()) as { accessToken: string; refreshToken: string; user: User }
      await storeSession(data)
      return { accessToken: data.accessToken, user: data.user }
    } catch {
      return null
    }
  })().finally(() => {
    refreshing = null
  })
  return refreshing
}

export async function api<T = unknown>(path: string, opts: { method?: string; json?: unknown } = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = {}
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  if (opts.json !== undefined) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(`${serverUrl}/api${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
    })
  } catch {
    throw new ApiError(0, `Can't reach the server at ${serverUrl}. Check your connection.`)
  }
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshSession()) return api<T>(path, opts, false)
    onSignedOut?.()
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = Array.isArray(data.details) ? data.details.map((d: { message: string }) => d.message).join('; ') : ''
    throw new ApiError(res.status, detail || data.error || `Request failed (${res.status})`)
  }
  return data as T
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong')
