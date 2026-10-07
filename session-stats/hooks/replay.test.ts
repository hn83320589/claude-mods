import { expect, test } from 'claude-code/testing'

import { addStep, firstLine, resolveCursor, startTurn, windowAround } from './replay'

const step = (id: string) => ({ id, tool: 'Bash', label: id, ms: 10, ok: true, summary: '' })

test('步驟記在最新的回合；還沒有回合時補一個', async () => {
  let turns = addStep([], step('a'))
  expect(turns[0]?.steps.map(s => s.id)).toEqual(['a'])
  turns = startTurn(turns, 't1', '第一行\n第二行')
  turns = addStep(turns, step('b'))
  expect(turns.map(t => t.steps.length)).toEqual([1, 1])
  expect(turns[1]?.prompt).toBe('第一行')
})

test('cursor 為 null 時跟著最新回合的最後一步，超出範圍會被夾回', async () => {
  const turns = addStep(addStep(startTurn([], 't', 'x'), step('a')), step('b'))
  expect(resolveCursor(turns, null)).toEqual({ turn: 0, step: 1 })
  expect(resolveCursor(turns, { turn: 5, step: 9 })).toEqual({ turn: 0, step: 1 })
  expect(resolveCursor([], null)).toBeNull()
})

test('選取的步驟保持在可見範圍內', async () => {
  expect(windowAround(3, 0, 5)).toEqual({ start: 0, end: 3 })
  expect(windowAround(20, 10, 5)).toEqual({ start: 8, end: 13 })
  expect(windowAround(20, 19, 5)).toEqual({ start: 15, end: 20 })
})

test('摘要移除工具輸出中的控制字元（終端機跳脫序列）', async () => {
  const ESC = String.fromCharCode(27)
  expect(firstLine(`${ESC}[2J${ESC}[31m紅字`)).toBe('[2J[31m紅字')
})
