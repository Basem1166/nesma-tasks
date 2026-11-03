import Ionicons from '@expo/vector-icons/Ionicons'
import { router, useNavigation } from 'expo-router'
import { useLayoutEffect } from 'react'
import { Pressable, RefreshControl, ScrollView, View } from 'react-native'
import { TaskRow } from '@/components/TaskRow'
import { Card, Empty, ErrorText, Loading, statusColor, T } from '@/components/ui'
import { useSocketEvent, useUser } from '@/lib/session'
import { useTheme } from '@/lib/theme'
import { STATUS_LABEL, STATUSES, type Task, type TaskStatus } from '@/lib/types'
import { useApi } from '@/lib/useApi'

interface Dashboard {
  stats: { total: number; open: number; overdue: number; dueSoon: number; completedThisWeek: number; byStatus: Record<TaskStatus, number> }
  myTasks: Task[]
  attention: Task[]
  workload: { id: string; name: string; open: number; overdue: number; avgProgress: number }[]
}

export default function Home() {
  const user = useUser()
  const t = useTheme()
  const navigation = useNavigation()
  const { data, error, refreshing, refresh, reload } = useApi<Dashboard>('/dashboard')
  useSocketEvent('task:changed', () => void reload())

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', gap: 16, marginRight: 16 }}>
          <Pressable onPress={() => router.push('/task/new')} accessibilityLabel="New task" hitSlop={10}>
            <Ionicons name="add-circle-outline" size={26} color={t.brand} />
          </Pressable>
          <Pressable onPress={() => router.push('/profile')} accessibilityLabel="Profile" hitSlop={10}>
            <Ionicons name="person-circle-outline" size={26} color={t.text2} />
          </Pressable>
        </View>
      ),
    })
  }, [navigation, t])

  if (!data) return error ? <View style={{ padding: 16 }}><ErrorText error={error} /></View> : <Loading />
  const s = data.stats

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.brand} />}>
      <View>
        <T variant="title">Hi {user.name.split(' ')[0]} 👋</T>
        <T variant="small">{user.role === 'LEADER' ? "Here's your team today." : "Here's what's on your plate."}</T>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Stat label="Open" value={s.open} />
        <Stat label="Overdue" value={s.overdue} danger={s.overdue > 0} onPress={() => router.push({ pathname: '/tasks', params: { filter: 'overdue' } })} />
        <Stat label="Due in 3 days" value={s.dueSoon} />
        <Stat label="Done this week" value={s.completedThisWeek} />
      </View>

      <Card>
        <T variant="h2" style={{ marginBottom: 10 }}>Tasks by status</T>
        <View style={{ flexDirection: 'row', height: 18, gap: 2, borderRadius: 4, overflow: 'hidden' }} accessibilityLabel={STATUSES.map((x) => `${STATUS_LABEL[x]} ${s.byStatus[x]}`).join(', ')}>
          {STATUSES.filter((x) => s.byStatus[x] > 0).map((x) => (
            <View key={x} style={{ flex: s.byStatus[x], backgroundColor: statusColor(t, x) }} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
          {STATUSES.map((x) => (
            <View key={x} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: statusColor(t, x) }} />
              <T variant="small">{STATUS_LABEL[x]} <T variant="small" style={{ color: t.text, fontWeight: '700' }}>{s.byStatus[x]}</T></T>
            </View>
          ))}
        </View>
      </Card>

      <Section title="Needs attention">
        {data.attention.length ? data.attention.map((task) => <TaskRow key={task.id} task={task} showAssignee={user.role === 'LEADER'} />) : <Empty text="Nothing overdue or at risk 🎉" />}
      </Section>

      <Section title="My open tasks">
        {data.myTasks.length ? data.myTasks.map((task) => <TaskRow key={task.id} task={task} />) : <Empty text="No open tasks assigned to you." />}
      </Section>

      {user.role === 'LEADER' && data.workload.length > 0 && (
        <Card>
          <T variant="h2" style={{ marginBottom: 10 }}>Team workload</T>
          {data.workload.map((w) => {
            const max = Math.max(...data.workload.map((x) => x.open))
            return (
              <View key={w.id} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <T variant="small" style={{ color: t.text }}>{w.name}</T>
                  <T variant="small">{w.open} open{w.overdue ? ` · ${w.overdue} overdue` : ''}</T>
                </View>
                <View style={{ height: 10, backgroundColor: 'transparent', borderLeftWidth: 1, borderColor: t.border }}>
                  <View style={{ width: `${(w.open / max) * 100}%`, height: '100%', backgroundColor: t.s1, borderTopRightRadius: 4, borderBottomRightRadius: 4 }} />
                </View>
              </View>
            )
          })}
        </Card>
      )}
    </ScrollView>
  )
}

function Stat({ label, value, danger, onPress }: { label: string; value: number; danger?: boolean; onPress?: () => void }) {
  const t = useTheme()
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={{ flexBasis: '47%', flexGrow: 1 }}>
      <Card>
        <T variant="small">{label}</T>
        <T style={{ fontSize: 28, fontWeight: '700', color: danger ? t.danger : t.text, marginTop: 2 }}>{value}</T>
      </Card>
    </Pressable>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <T variant="h2">{title}</T>
      {children}
    </View>
  )
}
