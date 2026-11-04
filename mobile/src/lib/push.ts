import Constants, { ExecutionEnvironment } from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { AndroidImportance, IosAuthorizationStatus } from 'expo-notifications'
import { Platform } from 'react-native'
import { api } from './api'

// Show notifications as banners even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

let registeredToken: string | null = null

/**
 * Asks for permission, obtains the Expo push token and registers it with the
 * API so server-side workflow events reach this device. Returns a reason
 * string when push is unavailable (simulator, Expo Go on Android, no EAS
 * project id, permission denied) - the app keeps working without it.
 */
export async function registerForPush(): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
  // Never throws: notification problems must not break the rest of the app.
  try {
    return await register()
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Notifications are unavailable' }
  }
}

async function register(): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
  if (Platform.OS === 'web') return { ok: false, reason: 'Push is not supported on web' }
  if (Platform.OS === 'android') {
    // Name + importance only (as in Expo's docs): extra options such as
    // lightColor are rejected by some Android/Expo Go builds. If the channel
    // can't be created, Android falls back to Expo's default channel.
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Task updates',
      importance: AndroidImportance.MAX,
    }).catch(() => undefined)
  }
  if (!Device.isDevice) return { ok: false, reason: 'Push notifications need a physical device' }

  // Permission is needed for the local-notification fallback too, so ask first.
  const current = await Notifications.getPermissionsAsync()
  let granted = current.granted || current.ios?.status === IosAuthorizationStatus.PROVISIONAL
  if (!granted) granted = (await Notifications.requestPermissionsAsync()).granted
  if (!granted) return { ok: false, reason: 'Notification permission was not granted' }

  // Expo Go on Android can't receive remote push (since SDK 53); local notifications still work.
  if (Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return { ok: false, reason: 'Using in-app notifications (remote push needs a development build on Android)' }
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
  if (!projectId) return { ok: false, reason: 'Using in-app notifications (no EAS projectId for remote push)' }

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
  await api('/users/me/push-token', { method: 'POST', json: { token, platform: Platform.OS } })
  registeredToken = token
  return { ok: true, token }
}

/**
 * Fallback when remote push isn't available (Expo Go on Android, no EAS
 * project): show the notification the server sent over the realtime socket as
 * a local notification. Needs no Expo account or Firebase; works while the app
 * is running.
 */
export async function showLocalNotification(n: { title: string; body: string; taskId?: string | null }) {
  if (Platform.OS === 'web') return
  try {
    const { granted } = await Notifications.getPermissionsAsync()
    if (!granted) return
    await Notifications.scheduleNotificationAsync({
      // Only defined values: Android rejects null/undefined entries in `data`.
      content: { title: n.title, body: n.body, data: n.taskId ? { taskId: n.taskId } : {}, sound: true },
      trigger: null,
    })
  } catch (e) {
    console.warn('[notifications] could not show local notification:', e)
  }
}

/** Called on sign-out so this device stops receiving the previous user's notifications. */
export async function unregisterPush() {
  if (!registeredToken) return
  await api('/users/me/push-token', { method: 'DELETE', json: { token: registeredToken } }).catch(() => undefined)
  registeredToken = null
}
