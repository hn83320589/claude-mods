import { expect, test } from 'claude-code/testing'

import { countPatch, groupEdits, isUntested, locate, recordEdit } from './blast'

// 載入器處理字串裡的反斜線有問題，Windows 路徑用 win() 組出來
const win = (path: string): string => path.replaceAll('/', String.fromCharCode(92))
const ROOT = win('D:/workspace/LuckyDraw')

test('從 structuredPatch 算出增減行數', async () => {
  const patch = [{ lines: [' context', '-old', '+new', '+more'] }]
  expect(countPatch(patch)).toEqual({ added: 2, removed: 1 })
  expect(countPatch(undefined)).toEqual({ added: 0, removed: 0 })
})

test('依專案第一層資料夾分組，專案外另外歸類', async () => {
  expect(locate(win('D:/workspace/LuckyDraw/LuckyDraw.Core/Services/DrawService.cs'), ROOT))
    .toEqual({ group: 'LuckyDraw.Core', rel: 'LuckyDraw.Core/Services/DrawService.cs' })
  expect(locate('D:/workspace/LuckyDraw/CLAUDE.md', ROOT)).toEqual({ group: '(根目錄)', rel: 'CLAUDE.md' })
  expect(locate('C:/Users/me/.claude/x/register.tsx', ROOT).group).toBe('專案外')
})

test('同一檔案多次修改會累加，分組依改動量排序', async () => {
  let edits = recordEdit([], win('D:/workspace/LuckyDraw/LuckyDraw.App/App.xaml.cs'), ROOT, 2, 1)
  edits = recordEdit(edits, win('D:/workspace/LuckyDraw/LuckyDraw.Core/Prize.cs'), ROOT, 10, 0)
  edits = recordEdit(edits, win('D:/workspace/LuckyDraw/LuckyDraw.App/App.xaml.cs'), ROOT, 3, 0)
  const groups = groupEdits(edits)
  expect(groups.map(g => g.name)).toEqual(['LuckyDraw.Core', 'LuckyDraw.App'])
  expect(groups[1]?.added).toBe(5)
})

test('改了程式碼沒動測試時警告', async () => {
  const code = recordEdit([], win('D:/workspace/LuckyDraw/LuckyDraw.Core/Prize.cs'), ROOT, 1, 0)
  expect(isUntested(code)).toBe(true)
  expect(isUntested(recordEdit(code, win('D:/workspace/LuckyDraw/LuckyDraw.Core.Tests/PrizeServiceTests.cs'), ROOT, 1, 0))).toBe(false)
  expect(isUntested(recordEdit([], win('D:/workspace/LuckyDraw/docs/manual.md'), ROOT, 1, 0))).toBe(false)
})
