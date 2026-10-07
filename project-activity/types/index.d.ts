export type TestRun = { runner: string; passed: number; failed: number; total: number; isOk: boolean }
export type ToolCall = { id: string; tool: string; label: string; isDone: boolean; isError: boolean }
// seconds 為 null 代表回合還在進行中
export type Turn = { seconds: number | null; tools: number; edits: number }

export type FileHeat = { path: string; reads: number; edits: number }

export type CheckSpec = { path: string; required: boolean; dir: boolean; note: string | null }
export type CheckRow = { name: string; state: 'ok' | 'missing-required' | 'missing-optional'; detail: string }

// checks 為 null 代表專案沒有設定檔；configError 是設定檔讀取或格式錯誤的原因
export type ProjectStatus = {
  name: string
  types: string[]
  keyFiles: { label: string; found: boolean }[]
  checks: CheckRow[] | null
  configError: string | null
}

export type GitFile = {
  path: string
  // 暫存區與工作區各自的狀態字母，例如 M、A、D、R；'.' 代表沒變
  staged: string
  unstaged: string
  kind: 'changed' | 'untracked' | 'conflict'
}
export type GitStatus = { branch: string; upstream: string | null; ahead: number; behind: number; files: GitFile[] }
export type NumStat = Record<string, { added: number; removed: number }>
export type GitCommit = { hash: string; subject: string; author: string; time: number }

// isRepo 為 false 代表不是 git repository；error 是 git 指令失敗的原因
export type GitView = {
  isRepo: boolean
  status: GitStatus | null
  staged: NumStat
  unstaged: NumStat
  commits: GitCommit[]
  stashes: number
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'project-activity': {
      lastTest: TestRun | null
      lastTestAt: number | null
      calls: ToolCall[]
      edited: string[]
      turn: Turn | null
      isBandHidden: boolean
      heat: FileHeat[]
      project: ProjectStatus | null
      isGitOpen: boolean
      git: GitView | null
    }
  }
}
