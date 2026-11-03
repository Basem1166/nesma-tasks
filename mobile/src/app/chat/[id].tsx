import { Stack, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native'
import { Avatar, ErrorText, Loading, T } from '@/components/ui'
import { api, errorText } from '@/lib/api'
import { relTime } from '@/lib/format'
import { useSession, useSocketEvent, useUser } from '@/lib/session'
import { useTheme } from '@/lib/theme'
import type { ChatMessage } from '@/lib/types'

export default function ChannelScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>()
  const user = useUser()
  const { socket } = useSession()
  const t = useTheme()
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [typing, setTyping] = useState<string | null>(null)
  const lastTyped = useRef(0)
  const list = useRef<FlatList<ChatMessage>>(null)

  useEffect(() => {
    api<{ messages: ChatMessage[] }>(`/channels/${id}/messages`)
      .then((r) => setMessages(r.messages))
      .catch((e) => setError(errorText(e)))
  }, [id])

  useSocketEvent<ChatMessage>('chat:message', (m) => {
    if (m.channelId === id) setMessages((ms) => (ms && !ms.some((x) => x.id === m.id) ? [...ms, m] : ms))
  })
  useSocketEvent<{ channelId: string; name: string }>('chat:typing', (e) => {
    if (e.channelId !== id) return
    setTyping(e.name)
    setTimeout(() => setTyping(null), 3000)
  })

  const send = async () => {
    const body = text.trim()
    if (!body) return
    setText('')
    try {
      const { message } = await api<{ message: ChatMessage }>(`/channels/${id}/messages`, { method: 'POST', json: { body } })
      setMessages((ms) => (ms && !ms.some((x) => x.id === message.id) ? [...ms, message] : ms))
    } catch (e) {
      setError(errorText(e))
      setText(body)
    }
  }

  const onChange = (v: string) => {
    setText(v)
    if (socket && Date.now() - lastTyped.current > 2000) {
      lastTyped.current = Date.now()
      socket.emit('chat:typing', id)
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: name ? `# ${name}` : 'Channel' }} />
      {!messages ? (
        <Loading />
      ) : (
        <FlatList
          ref={list}
          data={messages}
          keyExtractor={(m) => m.id}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
          contentContainerStyle={{ padding: 12, gap: 10 }}
          renderItem={({ item }) => {
            const mine = item.user.id === user.id
            return (
              <View style={{ flexDirection: mine ? 'row-reverse' : 'row', gap: 8, alignItems: 'flex-end' }}>
                {!mine && <Avatar name={item.user.name} size={28} />}
                <View style={{ maxWidth: '78%' }}>
                  {!mine && <T variant="muted" style={{ marginBottom: 2 }}>{item.user.name}</T>}
                  <View style={{ backgroundColor: mine ? t.brand : t.surface2, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 }}>
                    <T style={{ color: mine ? t.brandInk : t.text }}>{item.body}</T>
                  </View>
                  <T variant="muted" style={{ marginTop: 2, textAlign: mine ? 'right' : 'left' }}>{relTime(item.createdAt)}</T>
                </View>
              </View>
            )
          }}
        />
      )}
      <ErrorText error={error} />
      <T variant="muted" style={{ paddingHorizontal: 14, height: 16 }}>{typing ? `${typing} is typing…` : ''}</T>
      <View style={{ flexDirection: 'row', gap: 8, padding: 10, borderTopWidth: 1, borderColor: t.border, backgroundColor: t.surface }}>
        <TextInput
          value={text}
          onChangeText={onChange}
          placeholder="Message"
          placeholderTextColor={t.muted}
          multiline
          style={{ flex: 1, borderWidth: 1, borderColor: t.border, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, color: t.text, maxHeight: 120 }}
        />
        <Pressable onPress={send} disabled={!text.trim()} style={{ backgroundColor: t.brand, borderRadius: 18, paddingHorizontal: 16, justifyContent: 'center', opacity: text.trim() ? 1 : 0.5 }}>
          <T style={{ color: t.brandInk, fontWeight: '600' }}>Send</T>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}
