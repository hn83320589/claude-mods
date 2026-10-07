// 與 session-stats 的 layout.ts 相同
// 三個區塊平均分配 pane 的高度；除不盡的列數給最後一區。
export const MIN_SECTION_ROWS = 4

export const splitRows = (total: number, count: number): number[] => {
  const each = Math.max(MIN_SECTION_ROWS, Math.floor(total / count))
  const heights = Array.from({ length: count }, () => each)
  const rest = total - each * count
  if (rest > 0) heights[count - 1] = each + rest
  return heights
}

// 區塊內可放的項目數：扣掉上下框線 2 列、標題 1 列，以及固定列。
// 放不下時留一列給「… 還有 N 項」。
export const fit = <T>(items: readonly T[], room: number): { shown: T[]; more: number } => {
  if (items.length <= room) return { shown: [...items], more: 0 }
  const shown = items.slice(0, Math.max(0, room - 1))
  return { shown, more: items.length - shown.length }
}

export const SECTION_CHROME = 3

// 依優先序挑出放得下的列，畫面上仍維持原本的順序
export const pick = <T>(rows: readonly { item: T; priority: number }[], room: number): T[] => {
  const keep = new Set(
    rows
      .map((row, index) => ({ index, priority: row.priority }))
      .sort((a, b) => b.priority - a.priority || a.index - b.index)
      .slice(0, Math.max(0, room))
      .map(row => row.index),
  )
  return rows.filter((_, index) => keep.has(index)).map(row => row.item)
}

// 區塊內上下兩段分配列數：上段最多拿 share 比例，但要留給下段至少 lowerMin 列
export const share = (room: number, upperWant: number, share: number, lowerMin: number): { upper: number; lower: number } => {
  const upper = Math.max(1, Math.min(upperWant, Math.floor(room * share), room - lowerMin))
  return { upper, lower: Math.max(0, room - upper) }
}
