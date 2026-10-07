import { expect, test } from 'claude-code/testing'

import { COMPACT_THRESHOLD, isInside, NOTES_GITIGNORE, notesFileName, notesMarkdown, redactSecrets } from './notes'

test('摘要檔名依當地時間，同一分鐘再壓縮時加上序號', async () => {
  const when = new Date(2026, 9, 7, 15, 30)
  expect(notesFileName(when)).toBe('2026-10-07-1530.md')
  expect(notesFileName(when, ['2026-10-07-1530.md'])).toBe('2026-10-07-1530-2.md')
  expect(notesFileName(when, ['2026-10-07-1530.md', '2026-10-07-1530-2.md'])).toBe('2026-10-07-1530-3.md')
})

test('摘要內容標示觸發原因，略過空白訊息並移除控制字元', async () => {
  const ESC = String.fromCharCode(27)
  const md = notesMarkdown(
    [
      { role: 'user', text: `目前任務：重構${ESC}[2J` },
      { role: 'assistant', text: '  ' },
      { role: 'assistant', text: '下一步：補測試' },
    ],
    { when: new Date(2026, 9, 7, 15, 30), trigger: 'plugin', percent: 82 },
  )
  expect(md).toContain('達到門檻時預先壓縮（context 82%）')
  expect(md).toContain('目前任務：重構[2J')
  expect(md).not.toContain(String.fromCharCode(27))
})

test('門檻是 80%，資料夾自帶 .gitignore 忽略所有檔案', async () => {
  expect(COMPACT_THRESHOLD).toBe(80)
  expect(NOTES_GITIGNORE.trim().split(String.fromCharCode(10)).at(-1)).toBe('*')
})

test('存檔前遮蔽常見的密鑰與密碼', async () => {
  const text = [
    'ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
    'token: ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'aws AKIAABCDEFGHIJKLMNOP',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz.123456',
    'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',
    'password = hunter2-secret',
    '-----BEGIN RSA PRIVATE KEY-----',
    'MIIEowIBAAKCAQEA',
    '-----END RSA PRIVATE KEY-----',
    '一般文字 example.com 保留',
  ].join(String.fromCharCode(10))
  const out = redactSecrets(text)
  for (const secret of ['sk-ant-api03', 'ghp_abc', 'AKIAABCD', 'abcdefghijklmnopqrstuvwxyz.123456', 'eyJhbGci', 'hunter2', 'MIIEowIBAAKCAQEA']) {
    expect(out).not.toContain(secret)
  }
  expect(out).toContain('一般文字 example.com 保留')
  expect(out).toContain('[已遮蔽]')
})

test('只存壓縮產生的摘要，不存保留下來的原始訊息', async () => {
  const md = notesMarkdown(
    [
      { role: 'user', text: '摘要：正在重構' },
      { role: 'assistant', text: '原始的工具輸出 secret-data' },
    ],
    { when: new Date(2026, 9, 7, 15, 30), trigger: 'auto', percent: null },
  )
  expect(md).toContain('摘要：正在重構')
  expect(md).not.toContain('secret-data')
})

test('判斷路徑是否在專案根目錄之內（不分大小寫、斜線方向）', async () => {
  expect(isInside('D:/work/app/.claude/session-notes', 'D:/work/app')).toBe(true)
  expect(isInside(['d:', 'work', 'app', '.claude'].join(String.fromCharCode(92)), 'D:/work/app')).toBe(true)
  expect(isInside('D:/work/app-evil/.claude', 'D:/work/app')).toBe(false)
  expect(isInside('C:/Users/me/AppData/Roaming', 'D:/work/app')).toBe(false)
})
