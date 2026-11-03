import { useEffect, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { dueLabel } from '../hooks'
import { STATUS_LABEL, type Task, type TaskPriority, type TaskStatus } from '../types'

export const STATUS_COLOR: Record<TaskStatus, string> = {
  TODO: 'var(--s1)',
  IN_PROGRESS: 'var(--s2)',
  IN_REVIEW: 'var(--s3)',
  DONE: 'var(--s4)',
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`badge ${status === 'DONE' ? 'done' : ''}`}>
      <span className="dot" style={{ background: STATUS_COLOR[status] }} />
      {STATUS_LABEL[status]}
    </span>
  )
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const icon = priority === 'URGENT' ? '⚑ ' : priority === 'HIGH' ? '▲ ' : ''
  return (
    <span className={`badge ${priority}`}>
      {icon}
      {priority.charAt(0) + priority.slice(1).toLowerCase()}
    </span>
  )
}

export function DueBadge({ task }: { task: Pick<Task, 'dueDate' | 'status' | 'overdue'> }) {
  const text = dueLabel(task.dueDate, task.status === 'DONE')
  return <span className={`badge ${task.overdue ? 'overdue' : ''}`}>{task.overdue ? '⏰ ' : ''}{text}</span>
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <div className="progress" style={{ flex: 1 }} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${value}%` }} />
      </div>
      <span className="small secondary tabular" style={{ width: 36, textAlign: 'right' }}>{value}%</span>
    </div>
  )
}

export function Avatar({ name, system }: { name?: string | null; system?: boolean }) {
  const initials = (name ?? '·')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return <span className={`avatar ${system ? 'sys' : ''}`} aria-hidden>{system ? '⚙' : initials}</span>
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />
}

export function Loading() {
  return (
    <div className="center">
      <Spinner />
    </div>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Markdown from the AI is rendered without raw HTML (react-markdown escapes it). */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}

export function ErrorBox({ error }: { error: string | null }) {
  return error ? <div className="alert error" role="alert">{error}</div> : null
}
