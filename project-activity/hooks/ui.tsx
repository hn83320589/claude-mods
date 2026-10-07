import type { Elements, RenderChildren } from 'claude-code'

// 與 session-stats 的 ui.tsx 相同；兩個 mod 是各自獨立的 plugin，不能互相 import

export const barOf = (percent: number, width: number): { full: string; rest: string } => {
  const w = Math.max(0, width)
  const filled = Math.max(0, Math.min(w, Math.round((percent / 100) * w)))
  return { full: '━'.repeat(filled), rest: '─'.repeat(w - filled) }
}

export type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export const LABEL_WIDTH = 9

// 每一列都包在高度 1、超出裁掉的容器裡：內容再長也只會被截掉，不會換行把區塊撐歪。
// 區塊的列數預算因此可以照「一列一行」精確計算。
export const line = (kit: Kit, children: RenderChildren): RenderChildren => {
  const { Box } = kit
  return (
    <Box height={1} flexShrink={0} overflow="hidden">
      {children}
    </Box>
  )
}

// 帶色框的區塊：固定高度，框線 2 列 + 標題 1 列，其餘給 rows
export const section = (
  kit: Kit,
  props: { color: string; title: string; height: number; right?: RenderChildren },
  rows: RenderChildren[],
): RenderChildren => {
  const { Box, Text } = kit
  return (
    <Box flexDirection="column" height={props.height} flexShrink={0} borderStyle="round" borderColor={props.color} paddingX={1} overflow="hidden">
      {line(
        kit,
        <Box flexGrow={1} justifyContent="space-between">
          <Text bold color={props.color} wrap="truncate-end">{props.title}</Text>
          {props.right ?? null}
        </Box>,
      )}
      {rows}
    </Box>
  )
}

// 區塊內的分隔線：「─ 標題 ─────── 右側」
export const rule = (kit: Kit, title: string, color: string, right?: RenderChildren): RenderChildren => {
  const { Box, Text } = kit
  return line(
    kit,
    <Box flexGrow={1}>
      <Text color={color}>{`─ ${title} `}</Text>
      <Box flexGrow={1} overflow="hidden">
        <Text dimColor wrap="truncate">{'─'.repeat(200)}</Text>
      </Box>
      {right === undefined ? null : <Text> </Text>}
      {right ?? null}
    </Box>,
  )
}

// 「標籤 ━━━━──── 數值」，標籤欄固定寬度讓數條對齊
export const gauge = (kit: Kit, label: string, percent: number, barWidth: number, value: string, color: string): RenderChildren => {
  const { Box, Text } = kit
  const bar = barOf(percent, barWidth)
  return line(
    kit,
    <Box>
      <Box width={LABEL_WIDTH} flexShrink={0}><Text dimColor>{label}</Text></Box>
      <Text color={color}>{bar.full}</Text>
      <Text dimColor>{bar.rest}</Text>
      <Text wrap="truncate-end">{` ${value}`}</Text>
    </Box>,
  )
}

// 「標籤  內容」，標籤欄與 gauge 對齊
export const labeled = (kit: Kit, label: string, children: RenderChildren): RenderChildren => {
  const { Box, Text } = kit
  return line(
    kit,
    <Box>
      <Box width={LABEL_WIDTH} flexShrink={0}><Text dimColor>{label}</Text></Box>
      <Box flexGrow={1} overflow="hidden">{children}</Box>
    </Box>,
  )
}

export const text = (kit: Kit, value: string, props: { color?: string; dim?: boolean; bold?: boolean; italic?: boolean } = {}): RenderChildren => {
  const { Text } = kit
  return line(
    kit,
    <Text color={props.color} dimColor={props.dim} bold={props.bold} italic={props.italic} wrap="truncate-end">
      {value}
    </Text>,
  )
}

export const more = (kit: Kit, count: number, noun: string): RenderChildren[] =>
  count > 0 ? [text(kit, `  … 還有 ${count} ${noun}`, { dim: true })] : []

export const diff = (kit: Kit, added: number, removed: number): RenderChildren => {
  const { Text } = kit
  return (
    <Text>
      <Text color="success">{`+${added}`}</Text>
      <Text> </Text>
      <Text color="error">{`−${removed}`}</Text>
    </Text>
  )
}
