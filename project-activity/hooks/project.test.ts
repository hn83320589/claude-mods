import { expect, test } from 'claude-code/testing'

import { ago, describeCheck, detectTypes, hottest, keyFiles, parseConfig, recordHeat, sizeOf } from './project'

const NOW = 10 * 24 * 3600_000
const file = (name: string) => ({ name, kind: 'file' as const })

test('依根目錄的標記檔判斷專案類型', async () => {
  expect(detectTypes([file('LuckyDraw.sln'), file('Directory.Build.props')])).toEqual(['.NET'])
  expect(detectTypes([file('package.json'), file('pyproject.toml')])).toEqual(['Node.js', 'Python'])
  expect(detectTypes([file('notes.txt'), { name: 'package.json', kind: 'dir' }])).toEqual([])
})

test('關鍵檔案檢查', async () => {
  expect(keyFiles([file('README.md'), file('CLAUDE.md')])).toEqual([
    { label: 'README', found: true },
    { label: 'CLAUDE.md', found: true },
    { label: '.gitignore', found: false },
    { label: 'LICENSE', found: false },
  ])
})

test('設定檔解析與錯誤訊息', async () => {
  expect(parseConfig('{"checks":[{"path":"Data/a.xlsx","required":true,"note":"必要"},{"path":"Data/out","dir":true}]}')).toEqual([
    { path: 'Data/a.xlsx', required: true, dir: false, note: '必要' },
    { path: 'Data/out', required: false, dir: true, note: null },
  ])
  expect(() => parseConfig('{}')).toThrow('缺少 "checks" 陣列')
  expect(() => parseConfig('{"checks":[{}]}')).toThrow('checks[0] 缺少 "path"')
})

test('檢查項目：必要檔案缺少標示錯誤，選用缺少只是提示，存在時顯示大小與時間', async () => {
  const required = { path: 'Data/名單.xlsx', required: true, dir: false, note: '缺少時程式拒絕啟動' }
  expect(describeCheck(required, undefined, NOW)).toEqual({ name: 'Data/名單.xlsx', state: 'missing-required', detail: '缺少時程式拒絕啟動' })
  expect(describeCheck({ ...required, required: false, note: null }, undefined, NOW).state).toBe('missing-optional')
  expect(describeCheck(required, { kind: 'file', size: 2048, mtimeMs: NOW - 5 * 60000, count: 0 }, NOW).detail).toBe('2KB · 5 分鐘前')
  expect(describeCheck({ path: 'Data/out', required: false, dir: true, note: null }, { kind: 'dir', size: 0, mtimeMs: NOW - 2 * 3600_000, count: 3 }, NOW).detail).toBe('3 份 · 2 小時前')
  // 類型不符（要資料夾卻是檔案）視同不存在
  expect(describeCheck({ path: 'x', required: true, dir: true, note: null }, { kind: 'file', size: 1, mtimeMs: NOW, count: 0 }, NOW).state).toBe('missing-required')
})

test('大小與相對時間格式', async () => {
  expect(sizeOf(512)).toBe('512B')
  expect(sizeOf(45 * 1024)).toBe('45KB')
  expect(sizeOf(3 * 1024 * 1024)).toBe('3.0MB')
  expect(ago(NOW, NOW)).toBe('剛剛')
  expect(ago(NOW - 3 * 24 * 3600_000, NOW)).toBe('3 天前')
})

test('熱門檔案依讀取與修改次數排序', async () => {
  let heat = recordHeat([], 'a.cs', 'read')
  heat = recordHeat(heat, 'b.cs', 'read')
  heat = recordHeat(heat, 'b.cs', 'edit')
  heat = recordHeat(heat, 'b.cs', 'read')
  expect(hottest(heat).map(h => h.path)).toEqual(['b.cs', 'a.cs'])
  expect(hottest(heat)[0]).toEqual({ path: 'b.cs', reads: 2, edits: 1 })
})
