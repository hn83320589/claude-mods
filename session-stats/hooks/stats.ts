import type { AgentRow, CacheStat, ToolStat } from '../types'

// ── 工具統計 ──

export const recordTool = (stats: ToolStat[], tool: string, ms: number, ok: boolean): ToolStat[] => {
  const found = stats.find(s => s.tool === tool)
  if (found === undefined) return [...stats, { tool, count: 1, failed: ok ? 0 : 1, totalMs: ms, maxMs: ms }]
  return stats.map(s =>
    s.tool === tool
      ? { ...s, count: s.count + 1, failed: s.failed + (ok ? 0 : 1), totalMs: s.totalMs + ms, maxMs: Math.max(s.maxMs, ms) }
      : s,
  )
}

export const summarizeTools = (stats: readonly ToolStat[]) => {
  const total = stats.reduce((n, s) => n + s.count, 0)
  const failed = stats.reduce((n, s) => n + s.failed, 0)
  const top = [...stats].sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool))
  const slowest = stats.reduce<ToolStat | null>((best, s) => (best === null || s.maxMs > best.maxMs ? s : best), null)
  return { total, failed, top, slowest }
}

// ── Prompt cache 命中率 ──

type ModelUsageLike = { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }

export const ratio = (read: number, creation: number, input: number): number | null => {
  const total = read + creation + input
  return total > 0 ? Math.round((read / total) * 100) : null
}

export const recordCache = (stat: CacheStat, usage: ModelUsageLike | undefined): CacheStat => {
  if (usage === undefined) return stat
  const read = usage.cache_read_input_tokens ?? 0
  const creation = usage.cache_creation_input_tokens ?? 0
  const input = usage.input_tokens ?? 0
  return {
    read: stat.read + read,
    creation: stat.creation + creation,
    input: stat.input + input,
    last: ratio(read, creation, input) ?? stat.last,
  }
}

// ── Session 計時 ──

export const duration = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

// ── Subagent ──

const ACTIVE = ['pending', 'running', 'waiting']
const STATUS_NAMES: Record<string, string> = {
  pending: '等待開始',
  running: '執行中',
  waiting: '等待中',
  idle: '閒置',
  completed: '完成',
  failed: '失敗',
  killed: '已停止',
}

export const statusName = (status: string): string => STATUS_NAMES[status] ?? status

// 只列還在跑的與失敗的；完成的就不占空間
export const visibleAgents = (agents: readonly AgentRow[]): AgentRow[] =>
  agents.filter(a => ACTIVE.includes(a.status) || a.status === 'failed')
