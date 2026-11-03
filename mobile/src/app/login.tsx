import { Redirect } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Button, Card, ErrorText, T } from '@/components/ui'
import { errorText, getServerUrl, saveServerUrl } from '@/lib/api'
import { useSession } from '@/lib/session'
import { useTheme } from '@/lib/theme'

export default function Login() {
  const { user, login } = useSession()
  const t = useTheme()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [server, setServer] = useState(getServerUrl())
  const [showServer, setShowServer] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Redirect href="/" />

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (server !== getServerUrl()) await saveServerUrl(server)
      await login(email.trim(), password)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const input = { borderWidth: 1, borderColor: t.border, borderRadius: 10, padding: 12, fontSize: 16, color: t.text, backgroundColor: t.surface }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', marginBottom: 24 }}>
            <View style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
              <T style={{ color: t.brandInk, fontSize: 30, fontWeight: '800' }}>N</T>
            </View>
            <T variant="title">Nesma Tasks</T>
            <T variant="small" style={{ marginTop: 4 }}>Tasks, team chat and AI insights</T>
          </View>
          <Card style={{ gap: 12 }}>
            <T variant="small">Email</T>
            <TextInput style={input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="username" placeholder="you@company.com" placeholderTextColor={t.muted} />
            <T variant="small">Password</T>
            <TextInput style={input} value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" placeholder="••••••••" placeholderTextColor={t.muted} onSubmitEditing={submit} />
            {showServer && (
              <>
                <T variant="small">Server URL</T>
                <TextInput style={input} value={server} onChangeText={setServer} autoCapitalize="none" keyboardType="url" />
              </>
            )}
            <ErrorText error={error} />
            <Button title="Sign in" onPress={submit} loading={busy} disabled={!email || !password} />
          </Card>
          <Pressable onPress={() => setShowServer((s) => !s)} style={{ marginTop: 16, alignSelf: 'center' }}>
            <T variant="muted">Server: {getServerUrl()} · {showServer ? 'hide' : 'change'}</T>
          </Pressable>
          {__DEV__ && (
            <T variant="muted" style={{ textAlign: 'center', marginTop: 8 }}>
              Demo: leader@nesma.dev / sara@nesma.dev · password Nesma@2026
            </T>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
