import { clean } from './text'

// mod 載入器處理反斜線有問題，這個檔案完全不寫反斜線：
// 換行、tab 用 fromCharCode 組成；正規表示式的字邊界用 lookaround，句點用 [.]，任意字元用 [^]。
const TAB = String.fromCharCode(9)
const LF = String.fromCharCode(10)
const CR = String.fromCharCode(13)

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
].join(LF)

/** 摘要存放的資料夾（相對於專案根目錄）。 */
export const NOTES_DIR = '.claude/session-notes'

/** 資料夾內的 .gitignore：讓整個資料夾不被提交，不必修改專案自己的 .gitignore。 */
export const NOTES_GITIGNORE = ['# Claude Code 壓縮時保存的工作階段摘要，只留在本機', '*', ''].join(LF)

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

const MASK = '[已遮蔽]'
const SPACE = `[ ${TAB}]`
const NOT_SPACE = `[^ ${TAB}${CR}${LF}]`
const START = '(?<![A-Za-z0-9_])'

// 常見的密鑰格式：私鑰區塊、API key（sk-、sk-ant-）、GitHub、AWS、Slack token、JWT、Bearer、key=value 形式的密碼
const SECRET_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[^]*?-----END [A-Z ]*PRIVATE KEY-----/g, MASK],
  [new RegExp(`${START}sk-(?:ant-)?[A-Za-z0-9_-]{16,}`, 'g'), MASK],
  [new RegExp(`${START}(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})`, 'g'), MASK],
  [new RegExp(`${START}AKIA[0-9A-Z]{16}(?![A-Za-z0-9_])`, 'g'), MASK],
  [new RegExp(`${START}xox[abprs]-[A-Za-z0-9-]{10,}`, 'g'), MASK],
  [new RegExp(`${START}eyJ[A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}`, 'g'), MASK],
  [new RegExp(`Bearer${SPACE}+[A-Za-z0-9._~+/=-]{16,}`, 'gi'), `Bearer ${MASK}`],
  // 保留欄位名稱，只遮蔽值：password = [已遮蔽]
  [
    new RegExp(`${START}(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)(${SPACE}*[:=]${SPACE}*)${NOT_SPACE}+`, 'gi'),
    `$1$2${MASK}`,
  ],
]

/** 存檔前遮蔽常見的密鑰與密碼：摘要可能引用工具輸出，檔案雖不提交，仍可能被同步或備份帶走。 */
export const redactSecrets = (text: string): string =>
  SECRET_PATTERNS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text)

/** path 是否位於 root 之內（不分大小寫、斜線方向；只比較完整的路徑段）。 */
export const isInside = (path: string, root: string): boolean => {
  const norm = (p: string) => p.replaceAll(String.fromCharCode(92), '/').replace(/[/]+$/, '').toLowerCase()
  const a = norm(path)
  const b = norm(root)
  return a === b || a.startsWith(`${b}/`)
}

/**
 * 壓縮後的對話第一則是摘要，其後是原樣保留的訊息（可能含工具輸出的原文）。
 * 只存摘要，並移除控制字元、遮蔽密鑰。
 */
export const notesMarkdown = (messages: readonly Message[], meta: { when: Date; trigger: string; percent: number | null }): string => {
  const summary = messages.find(m => m.text.trim() !== '')?.text ?? '（沒有摘要內容）'
  return [
    `# 工作階段摘要（${meta.when.toLocaleString('zh-TW', { hour12: false })}）`,
    '',
    `- 觸發：${triggerName(meta.trigger)}${meta.percent === null ? '' : `（context ${meta.percent}%）`}`,
    '',
    redactSecrets(clean(summary)).trim(),
    '',
  ].join(LF)
}

const triggerName = (trigger: string): string =>
  trigger === 'auto' ? '引擎自動壓縮' : trigger === 'manual' ? '手動 /compact' : trigger === 'plugin' ? '達到門檻時預先壓縮' : trigger
