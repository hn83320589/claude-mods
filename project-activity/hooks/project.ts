import type { CheckRow, CheckSpec, FileHeat } from '../types'
import { clean } from './text'

// 任何專案通用的「專案狀態」：專案類型、關鍵檔案，以及專案自己設定的檢查清單。
// 專案特有的檢查寫在 <專案>/.claude/project-activity.json，mod 本身不寫死任何專案。

export const CONFIG_PATH = '.claude/project-activity.json'

export type RootEntry = { name: string; kind: 'file' | 'dir' | 'other' }

// 依根目錄的標記檔判斷專案類型；一個專案可以同時是多種
const MARKERS: readonly { type: string; match: (name: string) => boolean }[] = [
  { type: '.NET', match: n => /[.](sln|slnf|csproj|fsproj|vbproj)$/i.test(n) || n === 'Directory.Build.props' },
  { type: 'Node.js', match: n => n === 'package.json' },
  { type: 'Python', match: n => n === 'pyproject.toml' || n === 'requirements.txt' || n === 'setup.py' },
  { type: 'Go', match: n => n === 'go.mod' },
  { type: 'Rust', match: n => n === 'Cargo.toml' },
  { type: 'Java', match: n => n === 'pom.xml' || /^build[.]gradle/.test(n) },
]

export const detectTypes = (entries: readonly RootEntry[]): string[] =>
  MARKERS.filter(m => entries.some(e => e.kind === 'file' && m.match(e.name))).map(m => m.type)

const KEY_FILES: readonly { label: string; match: (name: string) => boolean }[] = [
  { label: 'README', match: n => /^readme([.]|$)/i.test(n) },
  { label: 'CLAUDE.md', match: n => n === 'CLAUDE.md' },
  { label: '.gitignore', match: n => n === '.gitignore' },
  { label: 'LICENSE', match: n => /^licen[cs]e([.]|$)/i.test(n) },
]

export const keyFiles = (entries: readonly RootEntry[]): { label: string; found: boolean }[] =>
  KEY_FILES.map(k => ({ label: k.label, found: entries.some(e => e.kind === 'file' && k.match(e.name)) }))

// 設定檔格式：{ "checks": [{ "path": "Data/名單.xlsx", "required": true, "dir": false, "note": "..." }] }
// 格式不對時丟出可讀的錯誤，讓 pane 直接顯示原因
export const parseConfig = (text: string): CheckSpec[] => {
  const raw: unknown = JSON.parse(text)
  const checks = (raw as { checks?: unknown } | null)?.checks
  if (!Array.isArray(checks)) throw new Error('缺少 "checks" 陣列')
  return checks.map((c, i) => {
    const item = c as Partial<CheckSpec> | null
    if (typeof item?.path !== 'string' || item.path === '') throw new Error(`checks[${i}] 缺少 "path"`)
    return { path: clean(item.path), required: item.required === true, dir: item.dir === true, note: typeof item.note === 'string' ? clean(item.note) : null }
  })
}

export const sizeOf = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)}KB` : `${bytes}B`

export const ago = (mtimeMs: number, now: number): string => {
  const minutes = Math.max(0, Math.round((now - mtimeMs) / 60000))
  if (minutes < 1) return '剛剛'
  if (minutes < 60) return `${minutes} 分鐘前`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} 小時前`
  return `${Math.floor(minutes / 60 / 24)} 天前`
}

// found：檢查時實際看到的東西；undefined 代表不存在
export type Found = { kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number; count: number }

export const describeCheck = (spec: CheckSpec, found: Found | undefined, now: number): CheckRow => {
  const name = spec.path
  const isRightKind = found !== undefined && (spec.dir ? found.kind === 'dir' : found.kind === 'file')
  if (found === undefined || !isRightKind) {
    return spec.required
      ? { name, state: 'missing-required', detail: spec.note ?? '缺少（必要）' }
      : { name, state: 'missing-optional', detail: spec.note ?? '尚未產生' }
  }
  const detail = spec.dir ? `${found.count} 份 · ${ago(found.mtimeMs, now)}` : `${sizeOf(found.size)} · ${ago(found.mtimeMs, now)}`
  return { name, state: 'ok', detail }
}

// ── 熱門檔案 ──

export const recordHeat = (list: FileHeat[], path: string, kind: 'read' | 'edit'): FileHeat[] => {
  const found = list.find(f => f.path === path)
  const base = found ?? { path, reads: 0, edits: 0 }
  const next = { ...base, reads: base.reads + (kind === 'read' ? 1 : 0), edits: base.edits + (kind === 'edit' ? 1 : 0) }
  return found === undefined ? [...list, next] : list.map(f => (f.path === path ? next : f))
}

export const hottest = (list: readonly FileHeat[]): FileHeat[] =>
  [...list].sort((a, b) => b.reads + b.edits - (a.reads + a.edits) || b.reads - a.reads)
