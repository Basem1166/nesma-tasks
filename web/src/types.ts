export type Role = 'LEADER' | 'MEMBER'
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE'
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

export const STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']
export const PRIORITIES: TaskPriority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW']
export const STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  IN_REVIEW: 'In review',
  DONE: 'Done',
}

export interface User {
  id: string
  name: string
  email: string
  role: Role
  title: string | null
  teamId: string
  emailNotifications: boolean
}

export interface TeamMember {
  id: string
  name: string
  email: string
  role: Role
  title: string | null
  active: boolean
  lastLoginAt: string | null
  openTasks: number
}

export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  progress: number
  dueDate: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  assignee: { id: string; name: string; email: string } | null
  createdBy: { id: string; name: string }
  overdue: boolean
}

export interface TaskUpdate {
  id: string
  type: string
  message: string
  createdAt: string
  user: { id: string; name: string } | null
}

export interface Notification {
  id: string
  type: string
  title: string
  body: string
  taskId: string | null
  read: boolean
  createdAt: string
}

export interface Channel {
  id: string
  name: string
  topic: string
  lastMessage: ChatMessage | null
}

export interface ChatMessage {
  id: string
  channelId: string
  body: string
  createdAt: string
  user: { id: string; name: string }
}

export interface PeriodSummary {
  workload: number
  created: number
  completed: number
  completionRate: number
  onTimeRate: number
  completedLate: number
  overdueOpen: number
  avgCycleDays: number
}

export interface TeamMetrics {
  periodLabel: string
  summary: PeriodSummary
  previous: PeriodSummary
  members: {
    userId: string
    name: string
    workload: number
    completed: number
    completedLate: number
    overdueOpen: number
    completionRate: number
    onTimeRate: number
    avgOpenProgress: number
  }[]
}

export interface ReportSummary {
  id: string
  periodStart: string
  periodEnd: string
  aiGenerated: boolean
  model: string | null
  createdAt: string
  generatedBy: { name: string } | null
}

export interface Report extends ReportSummary {
  narrative: string
  metrics: TeamMetrics
}
