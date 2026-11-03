import * as Notifications from 'expo-notifications'
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { useEffect } from 'react'
import { useColorScheme } from 'react-native'
import { SessionProvider, useSession } from '@/lib/session'
import { useTheme } from '@/lib/theme'

SplashScreen.preventAutoHideAsync()

/** Opens the related screen when the user taps a push notification. */
function useNotificationRouting() {
  const { user } = useSession()
  const last = Notifications.useLastNotificationResponse()
  useEffect(() => {
    if (!user || !last || last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return
    const data = last.notification.request.content.data as { taskId?: string; channelId?: string; type?: string }
    if (data.taskId) router.push({ pathname: '/task/[id]', params: { id: data.taskId } })
    else if (data.channelId) router.push({ pathname: '/chat/[id]', params: { id: data.channelId } })
    void Notifications.clearLastNotificationResponseAsync()
  }, [last, user])
}

function RootStack() {
  const { ready } = useSession()
  const t = useTheme()
  useNotificationRouting()
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync()
  }, [ready])
  if (!ready) return null
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: t.surface }, headerTintColor: t.text, contentStyle: { backgroundColor: t.bg } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="task/[id]" options={{ title: 'Task' }} />
      <Stack.Screen name="task/new" options={{ title: 'New task', presentation: 'modal' }} />
      <Stack.Screen name="chat/[id]" options={{ title: 'Channel' }} />
      <Stack.Screen name="profile" options={{ title: 'Profile' }} />
    </Stack>
  )
}

export default function RootLayout() {
  const scheme = useColorScheme()
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <SessionProvider>
        <RootStack />
      </SessionProvider>
    </ThemeProvider>
  )
}
