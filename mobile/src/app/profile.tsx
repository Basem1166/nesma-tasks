import { router } from 'expo-router'
import { useState } from 'react'
import { ScrollView, Switch, View } from 'react-native'
import { Avatar, Button, Card, ErrorText, T } from '@/components/ui'
import { api, errorText, getServerUrl } from '@/lib/api'
import { registerForPush } from '@/lib/push'
import { useSession, useUser } from '@/lib/session'
import { useTheme } from '@/lib/theme'
import type { User } from '@/lib/types'

export default function Profile() {
  const user = useUser()
  const { logout, setUser, pushStatus } = useSession()
  const t = useTheme()
  const [error, setError] = useState<string | null>(null)
  const [pushMsg, setPushMsg] = useState<string | null>(pushStatus)

  const toggleEmail = async (value: boolean) => {
    try {
      const r = await api<{ user: User }>('/users/me/profile', { method: 'PATCH', json: { emailNotifications: value } })
      setUser(r.user)
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Card style={{ alignItems: 'center', gap: 6 }}>
        <Avatar name={user.name} size={64} />
        <T variant="title">{user.name}</T>
        <T variant="small">{user.email}</T>
        <T variant="muted">{user.role === 'LEADER' ? 'Team leader' : 'Team member'}{user.title ? ` · ${user.title}` : ''}</T>
      </Card>
      <Card style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <T>Email notifications</T>
            <T variant="muted">Assignments, updates, deadlines, overdue alerts</T>
          </View>
          <Switch value={user.emailNotifications} onValueChange={toggleEmail} trackColor={{ true: t.brand }} />
        </View>
        <View style={{ gap: 6 }}>
          <T>Push notifications</T>
          <T variant="muted">{pushMsg === 'enabled' ? 'Enabled on this device' : pushMsg ?? 'Checking…'}</T>
          {pushMsg !== 'enabled' && (
            <Button title="Enable push" variant="secondary" onPress={async () => { const r = await registerForPush(); setPushMsg(r.ok ? 'enabled' : r.reason) }} />
          )}
        </View>
        <ErrorText error={error} />
      </Card>
      <T variant="muted" style={{ textAlign: 'center' }}>Connected to {getServerUrl()}</T>
      <Button
        title="Sign out"
        variant="danger"
        onPress={async () => {
          await logout()
          router.replace('/login')
        }}
      />
    </ScrollView>
  )
}
