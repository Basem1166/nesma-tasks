import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { io, type Socket } from 'socket.io-client'
import { api, getAccessToken, onSessionChange, refreshSession, setSession } from './api'
import type { User } from './types'

interface SessionValue {
  user: User | null
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  setUser: (u: User) => void
  socket: Socket | null
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [socket, setSocket] = useState<Socket | null>(null)

  useEffect(() => onSessionChange(setUserState), [])

  // Restore the session from the refresh cookie on first load.
  useEffect(() => {
    refreshSession().then((s) => {
      if (s) setSession(s.accessToken, s.user)
      setReady(true)
    })
  }, [])

  // One realtime connection per signed-in user.
  useEffect(() => {
    if (!user) return
    const s = io({ auth: (cb) => cb({ token: getAccessToken() }), transports: ['websocket'] })
    s.on('connect_error', async (err) => {
      if (err.message === 'unauthorized' && (await refreshSession())) s.connect()
    })
    setSocket(s)
    return () => {
      s.disconnect()
      setSocket(null)
    }
  }, [user?.id])

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<{ accessToken: string; user: User }>('/auth/login', { method: 'POST', json: { email, password } })
    setSession(data.accessToken, data.user)
  }, [])

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST', json: {} }).catch(() => undefined)
    setSession(null, null)
  }, [])

  const setUser = useCallback((u: User) => setUserState(u), [])

  return (
    <SessionContext.Provider value={{ user, ready, login, logout, setUser, socket }}>{children}</SessionContext.Provider>
  )
}

export function useSession() {
  const v = useContext(SessionContext)
  if (!v) throw new Error('useSession outside provider')
  return v
}

/** The signed-in user; only call inside authenticated routes. */
export function useUser(): User {
  const { user } = useSession()
  if (!user) throw new Error('No user')
  return user
}

/** Subscribe to a realtime event for the lifetime of the component. */
export function useSocketEvent<T>(event: string, handler: (payload: T) => void) {
  const { socket } = useSession()
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!socket) return
    const fn = (p: T) => ref.current(p)
    socket.on(event, fn)
    return () => {
      socket.off(event, fn)
    }
  }, [socket, event])
}
