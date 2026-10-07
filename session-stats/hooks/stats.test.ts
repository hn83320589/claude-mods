import { expect, test } from 'claude-code/testing'

import { duration, ratio, recordCache, recordTool, summarizeTools, visibleAgents } from './stats'

test('工具統計累計次數、失敗與最慢一次', async () => {
  let stats = recordTool([], 'Bash', 1200, true)
  stats = recordTool(stats, 'Read', 50, true)
  stats = recordTool(stats, 'Bash', 300, false)
  const s = summarizeTools(stats)
  expect(s.total).toBe(3)
  expect(s.failed).toBe(1)
  expect(s.top.map(t => t.tool)).toEqual(['Bash', 'Read'])
  expect(s.slowest?.maxMs).toBe(1200)
})

test('cache 命中率：累計與最近一回合', async () => {
  expect(ratio(0, 0, 0)).toBeNull()
  let c = recordCache({ read: 0, creation: 0, input: 0, last: null }, { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 900 })
  expect(c.last).toBe(0)
  c = recordCache(c, { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 })
  expect(c.last).toBe(90)
  expect(ratio(c.read, c.creation, c.input)).toBe(45)
})

test('時間格式', async () => {
  expect(duration(42_000)).toBe('42s')
  expect(duration(125_000)).toBe('2m05s')
  expect(duration(3_900_000)).toBe('1h05m')
})

test('subagent 只列進行中與失敗的', async () => {
  const agents = ['running', 'completed', 'failed', 'waiting'].map((status, i) => ({ id: String(i), type: 'x', description: 'd', status }))
  expect(visibleAgents(agents).map(a => a.status)).toEqual(['running', 'failed', 'waiting'])
})
