import { router } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native'
import { Button, Chip, ErrorText, T } from '@/components/ui'
import { api, errorText } from '@/lib/api'
import { fmtDate } from '@/lib/format'
import { useUser } from '@/lib/session'
import { useTheme } from '@/lib/theme'
import { PRIORITIES, type Task, type TaskPriority, type TeamMember } from '@/lib/types'
import { useApi } from '@/lib/useApi'

const endOfDay = (daysFromNow: number) => {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  d.setHours(17, 0, 0, 0)
  return d
}
const DUE_OPTIONS = [
  { label: 'None', value: null },
  { label: 'Today', value: 0 },
  { label: 'Tomorrow', value: 1 },
  { label: '3 days', value: 3 },
  { label: '1 week', value: 7 },
  { label: '2 weeks', value: 14 },
] as const

export default function NewTask() {
  const user = useUser()
  const t = useTheme()
  const isLeader = user.role === 'LEADER'
  const team = useApi<{ users: TeamMember[] }>(isLeader ? '/users' : null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM')
  const [due, setDue] = useState<number | null>(3)
  const [assigneeId, setAssigneeId] = useState<string | null>(isLeader ? null : user.id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const { task } = await api<{ task: Task }>('/tasks', {
        method: 'POST',
        json: {
          title,
          description,
          priority,
          dueDate: due === null ? null : endOfDay(due).toISOString(),
          ...(isLeader ? { assigneeId } : {}),
        },
      })
      router.replace({ pathname: '/task/[id]', params: { id: task.id } })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const input = { borderWidth: 1, borderColor: t.border, borderRadius: 10, padding: 12, fontSize: 16, color: t.text, backgroundColor: t.surface }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
        <T variant="small">Title</T>
        <TextInput style={input} value={title} onChangeText={setTitle} placeholder="What needs to be done?" placeholderTextColor={t.muted} maxLength={200} autoFocus />
        <T variant="small">Description</T>
        <TextInput style={[input, { minHeight: 90, textAlignVertical: 'top' }]} value={description} onChangeText={setDescription} multiline placeholder="Details, acceptance criteria…" placeholderTextColor={t.muted} />
        <T variant="small">Priority</T>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {PRIORITIES.map((p) => <Chip key={p} label={p.charAt(0) + p.slice(1).toLowerCase()} active={priority === p} onPress={() => setPriority(p)} />)}
        </View>
        <T variant="small">Deadline {due !== null ? `· ${fmtDate(endOfDay(due).toISOString(), true)}` : ''}</T>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {DUE_OPTIONS.map((o) => <Chip key={o.label} label={o.label} active={due === o.value} onPress={() => setDue(o.value)} />)}
        </View>
        {isLeader && (
          <>
            <T variant="small">Assign to</T>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Chip label="Unassigned" active={assigneeId === null} onPress={() => setAssigneeId(null)} />
              {team.data?.users.filter((u) => u.active).map((u) => (
                <Chip key={u.id} label={`${u.name} (${u.openTasks})`} active={assigneeId === u.id} onPress={() => setAssigneeId(u.id)} />
              ))}
            </View>
            <T variant="muted">The assignee gets a push notification and an email.</T>
          </>
        )}
        <ErrorText error={error} />
        <Button title="Create task" onPress={submit} loading={busy} disabled={title.trim().length < 3} />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
