import { expect, test } from 'claude-code/testing'

import { FIELD, parseLog, parseNumstat, parseStatus, RECORD } from './git'

const NUL = String.fromCharCode(0)
const TAB = String.fromCharCode(9)

test('解析分支、上游與領先落後', async () => {
  const out = ['# branch.oid 86a204d', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1', ''].join(NUL)
  expect(parseStatus(out)).toEqual({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1, files: [] })
})

test('解析一般變更、改名、未追蹤與衝突，路徑可含中文與空白', async () => {
  const out = [
    '# branch.head feature/x',
    '1 M. N... 100644 100644 100644 aaa bbb src/抽獎 服務.cs',
    '1 .M N... 100644 100644 100644 aaa bbb README.md',
    '2 R. N... 100644 100644 100644 aaa bbb R100 new.cs',
    'old.cs',
    'u UU N... 100644 100644 100644 100644 a b c conflict.cs',
    '? 筆記.txt',
    '',
  ].join(NUL)
  const s = parseStatus(out)
  expect(s.upstream).toBeNull()
  expect(s.files).toEqual([
    { path: 'src/抽獎 服務.cs', staged: 'M', unstaged: '.', kind: 'changed' },
    { path: 'README.md', staged: '.', unstaged: 'M', kind: 'changed' },
    { path: 'new.cs', staged: 'R', unstaged: '.', kind: 'changed' },
    { path: 'conflict.cs', staged: 'U', unstaged: 'U', kind: 'conflict' },
    { path: '筆記.txt', staged: '.', unstaged: '?', kind: 'untracked' },
  ])
})

test('解析 numstat，包含二進位檔與改名', async () => {
  const out = [`3${TAB}1${TAB}a.cs`, `-${TAB}-${TAB}logo.png`, `5${TAB}0${TAB}`, 'old.cs', 'new.cs', ''].join(NUL)
  expect(parseNumstat(out)).toEqual({
    'a.cs': { added: 3, removed: 1 },
    'logo.png': { added: 0, removed: 0 },
    'new.cs': { added: 5, removed: 0 },
  })
})

test('解析 log', async () => {
  const out = `86a204d${FIELD}docs: 新增說明${FIELD}DADA${FIELD}1790000000${RECORD}\nabc1234${FIELD}init${FIELD}me${FIELD}1780000000${RECORD}\n`
  expect(parseLog(out)).toEqual([
    { hash: '86a204d', subject: 'docs: 新增說明', author: 'DADA', time: 1790000000000 },
    { hash: 'abc1234', subject: 'init', author: 'me', time: 1780000000000 },
  ])
})
