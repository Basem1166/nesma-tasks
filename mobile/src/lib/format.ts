export function dueLabel(iso: string | null, done: boolean) {
  if (!iso) return 'No deadline'
  if (done) return fmtDate(iso)
  const ms = new Date(iso).getTime() - Date.now()
  if (ms < 0) {
    const late = Math.floor(-ms / 86_400_000)
    return late >= 1 ? `${late}d overdue` : 'Overdue'
  }
  const days = Math.floor(ms / 86_400_000)
  if (days === 0) return ms < 3_600_000 ? 'Due within the hour' : `Due in ${Math.floor(ms / 3_600_000)}h`
  if (days === 1) return 'Due tomorrow'
  return `Due in ${days} days`
}

export const fmtDate = (iso: string | null, withTime = false) =>
  iso
    ? new Date(iso).toLocaleString(undefined, withTime
        ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
        : { day: 'numeric', month: 'short', year: 'numeric' })
    : '—'

export function relTime(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export const initials = (name?: string | null) =>
  (name ?? '·').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
