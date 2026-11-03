import { useRef, useState } from 'react'
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native'
import { Markdown } from '@/components/Markdown'
import { Badge, ErrorText, T } from '@/components/ui'
import { api, errorText } from '@/lib/api'
import { useUser } from '@/lib/session'
import { useTheme } from '@/lib/theme'
import { useApi } from '@/lib/useApi'

interface Msg {
  id: string
  role: 'user' | 'assistant'
  text: string
  toolsUsed: string[]
}

const PROMPTS = {
  LEADER: ['What is overdue and who owns it?', 'Summarise team progress this month', 'Who has the heaviest workload?'],
  MEMBER: ['What should I work on first?', 'Summarise my week', 'Which of my tasks are at risk?'],
}

export default function Assistant() {
  const user = useUser()
  const t = useTheme()
  const status = useApi<{ configured: boolean; model: string }>('/ai/status')
  const [messages, setMessages] = useState<Msg[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const list = useRef<FlatList<Msg>>(null)

  const ask = async (text: string) => {
    if (!text.trim() || busy) return
    setError(null)
    setInput('')
    const pending: Msg = { id: `u-${messages.length}`, role: 'user', text, toolsUsed: [] }
    setMessages((m) => [...m, pending])
    setBusy(true)
    try {
      const r = await api<{ conversationId: string; reply: string; toolsUsed: string[] }>('/ai/chat', {
        method: 'POST',
        json: { message: text, conversationId: conversationId ?? undefined },
      })
      setConversationId(r.conversationId)
      setMessages((m) => [...m, { id: `a-${m.length}`, role: 'assistant', text: r.reply, toolsUsed: r.toolsUsed }])
    } catch (e) {
      setError(errorText(e))
      setMessages((m) => m.filter((x) => x.id !== pending.id))
      setInput(text)
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      {status.data && !status.data.configured && (
        <View style={{ margin: 12 }}>
          <ErrorText error="AI is not configured on the server (set AI_API_KEY in server/.env)." />
        </View>
      )}
      <FlatList
        ref={list}
        data={messages}
        keyExtractor={(m) => m.id}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        contentContainerStyle={{ padding: 14, gap: 14, flexGrow: 1 }}
        ListEmptyComponent={
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 40 }}>
            <T style={{ fontSize: 36 }}>✦</T>
            <T variant="h2">Ask about your {user.role === 'LEADER' ? "team's" : ''} tasks</T>
            <T variant="small" style={{ textAlign: 'center' }}>{"Answers come from AI using live data you're allowed to see."}</T>
            {PROMPTS[user.role].map((p) => (
              <Pressable key={p} onPress={() => ask(p)} style={{ borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 }}>
                <T variant="small" style={{ color: t.text }}>{p}</T>
              </Pressable>
            ))}
          </View>
        }
        renderItem={({ item }) =>
          item.role === 'user' ? (
            <View style={{ alignSelf: 'flex-end', backgroundColor: t.brand, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, maxWidth: '85%' }}>
              <T style={{ color: t.brandInk }}>{item.text}</T>
            </View>
          ) : (
            <View style={{ alignSelf: 'stretch', gap: 6 }}>
              {item.toolsUsed.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {item.toolsUsed.map((tool) => <Badge key={tool} label={`🔎 ${tool.replace(/_/g, ' ')}`} />)}
                </View>
              )}
              <Markdown>{item.text}</Markdown>
            </View>
          )
        }
        ListFooterComponent={busy ? <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><ActivityIndicator color={t.brand} /><T variant="small">Analysing team data…</T></View> : undefined}
      />
      <View style={{ paddingHorizontal: 12 }}><ErrorText error={error} /></View>
      <View style={{ flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 1, borderColor: t.border, backgroundColor: t.surface }}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Ask about tasks, deadlines, workload…"
          placeholderTextColor={t.muted}
          editable={!busy}
          multiline
          style={{ flex: 1, borderWidth: 1, borderColor: t.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, color: t.text, maxHeight: 120 }}
        />
        <Pressable onPress={() => ask(input)} disabled={busy || !input.trim()} style={{ backgroundColor: t.brand, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center', opacity: busy || !input.trim() ? 0.5 : 1 }}>
          <T style={{ color: t.brandInk, fontWeight: '600' }}>Ask</T>
        </Pressable>
      </View>
      {messages.length > 0 && (
        <Pressable onPress={() => { setMessages([]); setConversationId(null) }} style={{ position: 'absolute', top: 8, right: 12 }}>
          <Badge label="New chat" />
        </Pressable>
      )}
    </KeyboardAvoidingView>
  )
}
