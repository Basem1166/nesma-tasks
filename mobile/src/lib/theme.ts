import { useColorScheme } from 'react-native'

const light = {
  bg: '#f4f5f3',
  surface: '#fcfcfb',
  surface2: '#eeefeb',
  border: 'rgba(11,11,11,0.1)',
  text: '#0b0b0b',
  text2: '#52514e',
  muted: '#898781',
  brand: '#0f766e',
  brandInk: '#ffffff',
  brandSoft: '#d9f0ec',
  danger: '#c0352f',
  dangerSoft: '#fbe5e3',
  warnSoft: '#fdf1d6',
  good: '#0a7d0a',
  goodSoft: '#e1f4df',
  // categorical slots 1-4, fixed order (status identity)
  s1: '#2a78d6',
  s2: '#eb6834',
  s3: '#1baf7a',
  s4: '#eda100',
}

const dark: typeof light = {
  bg: '#0d0d0d',
  surface: '#1a1a19',
  surface2: '#262624',
  border: 'rgba(255,255,255,0.1)',
  text: '#f0efec',
  text2: '#c3c2b7',
  muted: '#898781',
  brand: '#2bb3a5',
  brandInk: '#062b28',
  brandSoft: '#123532',
  danger: '#ef6b65',
  dangerSoft: '#3a1a18',
  warnSoft: '#3a2e12',
  good: '#0ca30c',
  goodSoft: '#142e14',
  s1: '#3987e5',
  s2: '#d95926',
  s3: '#199e70',
  s4: '#c98500',
}

export type Theme = typeof light

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light
}
