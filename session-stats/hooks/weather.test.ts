import { expect, test } from 'claude-code/testing'

import { burnRate, projectLimit, sparkline, turnsUntil, weatherOf } from './weather'

test('每回合消耗取最近的成長量平均，compact 造成的下降不算', async () => {
  expect(burnRate([10000, 14000, 20000])).toBe(5000)
  expect(burnRate([10000, 50000, 8000, 12000])).toBe(22000)
  expect(burnRate([10000])).toBeNull()
})

test('預估幾回合後到達 auto-compact', async () => {
  expect(turnsUntil(100000, 160000, 5000)).toBe(12)
  expect(turnsUntil(100000, 160000, null)).toBeNull()
})

test('rate limit 照目前速度外推到重置時', async () => {
  const now = Date.parse('2026-10-05T12:00:00Z')
  // 5 小時視窗剩 3 小時 → 已過 2 小時用了 20%，外推 50%
  expect(projectLimit({ kind: 'five_hour', percentUsed: 20, resetsAt: '2026-10-05T15:00:00Z' }, now)).toBe(50)
  // 視窗剛開始，資料不足
  expect(projectLimit({ kind: 'five_hour', percentUsed: 5, resetsAt: '2026-10-05T16:50:00Z' }, now)).toBeNull()
  expect(projectLimit({ kind: 'spend_limit', percentUsed: 5, resetsAt: null }, now)).toBeNull()
})

test('sparkline 與天氣分級', async () => {
  expect(sparkline([0, 50, 100], 100)).toBe('▁▅█')
  expect(weatherOf(30).label).toBe('晴朗')
  expect(weatherOf(60).label).toBe('多雲')
  expect(weatherOf(85).label).toBe('有雨')
  expect(weatherOf(120).label).toBe('暴風')
})
