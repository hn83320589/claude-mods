export type RateLimit = { kind: string; percentUsed: number; resetsAt: string | null }

export type Usage = {
  model: string
  startedAt: number
  turns: number
  percent: number | null
  tokens: number | null
  window: number
  costUsd: number | null
  rateLimits: RateLimit[]
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed'
export type Task = { id: string; subject: string; status: TaskStatus }

export type Running = { id: string; tool: string; label: string }

export type ContextRow = { name: string; tokens: number }
// compactAt：扣掉 auto-compact 保留區之後的觸發點；沒有保留區時為 null
export type ContextBreakdown = {
  rows: ContextRow[]
  totalTokens: number
  maxTokens: number
  percentage: number
  compactAt: number | null
}

export type FileEdit = { path: string; rel: string; group: string; added: number; removed: number }

export type ReplayStep = { id: string; tool: string; label: string; ms: number; ok: boolean; summary: string }
export type ReplayTurn = { id: string; prompt: string; steps: ReplayStep[] }
export type ReplayCursor = { turn: number; step: number }

export type ToolStat = { tool: string; count: number; failed: number; totalMs: number; maxMs: number }
export type CacheStat = { read: number; creation: number; input: number; last: number | null }
export type AgentRow = { id: string; type: string; description: string; status: string }

declare module 'claude-code' {
  interface PluginState {
    'session-stats': {
      isOpen: boolean
      toolCalls: number
      usage: Usage | null
      tasks: Task[]
      running: Running[]
      context: ContextBreakdown | null
      history: number[]
      edits: FileEdit[]
      root: string
      replay: ReplayTurn[]
      cursor: ReplayCursor | null
      toolStats: ToolStat[]
      cache: CacheStat
      agents: AgentRow[]
      tick: number
    }
  }
}
