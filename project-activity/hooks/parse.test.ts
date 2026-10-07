import { expect, test } from 'claude-code/testing'

import { formatStatus, isTestCommand, parseTestSummary } from './parse'

test('dotnet test', async () => {
  const r = parseTestSummary('Passed!  - Failed:     0, Passed:   153, Skipped:     0, Total:   153, Duration: 2 s')
  expect(r).toEqual({ runner: 'dotnet', passed: 153, failed: 0, total: 153, isOk: true })
  expect(formatStatus(r)).toBe('測試 ✓ 153/153 · dotnet')
})

test('jest 與 vitest', async () => {
  expect(parseTestSummary('Test Suites: 1 failed, 1 total\nTests:       1 failed, 2 passed, 3 total\n')).toEqual({
    runner: 'jest', passed: 2, failed: 1, total: 3, isOk: false,
  })
  expect(parseTestSummary(' Test Files  1 passed (1)\n      Tests  1 failed | 4 passed (5)\n')).toEqual({
    runner: 'vitest', passed: 4, failed: 1, total: 5, isOk: false,
  })
})

test('pytest 與 cargo', async () => {
  expect(parseTestSummary('===== 2 failed, 5 passed in 0.12s =====')).toEqual({ runner: 'pytest', passed: 5, failed: 2, total: 7, isOk: false })
  expect(parseTestSummary('test result: ok. 3 passed; 0 failed;\ntest result: ok. 2 passed; 0 failed;')).toEqual({
    runner: 'cargo', passed: 5, failed: 0, total: 5, isOk: true,
  })
})

test('有失敗時的 status line 與無法辨識的輸出', async () => {
  expect(formatStatus({ runner: 'dotnet', passed: 151, failed: 2, total: 153, isOk: false })).toBe('測試 ✗ 2 個失敗（151/153）· dotnet')
  expect(parseTestSummary('error CS1002: ; expected')).toBeNull()
  expect(formatStatus(null)).toBeUndefined()
})

test('辨識各種測試指令', async () => {
  for (const cmd of ['dotnet test LuckyDraw.Core.slnf', 'npm test', 'npm run test', 'pnpm test', 'npx vitest run', 'pytest -q', 'python -m pytest', 'cargo test']) {
    expect(isTestCommand(cmd)).toBe(true)
  }
  expect(isTestCommand('dotnet build')).toBe(false)
  expect(isTestCommand('npm install')).toBe(false)
})
