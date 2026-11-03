import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Alert, KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native'
import { Avatar, Button, Card, Chip, DueBadge, ErrorText, Loading, PriorityBadge, ProgressBar, StatusBadge, T } from '@/components/ui'
import { api, errorText } from '@/lib/api'
import { fmtDate, relTime } from '@/lib/format'
import { useSocketEvent, useUser } from '@/lib/session'
import { useTheme } from '@/lib/theme'
import { STATUS_LABEL, STATUSES, type Task, type TaskStatus, type TaskUpdate } from '@/lib/types'
import { useApi } from '@/lib/useApi'

const STEPS = [0, 25, 50, 75, 100]

export default function TaskDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const user = useUser()
  const t = useTheme()
  const { data, error, reload, setData } = useApi<{ task: Task; updates: TaskUpdate[] }>(`/tasks/${id}`)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [comment, setComment] = useState('')

  useSocketEvent<{ taskId: string; action: string }>('task:changed', (e) => {
    if (e.taskId !== id) return
    if (e.action === 'deleted') router.back()
    else void reload()
  })

  if (!data) return error ? <View style={{ padding: 16 }}><ErrorText error={error} /></View> : <Loading />
  const { task, updates } = data
  const canWork = user.role === 'LEADER' || task.assignee?.id === user.id || task.createdBy.id === user.id

  const patch = async (json: { status?: TaskStatus; progress?: number }) => {
    setBusy(true)
    try {
      const r = await api<{ task: Task }>(`/tasks/${task.id}`, { method: 'PATCH', json })
      setData((d) => d && { ...d, task: r.task })
      setActionError(null)
      void reload()
    } catch (e) {
      setActionError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const send = async () => {
    if (!comment.trim()) return
    try {
      await api(`/tasks/${task.id}/comments`, { method: 'POST', json: { body: comment } })
      setComment('')
      void reload()
    } catch (e) {
      setActionError(errorText(e))
    }
  }

  const remove = () =>
    Alert.alert('Delete task?', `"${task.title}" will be removed for everyone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await api(`/tasks/${task.id}`, { method: 'DELETE' })
          router.back()
        },
      },
    ])

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: task.title.length > 24 ? `${task.title.slice(0, 22)}…` : task.title }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 8 }}>
          <T variant="title">{task.title}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            <DueBadge task={task} />
          </View>
        </View>

        <ErrorText error={actionError} />

        {canWork && (
          <Card style={{ gap: 12 }}>
            <T variant="h2">Update</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {STATUSES.map((s) => (
                <Chip key={s} label={STATUS_LABEL[s]} active={task.status === s} onPress={() => !busy && task.status !== s && patch({ status: s })} />
              ))}
            </View>
            <ProgressBar value={task.progress} />
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Chip label="−10" onPress={() => !busy && patch({ progress: Math.max(0, task.progress - 10) })} />
              {STEPS.map((p) => <Chip key={p} label={`${p}%`} active={task.progress === p} onPress={() => !busy && patch({ progress: p })} />)}
              <Chip label="+10" onPress={() => !busy && patch({ progress: Math.min(100, task.progress + 10) })} />
            </View>
          </Card>
        )}

        <Card style={{ gap: 6 }}>
          <T variant="h2">Details</T>
          <T variant="small" style={{ color: task.description ? t.text : t.muted }}>{task.description || 'No description.'}</T>
          <View style={{ height: 6 }} />
          <Row k="Assignee" v={task.assignee?.name ?? 'Unassigned'} />
          <Row k="Created by" v={task.createdBy.name} />
          <Row k="Deadline" v={fmtDate(task.dueDate, true)} />
          {task.completedAt && <Row k="Completed" v={fmtDate(task.completedAt, true)} />}
        </Card>

        <Card style={{ gap: 10 }}>
          <T variant="h2">Activity</T>
          {updates.map((u) => (
            <View key={u.id} style={{ flexDirection: 'row', gap: 10 }}>
              <Avatar name={u.user?.name} system={!u.user} size={28} />
              <View style={{ flex: 1 }}>
                <T variant="small"><T variant="small" style={{ fontWeight: '700', color: t.text }}>{u.user?.name ?? 'Automation'}</T> · {relTime(u.createdAt)}</T>
                {u.type === 'COMMENT' ? (
                  <View style={{ backgroundColor: t.surface2, padding: 8, borderRadius: 10, marginTop: 4 }}><T>{u.message}</T></View>
                ) : (
                  <T variant="small">{u.message}</T>
                )}
              </View>
            </View>
          ))}
          {canWork && (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              <TextInput
                value={comment}
                onChangeText={setComment}
                placeholder="Write a comment…"
                placeholderTextColor={t.muted}
                style={{ flex: 1, borderWidth: 1, borderColor: t.border, borderRadius: 10, paddingHorizontal: 12, color: t.text, minHeight: 42 }}
              />
              <Button title="Send" onPress={send} disabled={!comment.trim()} />
            </View>
          )}
        </Card>

        {user.role === 'LEADER' && <Button title="Delete task" variant="danger" onPress={remove} />}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <T variant="small">{k}</T>
      <T variant="small" style={{ flexShrink: 1, textAlign: 'right' }}>{v}</T>
    </View>
  )
}
