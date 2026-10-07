import type { Task, TaskStatus } from '../types'

// 從 Claude 的任務工具呼叫推算目前的任務清單。
// input / result 來自 tool.call，形狀依工具而定，所以這裡只讀需要的欄位。

type Bag = Record<string, unknown>

const asBag = (value: unknown): Bag => (typeof value === 'object' && value !== null ? (value as Bag) : {})
const asStatus = (value: unknown): TaskStatus | null =>
  value === 'pending' || value === 'in_progress' || value === 'completed' ? value : null

const TODO_PREFIX = 'todo:'

export const applyTaskTool = (tasks: Task[], tool: string, input: unknown, result: unknown): Task[] => {
  const args = asBag(input)

  if (tool === 'TodoWrite') {
    const todos = Array.isArray(args.todos) ? args.todos : []
    const fromTodos = todos.map((todo, i): Task => {
      const t = asBag(todo)
      return { id: `${TODO_PREFIX}${i}`, subject: String(t.content ?? ''), status: asStatus(t.status) ?? 'pending' }
    })
    return [...tasks.filter(t => !t.id.startsWith(TODO_PREFIX)), ...fromTodos]
  }

  if (tool === 'TaskCreate') {
    const task = asBag(asBag(result).task)
    if (typeof task.id !== 'string') return tasks
    const subject = String(task.subject ?? args.subject ?? '')
    return [...tasks.filter(t => t.id !== task.id), { id: task.id, subject, status: 'pending' }]
  }

  if (tool === 'TaskUpdate') {
    const id = args.taskId
    if (typeof id !== 'string') return tasks
    if (args.status === 'deleted') return tasks.filter(t => t.id !== id)
    const status = asStatus(args.status)
    const subject = typeof args.subject === 'string' ? args.subject : null
    return tasks.map(t => (t.id === id ? { ...t, status: status ?? t.status, subject: subject ?? t.subject } : t))
  }

  if (tool === 'TaskList') {
    const listed = Array.isArray(asBag(result).tasks) ? (asBag(result).tasks as unknown[]) : null
    if (listed === null) return tasks
    const fromList = listed.flatMap((one): Task[] => {
      const t = asBag(one)
      return typeof t.id === 'string'
        ? [{ id: t.id, subject: String(t.subject ?? ''), status: asStatus(t.status) ?? 'pending' }]
        : []
    })
    return [...tasks.filter(t => t.id.startsWith(TODO_PREFIX)), ...fromList]
  }

  return tasks
}

export const runningLabel = (tool: string, input: unknown): string => {
  const args = asBag(input)
  const text = args.description ?? args.command ?? args.file_path ?? args.pattern ?? args.query ?? ''
  return String(text).replace(/\s+/g, ' ').slice(0, 60)
}
