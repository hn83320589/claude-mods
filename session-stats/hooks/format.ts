// 顏色一律用 Claude Code 的主題色名：淺色、深色主題都會換成看得清楚的版本。
// ANSI 色名（cyan、yellow）在白底上很難讀。
export const ACCENT = { usage: 'claude', tasks: 'suggestion', context: 'success' } as const
export const GOOD = 'success'
export const WARN = 'warning'
export const BAD = 'error'

export const levelColor = (percent: number): string => (percent >= 85 ? BAD : percent >= 60 ? WARN : GOOD)

export const barOf = (percent: number, width: number): { full: string; rest: string } => {
  const w = Math.max(0, width)
  const filled = Math.max(0, Math.min(w, Math.round((percent / 100) * w)))
  return { full: '━'.repeat(filled), rest: '─'.repeat(w - filled) }
}

const LIMIT_NAMES: Record<string, string> = { five_hour: '5 小時', seven_day: '7 天', spend_limit: '支出上限' }
export const limitName = (kind: string): string => LIMIT_NAMES[kind] ?? kind

export const compact = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

export const resetIn = (iso: string | null, now: number): string => {
  if (iso === null) return ''
  const minutes = Math.max(0, Math.round((Date.parse(iso) - now) / 60000))
  if (Number.isNaN(minutes)) return ''
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`
}
