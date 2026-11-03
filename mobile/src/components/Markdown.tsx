import { Fragment } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { useTheme } from '@/lib/theme'

/**
 * Minimal Markdown renderer for assistant answers: headings, paragraphs,
 * bullet/numbered lists, **bold**, *italic*, `code` and pipe tables.
 * Renders text only - no links or HTML are executed.
 */
export function Markdown({ children }: { children: string }) {
  const t = useTheme()
  const lines = children.replace(/\r/g, '').split('\n')
  const blocks: React.ReactNode[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.trim()) continue

    if (line.trim().startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        const cells = lines[i]!.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells)
        i++
      }
      i--
      blocks.push(
        <ScrollView key={i} horizontal style={{ marginVertical: 6 }}>
          <View style={{ borderWidth: 1, borderColor: t.border, borderRadius: 6 }}>
            {rows.map((r, ri) => (
              <View key={ri} style={{ flexDirection: 'row', backgroundColor: ri === 0 ? t.surface2 : undefined, borderTopWidth: ri ? 1 : 0, borderColor: t.border }}>
                {r.map((c, ci) => (
                  <Text key={ci} style={{ width: ci === 0 ? 130 : 96, padding: 6, fontSize: 13, color: t.text, fontWeight: ri === 0 ? '700' : '400' }}>
                    <Inline text={c} />
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>,
      )
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push(
        <Text key={i} style={{ fontSize: heading[1]!.length <= 2 ? 17 : 15, fontWeight: '700', color: t.text, marginTop: 10, marginBottom: 4 }}>
          <Inline text={heading[2]!} />
        </Text>,
      )
      continue
    }

    const bullet = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line)
    if (bullet) {
      const indent = line.length - line.trimStart().length
      blocks.push(
        <View key={i} style={{ flexDirection: 'row', paddingLeft: 4 + Math.min(indent, 8) * 3, marginBottom: 3 }}>
          <Text style={{ color: t.text2, width: 18 }}>{/\d/.test(bullet[1]!) ? bullet[1] : '•'}</Text>
          <Text style={{ flex: 1, color: t.text, fontSize: 15, lineHeight: 21 }}><Inline text={bullet[2]!} /></Text>
        </View>,
      )
      continue
    }

    const quote = /^>\s?(.*)$/.exec(line)
    blocks.push(
      <Text key={i} style={{ color: quote ? t.text2 : t.text, fontSize: 15, lineHeight: 21, marginBottom: 6, fontStyle: quote ? 'italic' : 'normal' }}>
        <Inline text={quote ? quote[1]! : line} />
      </Text>,
    )
  }
  return <View>{blocks}</View>
}

function Inline({ text }: { text: string }) {
  const t = useTheme()
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).filter(Boolean)
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) return <Text key={i} style={{ fontWeight: '700' }}>{p.slice(2, -2)}</Text>
        if (p.startsWith('`') && p.endsWith('`')) return <Text key={i} style={{ fontFamily: 'monospace', backgroundColor: t.surface2 }}>{p.slice(1, -1)}</Text>
        if (p.startsWith('*') && p.endsWith('*') && p.length > 2) return <Text key={i} style={{ fontStyle: 'italic' }}>{p.slice(1, -1)}</Text>
        return <Fragment key={i}>{p}</Fragment>
      })}
    </>
  )
}
