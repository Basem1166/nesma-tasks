import { useState, type FormEvent } from 'react'
import { errorText } from '../api'
import { ErrorBox } from '../components/ui'
import { useSession } from '../session'

const DEMO = [
  ['leader@nesma.dev', 'Team leader'],
  ['sara@nesma.dev', 'Member'],
  ['youssef@nesma.dev', 'Member'],
] as const

export function Login() {
  const { login } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="card login">
        <div className="brand" style={{ padding: '0 0 14px' }}>
          <span className="brand-mark">N</span> Nesma Tasks
        </div>
        <h1 style={{ marginBottom: 4 }}>Sign in</h1>
        <p className="secondary" style={{ marginBottom: 18 }}>Team communication, tasks and AI reporting.</p>
        <form className="stack" onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" className="input" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <ErrorBox error={error} />
          <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        {(import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_ACCOUNTS === 'true') && (
          <div className="demo-accounts">
            Demo accounts (password <code>Nesma@2026</code>):
            <br />
            {DEMO.map(([e, r]) => (
              <span key={e}>
                <button type="button" onClick={() => { setEmail(e); setPassword('Nesma@2026') }}>{e}</button> · {r}
                <br />
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
