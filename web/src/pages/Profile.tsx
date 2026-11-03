import { useState, type FormEvent } from 'react'
import { api, errorText } from '../api'
import { ErrorBox } from '../components/ui'
import { useSession, useUser } from '../session'
import type { User } from '../types'

export function Profile() {
  const user = useUser()
  const { setUser, logout } = useSession()
  const [name, setName] = useState(user.name)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' })
  const [pwError, setPwError] = useState<string | null>(null)

  const save = async (json: Partial<Pick<User, 'name' | 'emailNotifications'>>) => {
    try {
      const r = await api<{ user: User }>('/users/me/profile', { method: 'PATCH', json })
      setUser(r.user)
      setMsg('Saved')
      setError(null)
    } catch (e) {
      setError(errorText(e))
    }
  }

  const changePassword = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api('/auth/change-password', { method: 'POST', json: pw })
      alert('Password changed. Please sign in again.')
      await logout()
    } catch (err) {
      setPwError(errorText(err))
    }
  }

  return (
    <>
      <div className="page-head"><div><h1>Profile</h1><p>{user.email} · {user.role === 'LEADER' ? 'Team leader' : 'Team member'}</p></div></div>
      <div className="grid grid-2">
        <div className="card stack">
          <h2>Personal details</h2>
          <form className="row" onSubmit={(e) => { e.preventDefault(); void save({ name }) }}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" minLength={2} />
            <button className="btn">Save</button>
          </form>
          <label className="row">
            <input type="checkbox" checked={user.emailNotifications} onChange={(e) => save({ emailNotifications: e.target.checked })} />
            Email me about assignments, updates, deadlines and overdue tasks
          </label>
          {msg && <span className="small muted">{msg}</span>}
          <ErrorBox error={error} />
        </div>
        <form className="card stack" onSubmit={changePassword}>
          <h2>Change password</h2>
          <div className="field"><label htmlFor="cur">Current password</label><input id="cur" type="password" className="input" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required /></div>
          <div className="field"><label htmlFor="new">New password</label><input id="new" type="password" className="input" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required /><span className="small muted">At least 8 characters with upper- and lowercase letters and a digit. Changing it signs out all devices.</span></div>
          <ErrorBox error={pwError} />
          <div><button className="btn primary">Change password</button></div>
        </form>
      </div>
    </>
  )
}
