import { clean } from './text'

/** context 用量達到這個百分比，就在回合結束後先壓縮，不等引擎在工具執行途中自動壓縮。 */
export const COMPACT_THRESHOLD = 80

/** 每次壓縮都加給摘要器的指示：保留接手工作需要的重點。 */
export const COMPACT_INSTRUCTIONS = [
  '摘要請保留以下內容，讓壓縮後能直接接續工作：',
  '1. 目前正在進行的任務、完成到哪一步、下一步要做什麼',
  '2. 已經做出的決定與原因（包含使用者否決或選定的方案）',
  '3. 新增、修改、刪除過的檔案路徑與改動重點',
  '4. 使用者的偏好、規則與限制（例如語言、提交方式、不可以做的事）',
  '5. 尚未解決的問題、錯誤訊息與已經嘗試過的做法',
].join('\n')

/** 摘要存放的資料夾（相對於專案根目錄）。 */
export const NOTES_DIR = '.claude/session-notes'

/** 資料夾內的 .gitignore：讓整個資料夾不被提交，不必修改專案自己的 .gitignore。 */
export const NOTES_GITIGNORE = '# Claude Code 壓縮時保存的工作階段摘要，只留在本機\n*\n'

const pad = (n: number): string => String(n).padStart(2, '0')

/** 例如 2026-10-07-1530.md；同一分鐘內第二次壓縮加上序號。 */
export const notesFileName = (now: Date, existing: readonly string[] = []): string => {
  const base = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  if (!existing.includes(`${base}.md`)) return `${base}.md`
  let n = 2
  while (existing.includes(`${base}-${n}.md`)) n += 1
  return `${base}-${n}.md`
}

type Message = { role: string; text: string }

/** 壓縮後的對話（摘要與保留的訊息）整理成 Markdown。文字先移除控制字元。 */
export const notesMarkdown = (messages: readonly Message[], meta: { when: Date; trigger: string; percent: number | null }): string => {
  const header = [
    `# 工作階段摘要（${meta.when.toLocaleString('zh-TW', { hour12: false })}）`,
    '',
    `- 觸發：${triggerName(meta.trigger)}${meta.percent === null ? '' : `（context ${meta.percent}%）`}`,
    '',
  ]
  const body = messages
    .filter(m => m.text.trim() !== '')
    .map(m => `## ${m.role === 'assistant' ? 'Claude' : '使用者／摘要'}\n\n${clean(m.text).trim()}\n`)
  return [...header, ...body].join('\n')
}

const triggerName = (trigger: string): string =>
  trigger === 'auto' ? '引擎自動壓縮' : trigger === 'manual' ? '手動 /compact' : trigger === 'plugin' ? '達到門檻時預先壓縮' : trigger
