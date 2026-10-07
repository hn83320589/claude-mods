import type { TestRun } from '../types'

// 從測試指令的輸出抓摘要列。各框架格式不同，依序嘗試，第一個對上的就用。
// regex 裡不用 \/ 與 \（mod 載入器處理反斜線有問題），需要時用字元類別 [|] [(] 代替。

const TEST_COMMAND =
  /\b(dotnet\s+test|(npm|pnpm|yarn|bun)(\s+run)?\s+test|npx\s+(jest|vitest)|jest|vitest|pytest|python3?\s+-m\s+pytest|cargo\s+test)\b/

export const isTestCommand = (command: string): boolean => TEST_COMMAND.test(command)

const num = (value: string | undefined): number => Number(value ?? 0) || 0

const run = (runner: string, passed: number, failed: number, total: number): TestRun => ({
  runner,
  passed,
  failed,
  total,
  isOk: failed === 0,
})

type Parser = (output: string) => TestRun | null

// Passed!  - Failed:     0, Passed:   153, Skipped:     0, Total:   153
const dotnet: Parser = output => {
  const m = /Failed:\s*(\d+),\s*Passed:\s*(\d+),\s*Skipped:\s*\d+,\s*Total:\s*(\d+)/.exec(output)
  return m === null ? null : run('dotnet', num(m[2]), num(m[1]), num(m[3]))
}

// Tests:       1 failed, 2 passed, 3 total
const jest: Parser = output => {
  const line = output.split('\n').find(l => /^\s*Tests:\s+.*\d+ total/.test(l))
  if (line === undefined) return null
  return run('jest', num(/(\d+) passed/.exec(line)?.[1]), num(/(\d+) failed/.exec(line)?.[1]), num(/(\d+) total/.exec(line)?.[1]))
}

// Tests  1 failed | 2 passed (3)
const vitest: Parser = output => {
  const line = output.split('\n').find(l => /^\s*Tests\s+.*[(]\d+[)]/.test(l))
  if (line === undefined) return null
  return run('vitest', num(/(\d+) passed/.exec(line)?.[1]), num(/(\d+) failed/.exec(line)?.[1]), num(/[(](\d+)[)]/.exec(line)?.[1]))
}

// ==== 2 failed, 5 passed in 0.12s ====
const pytest: Parser = output => {
  const line = output.split('\n').find(l => /\d+ (passed|failed)/.test(l) && / in [\d.]+s/.test(l))
  if (line === undefined) return null
  const passed = num(/(\d+) passed/.exec(line)?.[1])
  const failed = num(/(\d+) failed/.exec(line)?.[1]) + num(/(\d+) error/.exec(line)?.[1])
  return run('pytest', passed, failed, passed + failed)
}

// test result: ok. 10 passed; 0 failed;（多個 crate 時每個一列，加總）
const cargo: Parser = output => {
  const lines = output.split('\n').filter(l => /test result: /.test(l))
  if (lines.length === 0) return null
  const passed = lines.reduce((n, l) => n + num(/(\d+) passed/.exec(l)?.[1]), 0)
  const failed = lines.reduce((n, l) => n + num(/(\d+) failed/.exec(l)?.[1]), 0)
  return run('cargo', passed, failed, passed + failed)
}

const PARSERS: readonly Parser[] = [dotnet, jest, vitest, cargo, pytest]

export const parseTestSummary = (output: string): TestRun | null => {
  for (const parse of PARSERS) {
    const result = parse(output)
    if (result !== null) return result
  }
  return null
}

export const formatStatus = (result: TestRun | null): string | undefined => {
  if (result === null) return undefined
  return result.isOk
    ? `測試 ✓ ${result.passed}/${result.total} · ${result.runner}`
    : `測試 ✗ ${result.failed} 個失敗（${result.passed}/${result.total}）· ${result.runner}`
}
