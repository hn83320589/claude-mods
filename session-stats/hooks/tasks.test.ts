import { expect, test } from 'claude-code/testing'

import { applyTaskTool, runningLabel } from './tasks'

test('TaskCreate 新增任務、TaskUpdate 改狀態、deleted 移除', async () => {
  let list = applyTaskTool([], 'TaskCreate', { subject: '寫測試' }, { task: { id: '1', subject: '寫測試' } })
  expect(list).toEqual([{ id: '1', subject: '寫測試', status: 'pending' }])

  list = applyTaskTool(list, 'TaskUpdate', { taskId: '1', status: 'in_progress' }, {})
  expect(list[0]?.status).toBe('in_progress')

  list = applyTaskTool(list, 'TaskUpdate', { taskId: '1', status: 'deleted' }, {})
  expect(list).toEqual([])
})

test('TodoWrite 整批取代 todo，不影響 Task 工具建立的任務', async () => {
  const start = [{ id: '7', subject: '既有任務', status: 'pending' as const }]
  const list = applyTaskTool(start, 'TodoWrite', {
    todos: [
      { content: '讀程式碼', status: 'completed', activeForm: '' },
      { content: '改程式碼', status: 'in_progress', activeForm: '' },
    ],
  }, {})
  expect(list.map(t => t.subject)).toEqual(['既有任務', '讀程式碼', '改程式碼'])

  const replaced = applyTaskTool(list, 'TodoWrite', { todos: [] }, {})
  expect(replaced.map(t => t.subject)).toEqual(['既有任務'])
})

test('執行中標籤優先用 description，其次指令', async () => {
  expect(runningLabel('Agent', { description: '搜尋程式碼', prompt: '...' })).toBe('搜尋程式碼')
  expect(runningLabel('Bash', { command: 'dotnet   test' })).toBe('dotnet test')
})
