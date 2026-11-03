import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppState } from 'react-native'
import { io, type Socket } from 'socket.io-client'
import { api, getAccessToken, getServerUrl, loadServerUrl, refreshSession, setSignedOutHandler, revokeAndClearSession, storeSession } from './api'
import { registerForPush, showLocalNotification, unregisterPush } from './push'
import type { User } from './types'

interface SessionValue {
  user: User | null
  ready: boolean
  socket: Socket | null
  pushStatus: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  setUser: (u: User) => void
}

const Ctx = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [socket, setSocket] = useState<Socket | null>(null)
  const [pushStatus, setPushStatus] = useState<string | null>(null)

  useEffect(() => {
    setSignedOutHandler(() => setUser(null))
    ;(async () => {
      await loadServerUrl()
      const s = await refreshSession()
      if (s) setUser(s.user)
      setReady(true)
    })()
  }, [])

  // Register this device for push and open the realtime channel once signed in.
  useEffect(() => {
    if (!user) return
    let remotePush = false
    registerForPush().then((r) => {
      remotePush = r.ok
      setPushStatus(r.ok ? 'enabled' : r.reason)
    })
    const s = io(getServerUrl(), { auth: (cb) => cb({ token: getAccessToken() }), transports: ['websocket'] })
    s.on('connect_error', async (err) => {
      if (err.message === 'unauthorized' && (await refreshSession())) s.connect()
    })
    // Without remote push, surface server notifications as local ones (no duplicates when push works).
    s.on('notification:new', (n: { title: string; body: string; taskId: string | null }) => {
      if (!remotePush) void showLocalNotification(n)
    })
    // Exposes the external socket connection to consumers; it is torn down below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSocket(s)
    // Reconnect promptly when the app returns to the foreground.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !s.connected) s.connect()
    })
    return () => {
      sub.remove()
      s.disconnect()
      setSocket(null)
    }
    // Only reconnect when the signed-in identity changes, not on profile edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<{ accessToken: string; refreshToken: string; user: User }>('/auth/login', {
      method: 'POST',
      json: { email, password, client: 'mobile' },
    })
    await storeSession(data)
    setUser(data.user)
  }, [])

  const logout = useCallback(async () => {
    await unregisterPush()
    await revokeAndClearSession()
    setUser(null)
  }, [])

  return (
    <Ctx.Provider value={{ user, ready, socket, pushStatus, login, logout, setUser }}>{children}</Ctx.Provider>
  )
}

export function useSession() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSession outside SessionProvider')
  return v
}

export function useUser(): User {
  const { user } = useSession()
  if (!user) throw new Error('Not signed in')
  return user
}

export function useSocketEvent<T>(event: string, handler: (payload: T) => void) {
  const { socket } = useSession()
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => {
    if (!socket) return
    const fn = (p: T) => ref.current(p)
    socket.on(event, fn)
    return () => {
      socket.off(event, fn)
    }
  }, [socket, event])
}
