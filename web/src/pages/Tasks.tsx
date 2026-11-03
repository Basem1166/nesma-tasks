import { useMemo, useState, type DragEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, errorText } from '../api'
import { TaskForm } from '../components/TaskForm'
import { DueBadge, ErrorBox, Loading, PriorityBadge, Progress, StatusBadge } from '../components/ui'
import { useApi } from '../hooks'
import { useSocketEvent, useUser } from '../session'
import { PRIORITIES, STATUS_LABEL, STATUSES, type Task, type TaskStatus, type TeamMember } from '../types'

export function Tasks() {
  const user = useUser()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<'list' | 'board'>(() => (localStorage.getItem('taskView') as 'list' | 'board') ?? 'list')
  const [creating, setCreating] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropCol, setDropCol] = useState<TaskStatus | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)

  const query = useMemo(() => {
    const q = new URLSearchParams()
    for (const k of ['status', 'priority', 'assigneeId', 'q', 'overdue', 'mine', 'sort']) {
      const v = params.get(k)
      if (v) q.set(k, v)
    }
    return q.toString()
  }, [params])
  const { data, error, loading, reload, setData } = useApi<{ tasks: Task[] }>(`/tasks?${query}`)
  const { data: team } = useApi<{ users: TeamMember[] }>(user.role === 'LEADER' ? '/users' : null)
  useSocketEvent('task:changed', () => void reload())

  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    setParams(p, { replace: true })
  }
  const switchView = (v: 'list' | 'board') => {
    setView(v)
    localStorage.setItem('taskView', v)
  }

  const onDrop = async (e: DragEvent, status: TaskStatus) => {
    e.preventDefault()
    setDropCol(null)
    const task = data?.tasks.find((t) => t.id === dragId)
    if (!task || task.status === status) return
    // Optimistic move; the server response (and realtime sync) confirm it.
    setData((d) => d && { tasks: d.tasks.map((t) => (t.id === task.id ? { ...t, status } : t)) })
    try {
      await api(`/tasks/${task.id}`, { method: 'PATCH', json: { status } })
      setMoveError(null)
    } catch (err) {
      setMoveError(errorText(err))
    }
    void reload()
  }

  const tasks = data?.tasks ?? []

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tasks</h1>
          <p>{user.role === 'LEADER' ? 'All tasks in your team.' : 'Tasks assigned to you or created by you.'}</p>
        </div>
        <div className="row">
          <div className="seg" role="tablist">
            <button className={view === 'list' ? 'on' : ''} onClick={() => switchView('list')}>List</button>
            <button className={view === 'board' ? 'on' : ''} onClick={() => switchView('board')}>Board</button>
          </div>
          <button className="btn primary" onClick={() => setCreating(true)}>+ New task</button>
        </div>
      </div>

      <div className="filters">
        <input className="input search" placeholder="Search tasks…" defaultValue={params.get('q') ?? ''} onChange={(e) => set('q', e.target.value)} aria-label="Search" />
        <select className="input" value={params.get('status') ?? ''} onChange={(e) => set('status', e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          <option value="TODO,IN_PROGRESS,IN_REVIEW">Not done</option>
        </select>
        <select className="input" value={params.get('priority') ?? ''} onChange={(e) => set('priority', e.target.value)} aria-label="Priority">
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>)}
        </select>
        {team && (
          <select className="input" value={params.get('assigneeId') ?? ''} onChange={(e) => set('assigneeId', e.target.value)} aria-label="Assignee">
            <option value="">Anyone</option>
            <option value="none">Unassigned</option>
            {team.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        <select className="input" value={params.get('sort') ?? 'due'} onChange={(e) => set('sort', e.target.value)} aria-label="Sort">
          <option value="due">Sort: deadline</option>
          <option value="priority">Sort: priority</option>
          <option value="updated">Sort: recently updated</option>
          <option value="created">Sort: newest</option>
        </select>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={params.get('overdue') === 'true'} onChange={(e) => set('overdue', e.target.checked ? 'true' : '')} /> Overdue only
        </label>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={params.get('mine') === 'true'} onChange={(e) => set('mine', e.target.checked ? 'true' : '')} /> Assigned to me
        </label>
      </div>

      <ErrorBox error={error ?? moveError} />
      {loading && !data ? (
        <Loading />
      ) : view === 'list' ? (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Task</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Deadline</th><th style={{ width: 150 }}>Progress</th></tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id} className="clickable" onClick={() => navigate(`/tasks/${t.id}`)}>
                    <td style={{ fontWeight: 550, maxWidth: 360 }}>{t.title}</td>
                    <td><StatusBadge status={t.status} /></td>
                    <td><PriorityBadge priority={t.priority} /></td>
                    <td className="secondary">{t.assignee?.name ?? <span className="muted">Unassigned</span>}</td>
                    <td><DueBadge task={t} /></td>
                    <td><Progress value={t.progress} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {tasks.length === 0 && <div className="empty">No tasks match these filters.</div>}
          </div>
        </div>
      ) : (
        <div className="board">
          {STATUSES.map((s) => {
            const col = tasks.filter((t) => t.status === s)
            return (
              <div
                key={s}
                className={`board-col ${dropCol === s ? 'drop' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDropCol(s) }}
                onDragLeave={() => setDropCol(null)}
                onDrop={(e) => onDrop(e, s)}
              >
                <h3><span><StatusBadge status={s} /></span><span className="muted">{col.length}</span></h3>
                {col.map((t) => (
                  <div
                    key={t.id}
                    className={`board-card ${dragId === t.id ? 'dragging' : ''}`}
                    draggable
                    onDragStart={() => setDragId(t.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => navigate(`/tasks/${t.id}`)}
                  >
                    <div style={{ fontWeight: 550, marginBottom: 6 }}>{t.title}</div>
                    <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
                      <PriorityBadge priority={t.priority} /> <DueBadge task={t} />
                    </div>
                    <div className="row small secondary"><span style={{ flex: 1 }}>{t.assignee?.name ?? 'Unassigned'}</span></div>
                    <Progress value={t.progress} />
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
      {creating && <TaskForm onClose={() => setCreating(false)} onSaved={(t) => { setCreating(false); navigate(`/tasks/${t.id}`) }} />}
    </>
  )
}
