import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { relTime, useApi } from '../hooks'
import { useSession, useSocketEvent, useUser } from '../session'
import type { Notification } from '../types'
import { Avatar } from './ui'

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◧', end: true },
  { to: '/tasks', label: 'Tasks', icon: '☑' },
  { to: '/chat', label: 'Team chat', icon: '💬' },
  { to: '/assistant', label: 'AI assistant', icon: '✦' },
]
const LEADER_NAV = [
  { to: '/reports', label: 'AI reports', icon: '📊' },
  { to: '/team', label: 'Team', icon: '👥' },
  { to: '/automation', label: 'Automation', icon: '⚙' },
]

export function Layout() {
  const user = useUser()
  const { logout } = useSession()
  const links = user.role === 'LEADER' ? [...NAV, ...LEADER_NAV] : NAV

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">N</span> Nesma Tasks
        </div>
        <nav className="nav">
          {NAV.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end}>
              <span aria-hidden>{l.icon}</span> {l.label}
            </NavLink>
          ))}
          {user.role === 'LEADER' && <div className="nav-section">Team leader</div>}
          {user.role === 'LEADER' &&
            LEADER_NAV.map((l) => (
              <NavLink key={l.to} to={l.to}>
                <span aria-hidden>{l.icon}</span> {l.label}
              </NavLink>
            ))}
        </nav>
        <div className="sidebar-foot">
          <NavLink to="/profile" className="row" style={{ color: 'inherit' }}>
            <Avatar name={user.name} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{user.name}</div>
              <div className="small muted">{user.role === 'LEADER' ? 'Team leader' : 'Team member'}</div>
            </div>
          </NavLink>
          <button className="btn sm ghost" onClick={logout} style={{ justifyContent: 'flex-start' }}>Sign out</button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="row">
            <strong className="mobile-only-brand">Nesma Tasks</strong>
          </div>
          <div className="row">
            <NotificationsBell />
          </div>
        </header>
        <nav className="mobile-nav">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.to === '/'}>{l.label}</NavLink>
          ))}
          <NavLink to="/profile">Profile</NavLink>
        </nav>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function NotificationsBell() {
  const { data, reload, setData } = useApi<{ notifications: Notification[]; unread: number }>('/notifications')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useSocketEvent<Notification>('notification:new', (n) => {
    setData((d) => (d ? { notifications: [n, ...d.notifications].slice(0, 50), unread: d.unread + 1 } : d))
    if ('Notification' in window && window.Notification.permission === 'granted' && document.hidden) {
      new window.Notification(n.title, { body: n.body })
    }
  })

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const openNotif = async (n: Notification) => {
    if (!n.read) await api(`/notifications/${n.id}/read`, { method: 'POST' })
    setOpen(false)
    void reload()
    if (n.taskId) navigate(`/tasks/${n.taskId}`)
    else if (n.type === 'REPORT_READY') navigate('/reports')
  }

  const readAll = async () => {
    await api('/notifications/read-all', { method: 'POST' })
    void reload()
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="icon-btn"
        aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ''}`}
        onClick={() => {
          setOpen((o) => !o)
          if ('Notification' in window && window.Notification.permission === 'default') void window.Notification.requestPermission()
        }}
        style={{ fontSize: 20 }}
      >
        🔔
        {!!data?.unread && <span className="notif-dot">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className="popover">
          <div className="row" style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
            <h3>Notifications</h3>
            <span className="spacer" />
            {!!data?.unread && <button className="btn sm ghost" onClick={readAll}>Mark all read</button>}
          </div>
          {!data?.notifications.length && <div className="empty">You're all caught up.</div>}
          {data?.notifications.map((n) => (
            <div key={n.id} className={`notif ${n.read ? '' : 'unread'}`} onClick={() => openNotif(n)}>
              <div style={{ minWidth: 0 }}>
                <div className="t">{n.title}</div>
                <div className="b">{n.body}</div>
                <div className="small muted">{relTime(n.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
