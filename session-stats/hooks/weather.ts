import type { RateLimit } from '../types'

// Token 天氣：從每回合結束時的 context token 數推算走勢與預報。

const SPARKS = '▁▂▃▄▅▆▇█'
const BURN_WINDOW = 5
const HOUR = 3600_000
const WINDOW_MS: Record<string, number> = { five_hour: 5 * HOUR, seven_day: 7 * 24 * HOUR }

// 最近幾回合的平均成長量。下降（compact、清空）不算消耗，略過。
export const burnRate = (history: readonly number[]): number | null => {
  const deltas: number[] = []
  for (let i = 1; i < history.length; i += 1) {
    const d = (history[i] ?? 0) - (history[i - 1] ?? 0)
    if (d > 0) deltas.push(d)
  }
  const recent = deltas.slice(-BURN_WINDOW)
  if (recent.length === 0) return null
  return recent.reduce((a, b) => a + b, 0) / recent.length
}

export const sparkline = (values: readonly number[], max: number): string =>
  values
    .map(v => SPARKS[Math.max(0, Math.min(SPARKS.length - 1, Math.floor((v / Math.max(1, max)) * SPARKS.length)))])
    .join('')

export const turnsUntil = (current: number, limit: number, burn: number | null): number | null => {
  if (burn === null || burn <= 0) return null
  return Math.max(0, Math.floor((limit - current) / burn))
}

// 照目前速度線性外推，視窗重置時會用到多少 %。視窗走不到一成時資料太少，不預測。
export const projectLimit = (limit: RateLimit, now: number): number | null => {
  const windowMs = WINDOW_MS[limit.kind]
  if (windowMs === undefined || limit.resetsAt === null) return null
  const remaining = Date.parse(limit.resetsAt) - now
  if (Number.isNaN(remaining)) return null
  const elapsed = windowMs - remaining
  if (elapsed < windowMs * 0.1) return null
  return Math.round((limit.percentUsed * windowMs) / elapsed)
}

// 圖示都用單格寬的符號；⚡ 這類 emoji 在終端機占 2 格，會把整列撐開
export type Weather = { icon: string; label: string; color: string }

export const weatherOf = (worstPercent: number): Weather =>
  worstPercent >= 100
    ? { icon: '☈', label: '暴風', color: 'error' }
    : worstPercent >= 80
      ? { icon: '☂', label: '有雨', color: 'warning' }
      : worstPercent >= 50
        ? { icon: '☁', label: '多雲', color: 'suggestion' }
        : { icon: '☀', label: '晴朗', color: 'success' }
