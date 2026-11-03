import { useState } from 'react'
import { api, errorText } from '../api'
import { ErrorBox, Loading, Modal } from '../components/ui'
import { fmtDate, useApi } from '../hooks'

interface Status {
  ai: { configured: boolean; provider: string; model: string }
  email: { mode: 'smtp' | 'log'; logged: number }
  push: { registeredDevices: number }
}
interface EmailRow {
  id: string
  to: string
  subject: string
  html: string
  status: string
  error: string | null
  eventType: string
  createdAt: string
}

const RULES: [string, string, string][] = [
  ['Task assigned / re-assigned', 'Assignee', 'In-app · push · email'],
  ['Task details edited', 'Assignee & creator', 'In-app · push · email'],
  ['Status changed', 'Assignee & creator (+ leaders when Done)', 'In-app · push · email'],
  ['Progress updated', 'Creator', 'In-app · push'],
  ['Comment added', 'Assignee & creator', 'In-app · push · email'],
  ['Deadline within 24 h', 'Assignee', 'In-app · push · email (once)'],
  ['Deadline passed', 'Assignee & all leaders', 'In-app · push · email (once)'],
  ['1st of the month, 07:00', 'Leaders', 'AI report generated · in-app · push · email'],
  ['Chat message', 'Rest of the team', 'Realtime · push'],
]

export function Automation() {
  const status = useApi<Status>('/system/status')
  const emails = useApi<{ emails: EmailRow[] }>('/system/emails')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<EmailRow | null>(null)

  const runChecks = async () => {
    setRunning(true)
    try {
      const r = await api<{ reminders: number; overdue: number }>('/system/run-deadline-checks', { method: 'POST' })
      setResult(`Sent ${r.reminders} deadline reminder(s) and ${r.overdue} overdue alert(s).`)
      void emails.reload()
      void status.reload()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setRunning(false)
    }
  }

  const s = status.data
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Automation</h1>
          <p>How events flow into notifications, emails and reports, and an audit log of every email sent.</p>
        </div>
        <button className="btn primary" onClick={runChecks} disabled={running}>{running ? 'Running…' : 'Run deadline checks now'}</button>
      </div>
      {result && <div className="alert info" style={{ marginBottom: 12 }}>{result}</div>}
      <ErrorBox error={error} />

      {s && (
        <div className="stats">
          <div className="card stat"><div className="label">AI ({s.ai.provider})</div><div className="value" style={{ fontSize: 18 }}>{s.ai.configured ? '✓ Connected' : '✕ Not configured'}</div><div className="hint">{s.ai.model}</div></div>
          <div className="card stat"><div className="label">Email delivery</div><div className="value" style={{ fontSize: 18 }}>{s.email.mode === 'smtp' ? '✓ SMTP' : 'Log mode'}</div><div className="hint">{s.email.logged} emails recorded</div></div>
          <div className="card stat"><div className="label">Push devices</div><div className="value">{s.push.registeredDevices}</div><div className="hint">Registered mobile devices</div></div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16, padding: 0 }}>
        <div style={{ padding: '16px 18px 0' }}><h2>Workflow rules</h2></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Trigger</th><th>Who is told</th><th>Channels</th></tr></thead>
            <tbody>{RULES.map(([t, w, c]) => <tr key={t}><td style={{ fontWeight: 550 }}>{t}</td><td className="secondary">{w}</td><td className="secondary">{c}</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 18px 0' }}>
          <h2>Email outbox</h2>
          {s?.email.mode === 'log' && <p className="small muted" style={{ marginTop: 4 }}>SMTP is not configured, so emails are rendered and recorded here instead of being delivered.</p>}
        </div>
        {!emails.data ? <Loading /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>To</th><th>Subject</th><th>Event</th><th>Status</th></tr></thead>
              <tbody>
                {emails.data.emails.map((e) => (
                  <tr key={e.id} className="clickable" onClick={() => setPreview(e)}>
                    <td className="small secondary" style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.createdAt, true)}</td>
                    <td className="small">{e.to}</td>
                    <td>{e.subject}</td>
                    <td><span className="badge">{e.eventType}</span></td>
                    <td><span className={`badge ${e.status === 'SENT' ? 'done' : e.status === 'FAILED' ? 'overdue' : ''}`} title={e.error ?? ''}>{e.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {emails.data.emails.length === 0 && <div className="empty">No emails yet.</div>}
          </div>
        )}
      </div>
      {preview && (
        <Modal title={preview.subject} onClose={() => setPreview(null)}>
          <p className="small muted" style={{ marginBottom: 8 }}>To {preview.to} · {fmtDate(preview.createdAt, true)}</p>
          <iframe title="Email preview" sandbox="" srcDoc={preview.html} style={{ width: '100%', height: 460, border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }} />
        </Modal>
      )}
    </>
  )
}
