import { useState, type FormEvent } from 'react'
import { api, errorText } from '../api'
import { Avatar, ErrorBox, Loading, Modal } from '../components/ui'
import { fmtDate, useApi } from '../hooks'
import { useUser } from '../session'
import type { Role, TeamMember } from '../types'

export function Team() {
  const me = useUser()
  const { data, error, reload } = useApi<{ users: TeamMember[] }>('/users')
  const [adding, setAdding] = useState(false)
  const [resetFor, setResetFor] = useState<TeamMember | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const update = async (u: TeamMember, json: object) => {
    try {
      await api(`/users/${u.id}`, { method: 'PATCH', json })
      setActionError(null)
      void reload()
    } catch (e) {
      setActionError(errorText(e))
    }
  }

  if (!data) return error ? <ErrorBox error={error} /> : <Loading />

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <p>Each person has individual credentials and a role that controls what they can see and do.</p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>+ Add member</button>
      </div>
      <ErrorBox error={actionError} />
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Role</th><th>Open tasks</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id} style={{ opacity: u.active ? 1 : 0.55 }}>
                  <td>
                    <div className="row">
                      <Avatar name={u.name} />
                      <div><div style={{ fontWeight: 600 }}>{u.name}</div><div className="small muted">{u.email}{u.title ? ` · ${u.title}` : ''}</div></div>
                    </div>
                  </td>
                  <td>
                    <select className="input" style={{ width: 'auto' }} value={u.role} disabled={u.id === me.id} onChange={(e) => update(u, { role: e.target.value as Role })} aria-label={`Role for ${u.name}`}>
                      <option value="MEMBER">Member</option>
                      <option value="LEADER">Leader</option>
                    </select>
                  </td>
                  <td className="tabular">{u.openTasks}</td>
                  <td className="secondary small">{u.lastLoginAt ? fmtDate(u.lastLoginAt, true) : 'Never'}</td>
                  <td>{u.active ? <span className="badge done">Active</span> : <span className="badge">Deactivated</span>}</td>
                  <td>
                    {u.id !== me.id && (
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn sm" onClick={() => setResetFor(u)}>Reset password</button>
                        <button className="btn sm" onClick={() => update(u, { active: !u.active })}>{u.active ? 'Deactivate' : 'Reactivate'}</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {adding && <AddMember onClose={() => setAdding(false)} onDone={() => { setAdding(false); void reload() }} />}
      {resetFor && <ResetPassword user={resetFor} onClose={() => setResetFor(null)} />}
    </>
  )
}

const PW_HINT = 'At least 8 characters with upper- and lowercase letters and a digit.'

function AddMember({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', title: '', role: 'MEMBER' as Role, password: '' })
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api('/users', { method: 'POST', json: { ...form, title: form.title || undefined } })
      onDone()
    } catch (err) {
      setError(errorText(err))
    }
  }
  return (
    <Modal title="Add team member" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <div className="field"><label htmlFor="m-name">Full name</label><input id="m-name" className="input" value={form.name} onChange={set('name')} required /></div>
        <div className="field"><label htmlFor="m-email">Email</label><input id="m-email" type="email" className="input" value={form.email} onChange={set('email')} required /></div>
        <div className="field"><label htmlFor="m-title">Job title</label><input id="m-title" className="input" value={form.title} onChange={set('title')} /></div>
        <div className="field">
          <label htmlFor="m-role">Role</label>
          <select id="m-role" className="input" value={form.role} onChange={set('role')}><option value="MEMBER">Member</option><option value="LEADER">Leader</option></select>
        </div>
        <div className="field full">
          <label htmlFor="m-pass">Temporary password</label>
          <input id="m-pass" type="text" className="input" value={form.password} onChange={set('password')} required autoComplete="new-password" />
          <span className="small muted">{PW_HINT} Share it with the person directly; it is never emailed.</span>
        </div>
        <div className="full"><ErrorBox error={error} /></div>
        <div className="full row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Create account</button></div>
      </form>
    </Modal>
  )
}

function ResetPassword({ user, onClose }: { user: TeamMember; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api(`/users/${user.id}`, { method: 'PATCH', json: { password } })
      setDone(true)
    } catch (err) {
      setError(errorText(err))
    }
  }
  return (
    <Modal title={`Reset password · ${user.name}`} onClose={onClose}>
      {done ? (
        <div className="stack"><div className="alert info">Password updated. All of {user.name}'s sessions were signed out.</div><button className="btn" onClick={onClose}>Close</button></div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <div className="field"><label htmlFor="r-pass">New password</label><input id="r-pass" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" /><span className="small muted">{PW_HINT}</span></div>
          <ErrorBox error={error} />
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary">Set password</button></div>
        </form>
      )}
    </Modal>
  )
}
