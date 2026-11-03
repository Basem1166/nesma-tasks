import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { dueLabel, initials } from '@/lib/format'
import { useTheme, type Theme } from '@/lib/theme'
import { STATUS_LABEL, type Task, type TaskPriority, type TaskStatus } from '@/lib/types'

export const statusColor = (t: Theme, s: TaskStatus) => ({ TODO: t.s1, IN_PROGRESS: t.s2, IN_REVIEW: t.s3, DONE: t.s4 })[s]

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme()
  return <View style={[{ backgroundColor: t.surface, borderColor: t.border, borderWidth: 1, borderRadius: 12, padding: 14 }, style]}>{children}</View>
}

export function T({ children, style, variant = 'body', numberOfLines }: { children: ReactNode; style?: object; variant?: 'title' | 'h2' | 'body' | 'small' | 'muted'; numberOfLines?: number }) {
  const t = useTheme()
  const v = {
    title: { fontSize: 22, fontWeight: '700' as const, color: t.text },
    h2: { fontSize: 16, fontWeight: '600' as const, color: t.text },
    body: { fontSize: 15, color: t.text },
    small: { fontSize: 13, color: t.text2 },
    muted: { fontSize: 12, color: t.muted },
  }[variant]
  return <Text style={[v, style]} numberOfLines={numberOfLines}>{children}</Text>
}

export function Badge({ label, color, bg, dot }: { label: string; color?: string; bg?: string; dot?: string }) {
  const t = useTheme()
  return (
    <View style={[styles.badge, { backgroundColor: bg ?? t.surface2 }]}>
      {dot && <View style={[styles.dot, { backgroundColor: dot }]} />}
      <Text style={{ fontSize: 12, fontWeight: '600', color: color ?? t.text2 }}>{label}</Text>
    </View>
  )
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const t = useTheme()
  return <Badge label={STATUS_LABEL[status]} dot={statusColor(t, status)} bg={status === 'DONE' ? t.goodSoft : undefined} color={status === 'DONE' ? t.good : undefined} />
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const t = useTheme()
  const label = priority.charAt(0) + priority.slice(1).toLowerCase()
  if (priority === 'URGENT') return <Badge label={`⚑ ${label}`} bg={t.dangerSoft} color={t.danger} />
  if (priority === 'HIGH') return <Badge label={`▲ ${label}`} bg={t.warnSoft} color={t.text} />
  return <Badge label={label} />
}

export function DueBadge({ task }: { task: Pick<Task, 'dueDate' | 'status' | 'overdue'> }) {
  const t = useTheme()
  const label = dueLabel(task.dueDate, task.status === 'DONE')
  return task.overdue ? <Badge label={`⏰ ${label}`} bg={t.dangerSoft} color={t.danger} /> : <Badge label={label} />
}

export function ProgressBar({ value, showLabel = true }: { value: number; showLabel?: boolean }) {
  const t = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: value }}>
      <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: t.surface2, overflow: 'hidden' }}>
        <View style={{ width: `${value}%`, height: '100%', backgroundColor: t.brand, borderRadius: 3 }} />
      </View>
      {showLabel && <Text style={{ fontSize: 12, color: t.text2, width: 34, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{value}%</Text>}
    </View>
  )
}

export function Avatar({ name, size = 32, system }: { name?: string | null; size?: number; system?: boolean }) {
  const t = useTheme()
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: system ? t.surface2 : t.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: system ? t.muted : t.brand, fontWeight: '700', fontSize: size * 0.38 }}>{system ? '⚙' : initials(name)}</Text>
    </View>
  )
}

export function Button({ title, onPress, variant = 'primary', disabled, loading, style }: { title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle> }) {
  const t = useTheme()
  const bg = variant === 'primary' ? t.brand : t.surface
  const fg = variant === 'primary' ? t.brandInk : variant === 'danger' ? t.danger : t.text
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, { backgroundColor: bg, borderColor: variant === 'primary' ? t.brand : t.border, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: '600', fontSize: 15 }}>{title}</Text>}
    </Pressable>
  )
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  const t = useTheme()
  return (
    <Pressable onPress={onPress} style={[styles.chip, { backgroundColor: active ? t.brandSoft : t.surface, borderColor: active ? t.brand : t.border }]} accessibilityState={{ selected: active }}>
      <Text style={{ color: active ? t.brand : t.text2, fontWeight: active ? '600' : '400', fontSize: 13 }}>{label}</Text>
    </Pressable>
  )
}

export function ErrorText({ error }: { error: string | null }) {
  const t = useTheme()
  if (!error) return null
  return (
    <View style={{ backgroundColor: t.dangerSoft, padding: 10, borderRadius: 8 }}>
      <Text style={{ color: t.danger }}>{error}</Text>
    </View>
  )
}

export function Empty({ text }: { text: string }) {
  return (
    <View style={{ padding: 32, alignItems: 'center' }}>
      <T variant="muted" style={{ fontSize: 14, textAlign: 'center' }}>{text}</T>
    </View>
  )
}

export function Loading() {
  const t = useTheme()
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <ActivityIndicator color={t.brand} />
    </View>
  )
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  button: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
})
