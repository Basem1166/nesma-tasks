import Ionicons from '@expo/vector-icons/Ionicons'
import { router, useLocalSearchParams, useNavigation } from 'expo-router'
import { useLayoutEffect, useMemo, useState } from 'react'
import { FlatList, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native'
import { TaskRow } from '@/components/TaskRow'
import { Chip, Empty, ErrorText, Loading } from '@/components/ui'
import { useSocketEvent, useUser } from '@/lib/session'
import { useTheme } from '@/lib/theme'
import type { Task } from '@/lib/types'
import { useApi } from '@/lib/useApi'

const FILTERS = [
  { key: 'open', label: 'Open', query: 'status=TODO,IN_PROGRESS,IN_REVIEW' },
  { key: 'overdue', label: 'Overdue', query: 'overdue=true' },
  { key: 'mine', label: 'Mine', query: 'mine=true&status=TODO,IN_PROGRESS,IN_REVIEW' },
  { key: 'review', label: 'In review', query: 'status=IN_REVIEW' },
  { key: 'done', label: 'Done', query: 'status=DONE&sort=updated' },
  { key: 'all', label: 'All', query: '' },
] as const

export default function Tasks() {
  const user = useUser()
  const t = useTheme()
  const navigation = useNavigation()
  const params = useLocalSearchParams<{ filter?: string }>()
  const [filter, setFilter] = useState<string>(params.filter ?? 'open')
  const [search, setSearch] = useState('')
  const query = FILTERS.find((f) => f.key === filter)?.query ?? ''
  const { data, error, refreshing, refresh, reload } = useApi<{ tasks: Task[] }>(`/tasks?${query}`)
  useSocketEvent('task:changed', () => void reload())

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => router.push('/task/new')} style={{ marginRight: 16 }} accessibilityLabel="New task" hitSlop={10}>
          <Ionicons name="add-circle-outline" size={26} color={t.brand} />
        </Pressable>
      ),
    })
  }, [navigation, t])

  const tasks = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.tasks ?? []).filter((x) => !q || x.title.toLowerCase().includes(q) || x.assignee?.name.toLowerCase().includes(q))
  }, [data, search])

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 12, paddingBottom: 4, gap: 10 }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search tasks or people"
          placeholderTextColor={t.muted}
          style={{ borderWidth: 1, borderColor: t.border, borderRadius: 10, padding: 10, color: t.text, backgroundColor: t.surface }}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {FILTERS.map((f) => <Chip key={f.key} label={f.label} active={filter === f.key} onPress={() => setFilter(f.key)} />)}
        </ScrollView>
      </View>
      <ErrorText error={error} />
      {!data ? (
        <Loading />
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(x) => x.id}
          contentContainerStyle={{ padding: 12, gap: 10 }}
          renderItem={({ item }) => <TaskRow task={item} showAssignee={user.role === 'LEADER'} />}
          ListEmptyComponent={<Empty text="No tasks here." />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.brand} />}
        />
      )}
    </View>
  )
}
