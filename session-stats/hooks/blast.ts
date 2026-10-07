import type { FileEdit } from '../types'

// 影響範圍：本 session 改過哪些檔案、各幾行，依專案第一層資料夾分組。

type Hunk = { lines?: readonly unknown[] }

export const countPatch = (patch: unknown): { added: number; removed: number } => {
  let added = 0
  let removed = 0
  for (const hunk of Array.isArray(patch) ? (patch as Hunk[]) : []) {
    for (const line of hunk.lines ?? []) {
      if (typeof line !== 'string') continue
      if (line.startsWith('+')) added += 1
      else if (line.startsWith('-')) removed += 1
    }
  }
  return { added, removed }
}

const slash = (path: string): string => path.replaceAll(String.fromCharCode(92), '/')

// root 之外的檔案歸到「專案外」；root 底下的檔案依第一層資料夾分組
export const locate = (path: string, root: string): { group: string; rel: string } => {
  const p = slash(path)
  const r = slash(root).endsWith('/') ? slash(root).slice(0, -1) : slash(root)
  if (r === '' || !p.toLowerCase().startsWith(`${r.toLowerCase()}/`)) {
    return { group: '專案外', rel: p.split('/').slice(-2).join('/') }
  }
  const rel = p.slice(r.length + 1)
  const parts = rel.split('/')
  return { group: parts.length > 1 ? (parts[0] ?? '') : '(根目錄)', rel }
}

export const recordEdit = (edits: FileEdit[], path: string, root: string, added: number, removed: number): FileEdit[] => {
  const { group, rel } = locate(path, root)
  const found = edits.find(e => e.path === path)
  if (found === undefined) return [...edits, { path, rel, group, added, removed }]
  return edits.map(e => (e.path === path ? { ...e, added: e.added + added, removed: e.removed + removed } : e))
}

export type BlastGroup = { name: string; files: FileEdit[]; added: number; removed: number }

export const groupEdits = (edits: readonly FileEdit[]): BlastGroup[] => {
  const map = new Map<string, FileEdit[]>()
  for (const e of edits) map.set(e.group, [...(map.get(e.group) ?? []), e])
  return [...map.entries()]
    .map(([name, files]) => ({
      name,
      files: [...files].sort((a, b) => b.added + b.removed - (a.added + a.removed)),
      added: files.reduce((n, f) => n + f.added, 0),
      removed: files.reduce((n, f) => n + f.removed, 0),
    }))
    .sort((a, b) => b.added + b.removed - (a.added + a.removed))
}

const isTest = (e: FileEdit): boolean => /test/i.test(e.rel)
const isCode = (e: FileEdit): boolean => /\.(cs|ts|tsx|js|jsx|py|go|rs|java|kt|xaml)$/i.test(e.rel) && e.group !== '專案外'

// 改了程式碼卻沒動任何測試檔
export const isUntested = (edits: readonly FileEdit[]): boolean =>
  edits.some(e => isCode(e) && !isTest(e)) && !edits.some(isTest)
