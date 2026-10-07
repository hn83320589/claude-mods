import type { GitCommit, GitFile, GitStatus, NumStat } from '../types'
import { clean } from './text'

// 解析 git 的機器可讀輸出。一律用 -z（NUL 分隔）：路徑含中文或空白時才不會被加引號跳脫。
// 分隔字元用 fromCharCode 產生，原始碼裡不寫反斜線跳脫（mod 載入器處理反斜線有問題）。

const NUL = String.fromCharCode(0)
const TAB = String.fromCharCode(9)
export const FIELD = String.fromCharCode(31)
export const RECORD = String.fromCharCode(30)

// git status --porcelain=v2 --branch -z
export const parseStatus = (stdout: string): GitStatus => {
  const status: GitStatus = { branch: '', upstream: null, ahead: 0, behind: 0, files: [] }
  const tokens = stdout.split(NUL)
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? ''
    if (token.startsWith('# branch.head ')) status.branch = clean(token.slice('# branch.head '.length))
    else if (token.startsWith('# branch.upstream ')) status.upstream = clean(token.slice('# branch.upstream '.length))
    else if (token.startsWith('# branch.ab ')) {
      const [a = '+0', b = '-0'] = token.slice('# branch.ab '.length).split(' ')
      status.ahead = Number(a.slice(1)) || 0
      status.behind = Number(b.slice(1)) || 0
    } else if (token.startsWith('1 ') || token.startsWith('2 ')) {
      // 1 XY sub mH mI mW hH hI path；2 多一個欄位（相似度），原路徑是下一個 NUL 片段
      const parts = token.split(' ')
      const xy = parts[1] ?? '..'
      const path = parts.slice(token.startsWith('1 ') ? 8 : 9).join(' ')
      status.files.push({ path: clean(path), staged: xy[0] ?? '.', unstaged: xy[1] ?? '.', kind: 'changed' })
      if (token.startsWith('2 ')) i += 1
    } else if (token.startsWith('u ')) {
      const parts = token.split(' ')
      status.files.push({ path: clean(parts.slice(10).join(' ')), staged: 'U', unstaged: 'U', kind: 'conflict' })
    } else if (token.startsWith('? ')) {
      status.files.push({ path: clean(token.slice(2)), staged: '.', unstaged: '?', kind: 'untracked' })
    }
  }
  return status
}

// git diff --numstat -z：一般檔案「增 TAB 刪 TAB 路徑」；改名時路徑留空，接著是原路徑與新路徑兩個片段
export const parseNumstat = (stdout: string): NumStat => {
  const result: NumStat = {}
  const tokens = stdout.split(NUL)
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? ''
    if (token === '') continue
    const [a = '', r = '', path = ''] = token.split(TAB)
    // 二進位檔的增刪是「-」
    const counts = { added: Number(a) || 0, removed: Number(r) || 0 }
    if (path === '') {
      const renamed = tokens[i + 2] ?? ''
      result[clean(renamed)] = counts
      i += 2
    } else {
      result[clean(path)] = counts
    }
  }
  return result
}

// git log --format=%h<FIELD>%s<FIELD>%an<FIELD>%ct<RECORD>
export const LOG_FORMAT = '%h%x1f%s%x1f%an%x1f%ct%x1e'

export const parseLog = (stdout: string): GitCommit[] =>
  stdout
    .split(RECORD)
    .map(r => r.trim())
    .filter(r => r !== '')
    .map(r => {
      const [hash = '', subject = '', author = '', time = '0'] = r.split(FIELD)
      return { hash: clean(hash), subject: clean(subject), author: clean(author), time: Number(time) * 1000 }
    })

// 狀態字母的中文說明與顏色
export const STATUS_NAMES: Record<string, string> = { M: '修改', A: '新增', D: '刪除', R: '改名', C: '複製', T: '類型', U: '衝突', '?': '未追蹤' }

export const letterOf = (file: GitFile): string =>
  file.kind === 'untracked' ? '?' : file.kind === 'conflict' ? 'U' : file.staged !== '.' ? file.staged : file.unstaged
