import Ionicons from '@expo/vector-icons/Ionicons'
import { Redirect, Tabs } from 'expo-router'
import type { ColorValue } from 'react-native'
import { useApi } from '@/lib/useApi'
import { useSession, useSocketEvent } from '@/lib/session'
import { useTheme } from '@/lib/theme'

type IconName = keyof typeof Ionicons.glyphMap
const icon = (name: IconName) =>
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={String(color)} size={size} />
  }

export default function TabsLayout() {
  const { user } = useSession()
  const t = useTheme()
  const unread = useApi<{ unread: number }>(user ? '/notifications' : null)
  useSocketEvent('notification:new', () => void unread.reload())

  if (!user) return <Redirect href="/login" />

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.brand,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.border },
        headerStyle: { backgroundColor: t.surface },
        headerTintColor: t.text,
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="tasks" options={{ title: 'Tasks', tabBarIcon: icon('checkbox-outline') }} />
      <Tabs.Screen name="chat" options={{ title: 'Chat', tabBarIcon: icon('chatbubbles-outline') }} />
      <Tabs.Screen name="assistant" options={{ title: 'AI', tabBarIcon: icon('sparkles-outline'), headerTitle: 'AI assistant' }} />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarIcon: icon('notifications-outline'),
          tabBarBadge: unread.data?.unread ? Math.min(unread.data.unread, 99) : undefined,
        }}
        listeners={{ focus: () => void unread.reload() }}
      />
    </Tabs>
  )
}
