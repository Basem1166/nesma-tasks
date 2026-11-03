import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, errorText } from '../api'
import { TaskForm } from '../components/TaskForm'
import { Avatar, DueBadge, ErrorBox, Loading, PriorityBadge, StatusBadge } from '../components/ui'
import { fmtDate, relTime, useApi } from '../hooks'
import { useSocketEvent, useUser } from '../session'
import { STATUS_LABEL, STATUSES, type Task, type TaskStatus, type TaskUpdate } from '../types'

export function TaskDetail() {
  const { id } = useParams()
  const user = useUser()
  const navigate = useNavigate()
  const { data, error, reload, setData } = useApi<{ task: Task; updates: TaskUpdate[] }>(`/tasks/${id}`)
  const [editing, setEditing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [comment, setComment] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useSocketEvent<{ taskId: string; action: string }>('task:changed', (e) => {
    if (e.taskId !== id) return
    if (e.action === 'deleted') navigate('/tasks')
    else void reload()
  })
  useEffect(() => {
    if (data) setProgress(data.task.progress)
  }, [data?.task.progress])

  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  const { task, updates } = data
  const isLeader = user.role === 'LEADER'
  const canWork = isLeader || task.assignee?.id === user.id || task.createdBy.id === user.id

  const patch = async (json: object) => {
    setBusy(true)
    try {
      const res = await api<{ task: Task }>(`/tasks/${task.id}`, { method: 'PATCH', json })
      setData((d) => d && { ...d, task: res.task })
      setActionError(null)
      void reload()
    } catch (e) {
      setActionError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const postComment = async (e: FormEvent) => {
    e.preventDefault()
    if (!comment.trim()) return
    try {
      await api(`/tasks/${task.id}/comments`, { method: 'POST', json: { body: comment } })
      setComment('')
      void reload()
    } catch (err) {
      setActionError(errorText(err))
    }
  }

  const remove = async () => {
    if (!confirm(`Delete "${task.title}"? This cannot be undone.`)) return
    await api(`/tasks/${task.id}`, { method: 'DELETE' })
    navigate('/tasks')
  }

  return (
    <>
      <div className="small" style={{ marginBottom: 12 }}><Link to="/tasks">← All tasks</Link></div>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1>{task.title}</h1>
          <div className="row wrap" style={{ marginTop: 8 }}>
            <StatusBadge status={task.status} /> <PriorityBadge priority={task.priority} /> <DueBadge task={task} />
          </div>
        </div>
        {isLeader && (
          <div className="row">
            <button className="btn" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn danger" onClick={remove}>Delete</button>
          </div>
        )}
      </div>
      <ErrorBox error={actionError} />

      <div className="grid grid-3" style={{ marginTop: 12 }}>
        <div className="stack">
          <div className="card">
            <h2 style={{ marginBottom: 8 }}>Description</h2>
            <p style={{ whiteSpace: 'pre-wrap' }} className={task.description ? '' : 'muted'}>{task.description || 'No description.'}</p>
          </div>

          <div className="card">
            <h2 style={{ marginBottom: 12 }}>Activity</h2>
            <div className="timeline">
              {updates.map((u) => (
                <div key={u.id} className="tl-item">
                  <Avatar name={u.user?.name} system={!u.user} />
                  <div>
                    <div className="small"><strong>{u.user?.name ?? 'Automation'}</strong> <span className="muted">· {relTime(u.createdAt)}</span></div>
                    {u.type === 'COMMENT' ? <div className="comment-bubble">{u.message}</div> : <div className="small secondary">{u.message}</div>}
                  </div>
                </div>
              ))}
            </div>
            {canWork && (
              <form onSubmit={postComment} className="row" style={{ marginTop: 12 }}>
                <input className="input" placeholder="Write a comment…" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
                <button className="btn primary" disabled={!comment.trim()}>Comment</button>
              </form>
            )}
          </div>
        </div>

        <div className="stack">
          {canWork && (
            <div className="card">
              <h2 style={{ marginBottom: 12 }}>Update progress</h2>
              <div className="field" style={{ marginBottom: 14 }}>
                <label htmlFor="status">Status</label>
                <select id="status" className="input" value={task.status} disabled={busy} onChange={(e) => patch({ status: e.target.value as TaskStatus })}>
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="progress">Progress: <span className="tabular">{progress}%</span></label>
                <input id="progress" type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(Number(e.target.value))} />
                <button className="btn sm" disabled={busy || progress === task.progress} onClick={() => patch({ progress })}>Save progress</button>
              </div>
            </div>
          )}
          <div className="card">
            <h2 style={{ marginBottom: 12 }}>Details</h2>
            <dl className="small" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 14px', margin: 0 }}>
              <dt className="muted">Assignee</dt><dd style={{ margin: 0 }}>{task.assignee?.name ?? 'Unassigned'}</dd>
              <dt className="muted">Created by</dt><dd style={{ margin: 0 }}>{task.createdBy.name}</dd>
              <dt className="muted">Deadline</dt><dd style={{ margin: 0 }}>{fmtDate(task.dueDate, true)}</dd>
              <dt className="muted">Created</dt><dd style={{ margin: 0 }}>{fmtDate(task.createdAt, true)}</dd>
              {task.completedAt && <><dt className="muted">Completed</dt><dd style={{ margin: 0 }}>{fmtDate(task.completedAt, true)}</dd></>}
              <dt className="muted">Progress</dt><dd style={{ margin: 0 }}>{task.progress}%</dd>
            </dl>
          </div>
        </div>
      </div>
      {editing && <TaskForm task={task} onClose={() => setEditing(false)} onSaved={(t) => { setEditing(false); setData((d) => d && { ...d, task: t }); void reload() }} />}
    </>
  )
}
