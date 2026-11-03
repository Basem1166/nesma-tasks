import { router } from 'expo-router'
import { FlatList, Pressable, RefreshControl, View } from 'react-native'
import { Empty, Loading, T } from '@/components/ui'
import { relTime } from '@/lib/format'
import { useSocketEvent } from '@/lib/session'
import { useTheme } from '@/lib/theme'
import type { Channel } from '@/lib/types'
import { useApi } from '@/lib/useApi'

export default function Channels() {
  const t = useTheme()
  const { data, refreshing, refresh, reload } = useApi<{ channels: Channel[] }>('/channels')
  useSocketEvent('chat:message', () => void reload())
  useSocketEvent('chat:channel', () => void reload())

  if (!data) return <Loading />
  return (
    <FlatList
      data={data.channels}
      keyExtractor={(c) => c.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.brand} />}
      ListEmptyComponent={<Empty text="No channels yet." />}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id, name: item.name } })}
          style={({ pressed }) => ({ padding: 16, backgroundColor: pressed ? t.surface2 : t.surface, borderBottomWidth: 1, borderColor: t.border, flexDirection: 'row', gap: 12, alignItems: 'center' })}
        >
          <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: t.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
            <T style={{ color: t.brand, fontWeight: '800', fontSize: 18 }}>#</T>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T variant="h2">{item.name}</T>
              {item.lastMessage && <T variant="muted">{relTime(item.lastMessage.createdAt)}</T>}
            </View>
            <T variant="small" numberOfLines={1}>
              {item.lastMessage ? `${item.lastMessage.user.name.split(' ')[0]}: ${item.lastMessage.body}` : item.topic}
            </T>
          </View>
        </Pressable>
      )}
    />
  )
}
