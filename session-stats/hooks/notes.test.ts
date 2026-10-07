import { expect, test } from 'claude-code/testing'

import { COMPACT_THRESHOLD, NOTES_GITIGNORE, notesFileName, notesMarkdown } from './notes'

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
  expect(md).toContain('下一步：補測試')
  expect(md.split('## Claude').length).toBe(2)
})

test('門檻是 80%，資料夾自帶 .gitignore 忽略所有檔案', async () => {
  expect(COMPACT_THRESHOLD).toBe(80)
  expect(NOTES_GITIGNORE.trim().split(String.fromCharCode(10)).at(-1)).toBe('*')
})
