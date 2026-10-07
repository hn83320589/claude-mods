import type { ReplayStep, ReplayTurn } from '../types'
import { clean } from './text'

export const MAX_TURNS = 30
export const MAX_STEPS = 100

export const firstLine = (text: string): string =>
  clean(text.split(/\r?\n/).map(l => l.trim()).find(l => l !== '') ?? '')

export const startTurn = (turns: ReplayTurn[], id: string, prompt: string): ReplayTurn[] =>
  [...turns, { id, prompt: firstLine(prompt).slice(0, 200), steps: [] }].slice(-MAX_TURNS)

export const addStep = (turns: ReplayTurn[], step: ReplayStep): ReplayTurn[] => {
  const base = turns.length === 0 ? [{ id: 'start', prompt: '（mod 載入前開始的回合）', steps: [] }] : turns
  const last = base[base.length - 1] as ReplayTurn
  return [...base.slice(0, -1), { ...last, steps: [...last.steps, step].slice(-MAX_STEPS) }]
}

// cursor 為 null 代表「跟著最新」：最新回合的最後一步
export const resolveCursor = (
  turns: readonly ReplayTurn[],
  cursor: { turn: number; step: number } | null,
): { turn: number; step: number } | null => {
  if (turns.length === 0) return null
  if (cursor === null) {
    const turn = turns.length - 1
    return { turn, step: Math.max(0, (turns[turn]?.steps.length ?? 1) - 1) }
  }
  const turn = Math.max(0, Math.min(turns.length - 1, cursor.turn))
  const steps = turns[turn]?.steps.length ?? 0
  return { turn, step: Math.max(0, Math.min(Math.max(0, steps - 1), cursor.step)) }
}

// 選取的步驟保持在可見範圍中間附近
export const windowAround = (count: number, selected: number, room: number): { start: number; end: number } => {
  if (count <= room) return { start: 0, end: count }
  const start = Math.max(0, Math.min(count - room, selected - Math.floor(room / 2)))
  return { start, end: start + room }
}
