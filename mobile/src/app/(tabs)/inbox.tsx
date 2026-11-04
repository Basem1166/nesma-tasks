import { router } from 'expo-router'
import { FlatList, Pressable, RefreshControl, View } from 'react-native'
import { Button, Empty, Loading, T } from '@/components/ui'
import { api } from '@/lib/api'
import { relTime } from '@/lib/format'
import { useSession, useSocketEvent } from '@/lib/session'
import { useTheme } from '@/lib/theme'
import type { AppNotification } from '@/lib/types'
import { useApi } from '@/lib/useApi'

export default function Inbox() {
  const t = useTheme()
  const { pushStatus } = useSession()
  const { data, refreshing, refresh, reload, setData } = useApi<{ notifications: AppNotification[]; unread: number }>('/notifications')
  useSocketEvent<AppNotification>('notification:new', (n) =>
    setData((d) => (d ? { notifications: [n, ...d.notifications], unread: d.unread + 1 } : d)),
  )

  const open = async (n: AppNotification) => {
    if (!n.read) {
      await api(`/notifications/${n.id}/read`, { method: 'POST' })
      void reload()
    }
    if (n.taskId) router.push({ pathname: '/task/[id]', params: { id: n.taskId } })
  }

  if (!data) return <Loading />
  return (
    <FlatList
      data={data.notifications}
      keyExtractor={(n) => n.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.brand} />}
      ListHeaderComponent={
        <View style={{ padding: 12, gap: 8 }}>
          {pushStatus && pushStatus !== 'enabled' && <T variant="muted">{pushStatus}</T>}
          {data.unread > 0 && (
            <Button title={`Mark all ${data.unread} as read`} variant="secondary" onPress={async () => { await api('/notifications/read-all', { method: 'POST' }); void reload() }} />
          )}
        </View>
      }
      ListEmptyComponent={<Empty text="You're all caught up." />}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => open(item)}
          style={({ pressed }) => ({ padding: 14, borderBottomWidth: 1, borderColor: t.border, backgroundColor: pressed ? t.surface2 : item.read ? t.surface : t.brandSoft, flexDirection: 'row', gap: 10 })}
        >
          {!item.read && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.brand, marginTop: 6 }} />}
          <View style={{ flex: 1 }}>
            <T style={{ fontWeight: '600' }}>{item.title}</T>
            <T variant="small">{item.body}</T>
            <T variant="muted" style={{ marginTop: 2 }}>{relTime(item.createdAt)}</T>
          </View>
        </Pressable>
      )}
    />
  )
}
