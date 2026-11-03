import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { TaskForm } from '../components/TaskForm'
import { Avatar, DueBadge, ErrorBox, Loading, PriorityBadge, Progress, STATUS_COLOR } from '../components/ui'
import { relTime, useApi } from '../hooks'
import { useSocketEvent, useUser } from '../session'
import { STATUS_LABEL, STATUSES, type Task, type TaskStatus } from '../types'

interface DashboardData {
  stats: { total: number; open: number; overdue: number; dueSoon: number; completedThisWeek: number; byStatus: Record<TaskStatus, number> }
  myTasks: Task[]
  attention: Task[]
  workload: { id: string; name: string; open: number; overdue: number; avgProgress: number }[]
  activity: { id: string; type: string; message: string; createdAt: string; user: { name: string } | null; task: { id: string; title: string } }[]
}

export function Dashboard() {
  const user = useUser()
  const { data, error, reload } = useApi<DashboardData>('/dashboard')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()
  useSocketEvent('task:changed', () => void reload())

  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  const s = data.stats

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Good {greeting()}, {user.name.split(' ')[0]}</h1>
          <p>{user.role === 'LEADER' ? "Here's how the team is doing today." : "Here's what's on your plate."}</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>+ New task</button>
      </div>

      <div className="stats">
        <Stat label="Open tasks" value={s.open} hint={`${s.total} total`} />
        <Stat label="Overdue" value={s.overdue} hint={s.overdue ? 'Need attention' : 'Nothing late'} tone={s.overdue ? 'bad' : undefined} />
        <Stat label="Due in 3 days" value={s.dueSoon} hint="Not yet done" />
        <Stat label="Completed this week" value={s.completedThisWeek} hint="Last 7 days" />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><h2>Tasks by status</h2><span className="small muted">{s.total} tasks</span></div>
        <StatusBar byStatus={s.byStatus} total={s.total} />
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h2>Needs attention</h2><Link to="/tasks?overdue=true" className="small">View overdue</Link></div>
          {data.attention.length === 0 ? <div className="empty">No overdue or at-risk tasks 🎉</div> : <TaskMiniList tasks={data.attention} onOpen={(id) => navigate(`/tasks/${id}`)} />}
        </div>
        <div className="card">
          <div className="card-head"><h2>My open tasks</h2><Link to="/tasks?mine=true" className="small">All my tasks</Link></div>
          {data.myTasks.length === 0 ? <div className="empty">No open tasks assigned to you.</div> : <TaskMiniList tasks={data.myTasks} onOpen={(id) => navigate(`/tasks/${id}`)} />}
        </div>
        {user.role === 'LEADER' && (
          <div className="card">
            <div className="card-head"><h2>Team workload</h2><span className="small muted">Open tasks per member</span></div>
            <Workload rows={data.workload} />
          </div>
        )}
        <div className="card">
          <div className="card-head"><h2>Recent activity</h2></div>
          <div className="timeline">
            {data.activity.map((a) => (
              <div key={a.id} className="tl-item">
                <Avatar name={a.user?.name} system={!a.user} />
                <div className="small">
                  <span><strong>{a.user?.name ?? 'Automation'}</strong> · <Link to={`/tasks/${a.task.id}`}>{a.task.title}</Link></span>
                  <div className="secondary">{a.type === 'COMMENT' ? `“${a.message}”` : a.message}</div>
                  <div className="muted">{relTime(a.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {creating && <TaskForm onClose={() => setCreating(false)} onSaved={(t) => { setCreating(false); navigate(`/tasks/${t.id}`) }} />}
    </>
  )
}

const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'
}

function Stat({ label, value, hint, tone }: { label: string; value: number; hint: string; tone?: 'bad' }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value" style={tone === 'bad' ? { color: 'var(--danger)' } : undefined}>{value}</div>
      <div className="hint">{hint}</div>
    </div>
  )
}

/** One stacked bar: status share of all tasks, with legend + direct counts. */
function StatusBar({ byStatus, total }: { byStatus: Record<TaskStatus, number>; total: number }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  if (!total) return <div className="empty">No tasks yet</div>
  return (
    <>
      <div className="stackbar" role="img" aria-label={STATUSES.map((st) => `${STATUS_LABEL[st]} ${byStatus[st]}`).join(', ')}>
        {STATUSES.filter((st) => byStatus[st] > 0).map((st) => (
          <div
            key={st}
            style={{ flex: byStatus[st], background: STATUS_COLOR[st] }}
            onMouseMove={(e) => setTip({ x: e.clientX + 12, y: e.clientY + 12, text: `${STATUS_LABEL[st]}: ${byStatus[st]} (${Math.round((byStatus[st] / total) * 100)}%)` })}
            onMouseLeave={() => setTip(null)}
          />
        ))}
      </div>
      <div className="legend">
        {STATUSES.map((st) => (
          <span key={st}>
            <span className="sw" style={{ background: STATUS_COLOR[st] }} />
            {STATUS_LABEL[st]} <strong className="tabular" style={{ color: 'var(--text)' }}>{byStatus[st]}</strong>
          </span>
        ))}
      </div>
      {tip && <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>}
    </>
  )
}

function Workload({ rows }: { rows: DashboardData['workload'] }) {
  const max = Math.max(1, ...rows.map((r) => r.open))
  if (!rows.length) return <div className="empty">No assigned open tasks.</div>
  return (
    <div>
      {rows.map((r) => (
        <div key={r.id} className="hbar-row" title={`${r.name}: ${r.open} open, ${r.overdue} overdue, avg ${r.avgProgress}% progress`}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
          <div className="hbar-track"><div className="hbar-fill" style={{ width: `${(r.open / max) * 100}%` }} /></div>
          <span className="small tabular secondary">
            {r.open} open{r.overdue ? <span style={{ color: 'var(--danger)' }}> · {r.overdue}⏰</span> : null}
          </span>
        </div>
      ))}
    </div>
  )
}

function TaskMiniList({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  return (
    <div className="stack" style={{ gap: 0 }}>
      {tasks.map((t) => (
        <div key={t.id} className="row" style={{ padding: '10px 4px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => onOpen(t.id)}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
            <div className="row small secondary" style={{ marginTop: 4 }}>
              <PriorityBadge priority={t.priority} /> <DueBadge task={t} /> {t.assignee && <span className="muted">{t.assignee.name}</span>}
            </div>
          </div>
          <div style={{ width: 110 }}><Progress value={t.progress} /></div>
        </div>
      ))}
    </div>
  )
}
