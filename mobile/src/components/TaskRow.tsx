import { router } from 'expo-router'
import { Pressable, View } from 'react-native'
import { useTheme } from '@/lib/theme'
import type { Task } from '@/lib/types'
import { DueBadge, PriorityBadge, ProgressBar, StatusBadge, T } from './ui'

export function TaskRow({ task, showAssignee }: { task: Task; showAssignee?: boolean }) {
  const t = useTheme()
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })}
      style={({ pressed }) => ({ backgroundColor: pressed ? t.surface2 : t.surface, borderColor: task.overdue ? t.danger : t.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 })}
      accessibilityRole="button"
      accessibilityLabel={`${task.title}, ${task.status}, ${task.progress} percent`}
    >
      <T variant="h2" numberOfLines={2}>{task.title}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <StatusBadge status={task.status} />
        <PriorityBadge priority={task.priority} />
        <DueBadge task={task} />
      </View>
      {showAssignee && <T variant="small">{task.assignee?.name ?? 'Unassigned'}</T>}
      <ProgressBar value={task.progress} />
    </Pressable>
  )
}
