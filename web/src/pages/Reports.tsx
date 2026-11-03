import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, errorText } from '../api'
import { ErrorBox, Loading, Markdown, Spinner } from '../components/ui'
import { fmtDate, useApi } from '../hooks'
import type { PeriodSummary, Report, ReportSummary } from '../types'

const monthName = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })

export function Reports() {
  const navigate = useNavigate()
  const { data, error } = useApi<{ reports: ReportSummary[] }>('/reports')
  const now = new Date()
  const last = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1))
  const [year, setYear] = useState(last.getUTCFullYear())
  const [month, setMonth] = useState(last.getUTCMonth() + 1)
  const [busy, setBusy] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  const generate = async () => {
    setBusy(true)
    setGenError(null)
    try {
      const { report } = await api<{ report: Report }>('/reports/generate', { method: 'POST', json: { year, month } })
      navigate(`/reports/${report.id}`)
    } catch (e) {
      setGenError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>AI reports</h1>
          <p>Monthly team reports computed from task data and written by AI. Generated automatically on the 1st of each month.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginBottom: 12 }}>Generate a report now</h2>
        <div className="row wrap">
          <select className="input" style={{ width: 'auto' }} value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Month">
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i + 1}>{new Date(2000, i, 1).toLocaleString(undefined, { month: 'long' })}</option>
            ))}
          </select>
          <input className="input" style={{ width: 100 }} type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year" />
          <button className="btn primary" onClick={generate} disabled={busy}>{busy ? <><Spinner /> Analysing…</> : 'Generate report'}</button>
        </div>
        {busy && <p className="small muted" style={{ marginTop: 8 }}>The AI is analysing the month's data. This usually takes 20-60 seconds.</p>}
        <div style={{ marginTop: 10 }}><ErrorBox error={genError} /></div>
      </div>

      <ErrorBox error={error} />
      {!data ? <Loading /> : (
        <div className="card" style={{ padding: 0 }}>
          <table className="table">
            <thead><tr><th>Period</th><th>Written by</th><th>Generated</th><th>Trigger</th></tr></thead>
            <tbody>
              {data.reports.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => navigate(`/reports/${r.id}`)}>
                  <td style={{ fontWeight: 600 }}>{monthName(r.periodStart)}</td>
                  <td>{r.aiGenerated ? <span className="badge done">✦ {r.model}</span> : <span className="badge">Rule-based</span>}</td>
                  <td className="secondary">{fmtDate(r.createdAt, true)}</td>
                  <td className="secondary">{r.generatedBy ? `Manual · ${r.generatedBy.name}` : 'Scheduled'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.reports.length === 0 && <div className="empty">No reports yet. Generate one above.</div>}
        </div>
      )}
    </>
  )
}

export function ReportView() {
  const { id } = useParams()
  const { data, error } = useApi<{ report: Report }>(`/reports/${id}`)
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  const r = data.report
  const s = r.metrics.summary
  const p = r.metrics.previous

  return (
    <>
      <div className="small" style={{ marginBottom: 12 }}><Link to="/reports">← All reports</Link></div>
      <div className="page-head">
        <div>
          <h1>Team report · {r.metrics.periodLabel}</h1>
          <p>
            {r.aiGenerated ? `Written by ${r.model} from live task data` : 'Rule-based summary (AI unavailable)'} · generated {fmtDate(r.createdAt, true)}
          </p>
        </div>
        <button className="btn" onClick={() => window.print()}>Print / PDF</button>
      </div>
      <div className="stats">
        <Kpi label="Completion rate" value={s.completionRate} prev={p.completionRate} unit="%" />
        <Kpi label="On-time delivery" value={s.onTimeRate} prev={p.onTimeRate} unit="%" />
        <Kpi label="Tasks completed" value={s.completed} prev={p.completed} />
        <Kpi label="Overdue at month end" value={s.overdueOpen} prev={p.overdueOpen} lowerIsBetter />
        <Kpi label="Avg cycle time" value={s.avgCycleDays} prev={p.avgCycleDays} unit=" d" lowerIsBetter />
      </div>
      <div className="card"><Markdown>{r.narrative}</Markdown></div>
    </>
  )
}

function Kpi({ label, value, prev, unit = '', lowerIsBetter }: { label: string; value: number; prev: PeriodSummary[keyof PeriodSummary]; unit?: string; lowerIsBetter?: boolean }) {
  const diff = Math.round((value - prev) * 10) / 10
  const good = lowerIsBetter ? diff < 0 : diff > 0
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}{unit}</div>
      <div className="hint" style={{ color: diff === 0 ? undefined : good ? 'var(--good)' : 'var(--danger)' }}>
        {diff === 0 ? 'No change' : `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}${unit} vs previous month`}
      </div>
    </div>
  )
}
