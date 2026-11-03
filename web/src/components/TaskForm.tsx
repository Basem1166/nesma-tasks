import { useState, type FormEvent } from 'react'
import { api, errorText } from '../api'
import { useApi } from '../hooks'
import { useUser } from '../session'
import { PRIORITIES, type Task, type TaskPriority, type TeamMember } from '../types'
import { ErrorBox, Modal } from './ui'

const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

/** Create or edit a task. Members can only create tasks for themselves. */
export function TaskForm({ task, onClose, onSaved }: { task?: Task; onClose: () => void; onSaved: (t: Task) => void }) {
  const user = useUser()
  const isLeader = user.role === 'LEADER'
  const { data: team } = useApi<{ users: TeamMember[] }>(isLeader ? '/users' : null)
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'MEDIUM')
  const [due, setDue] = useState(toLocalInput(task?.dueDate ?? null))
  const [assigneeId, setAssigneeId] = useState(task?.assignee?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const payload = {
      title,
      description,
      priority,
      dueDate: due ? new Date(due).toISOString() : null,
      ...(isLeader ? { assigneeId: assigneeId || null } : {}),
    }
    try {
      const res = task
        ? await api<{ task: Task }>(`/tasks/${task.id}`, { method: 'PATCH', json: payload })
        : await api<{ task: Task }>('/tasks', { method: 'POST', json: payload })
      onSaved(res.task)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={task ? 'Edit task' : 'New task'} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <div className="field full">
          <label htmlFor="t-title">Title</label>
          <input id="t-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={200} autoFocus />
        </div>
        <div className="field full">
          <label htmlFor="t-desc">Description</label>
          <textarea id="t-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
        </div>
        <div className="field">
          <label htmlFor="t-pri">Priority</label>
          <select id="t-pri" className="input" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="t-due">Deadline</label>
          <input id="t-due" type="datetime-local" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
        {isLeader && (
          <div className="field full">
            <label htmlFor="t-assignee">Assign to</label>
            <select id="t-assignee" className="input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Unassigned</option>
              {team?.users.filter((u) => u.active).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} {u.title ? `— ${u.title}` : ''} ({u.openTasks} open)
                </option>
              ))}
            </select>
            <span className="small muted">The assignee is notified in-app, by push and by email.</span>
          </div>
        )}
        <div className="full"><ErrorBox error={error} /></div>
        <div className="full row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={saving}>{saving ? 'Saving…' : task ? 'Save changes' : 'Create task'}</button>
        </div>
      </form>
    </Modal>
  )
}
