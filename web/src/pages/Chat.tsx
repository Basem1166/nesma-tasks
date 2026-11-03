import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, errorText } from '../api'
import { Avatar, ErrorBox, Loading, Modal } from '../components/ui'
import { relTime, useApi } from '../hooks'
import { useSession, useSocketEvent, useUser } from '../session'
import type { Channel, ChatMessage } from '../types'

export function Chat() {
  const user = useUser()
  const { socket } = useSession()
  const { data, reload } = useApi<{ channels: Channel[] }>('/channels')
  const [active, setActive] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [typing, setTyping] = useState<{ name: string; until: number } | null>(null)
  const [creating, setCreating] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const lastTyped = useRef(0)

  useEffect(() => {
    if (!active && data?.channels[0]) setActive(data.channels[0].id)
  }, [data, active])

  useEffect(() => {
    if (!active) return
    setLoading(true)
    api<{ messages: ChatMessage[] }>(`/channels/${active}/messages`)
      .then((r) => setMessages(r.messages))
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false))
  }, [active])

  // Braces matter: scrollIntoView() returns a Promise in current browsers, and an
  // effect must return nothing or a cleanup function.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  useSocketEvent<ChatMessage>('chat:message', (m) => {
    if (m.channelId === active) setMessages((ms) => (ms.some((x) => x.id === m.id) ? ms : [...ms, m]))
    void reload()
  })
  useSocketEvent('chat:channel', () => void reload())
  useSocketEvent<{ channelId: string; name: string }>('chat:typing', (t) => {
    if (t.channelId === active) setTyping({ name: t.name, until: Date.now() + 3000 })
  })
  useEffect(() => {
    if (!typing) return
    const id = setTimeout(() => setTyping(null), typing.until - Date.now())
    return () => clearTimeout(id)
  }, [typing])

  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim() || !active) return
    const body = text
    setText('')
    try {
      const { message } = await api<{ message: ChatMessage }>(`/channels/${active}/messages`, { method: 'POST', json: { body } })
      setMessages((ms) => (ms.some((x) => x.id === message.id) ? ms : [...ms, message]))
    } catch (err) {
      setError(errorText(err))
      setText(body)
    }
  }

  const onType = (v: string) => {
    setText(v)
    if (socket && active && Date.now() - lastTyped.current > 2000) {
      lastTyped.current = Date.now()
      socket.emit('chat:typing', active)
    }
  }

  if (!data) return <Loading />
  const channel = data.channels.find((c) => c.id === active)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Team chat</h1>
          <p>Real-time channels shared with the mobile app.</p>
        </div>
        {user.role === 'LEADER' && <button className="btn" onClick={() => setCreating(true)}>+ Channel</button>}
      </div>
      <ErrorBox error={error} />
      <div className="card chat">
        <div className="chat-list">
          {data.channels.map((c) => (
            <button key={c.id} className={c.id === active ? 'active' : ''} onClick={() => setActive(c.id)}>
              <div style={{ fontWeight: 600 }}># {c.name}</div>
              {c.lastMessage && (
                <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.lastMessage.user.name.split(' ')[0]}: {c.lastMessage.body}
                </div>
              )}
            </button>
          ))}
        </div>
        <div className="chat-pane">
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <h2># {channel?.name}</h2>
            {channel?.topic && <div className="small muted">{channel.topic}</div>}
          </div>
          <div className="chat-msgs">
            {loading ? <Loading /> : messages.length === 0 ? <div className="empty">No messages yet. Say hello 👋</div> : null}
            {messages.map((m) => {
              const mine = m.user.id === user.id
              return (
                <div key={m.id} className={`msg ${mine ? 'mine' : ''}`}>
                  {!mine && <Avatar name={m.user.name} />}
                  <div>
                    {!mine && <div className="small" style={{ fontWeight: 600, marginBottom: 2 }}>{m.user.name}</div>}
                    <div className="bubble">{m.body}</div>
                    <div className="small muted" style={{ marginTop: 2, textAlign: mine ? 'right' : 'left' }}>{relTime(m.createdAt)}</div>
                  </div>
                </div>
              )
            })}
            <div ref={bottom} />
          </div>
          <div className="small muted" style={{ padding: '0 16px', height: 18 }}>{typing ? `${typing.name} is typing…` : ''}</div>
          <form className="chat-input" onSubmit={send}>
            <input className="input" placeholder={`Message #${channel?.name ?? ''}`} value={text} onChange={(e) => onType(e.target.value)} maxLength={4000} />
            <button className="btn primary" disabled={!text.trim()}>Send</button>
          </form>
        </div>
      </div>
      {creating && <NewChannel onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); void reload(); setActive(id) }} />}
    </>
  )
}

function NewChannel({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      const { channel } = await api<{ channel: Channel }>('/channels', { method: 'POST', json: { name, topic } })
      onCreated(channel.id)
    } catch (err) {
      setError(errorText(err))
    }
  }
  return (
    <Modal title="New channel" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="field"><label htmlFor="c-name">Name</label><input id="c-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. project-alpha" required /></div>
        <div className="field"><label htmlFor="c-topic">Topic</label><input id="c-topic" className="input" value={topic} onChange={(e) => setTopic(e.target.value)} /></div>
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary">Create</button></div>
      </form>
    </Modal>
  )
}
