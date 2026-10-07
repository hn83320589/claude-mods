import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'session-stats',
  component: 'Pane',
  requestId: 'session-stats',
  props: {
    title: '工作階段狀態',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const USAGE = {
  startedAt: 0,
  context: {
    percent: 42,
    tokens: 84000,
    window: 200000,
    breakdown: {
      categories: [
        { name: 'System prompt', tokens: 3000, color: '', isDeferred: false, kind: 'used' },
        { name: 'Messages', tokens: 60000, color: '', isDeferred: false, kind: 'used' },
        { name: 'Deferred tools', tokens: 9000, color: '', isDeferred: true, kind: 'deferred' },
        { name: 'Free space', tokens: 100000, color: '', isDeferred: false, kind: 'free' },
        { name: 'Autocompact buffer', tokens: 40000, color: '', isDeferred: false, kind: 'buffer' },
      ],
      totalTokens: 63000,
      maxTokens: 200000,
      rawMaxTokens: 200000,
      autocompactSource: 'model-default',
      percentage: 32,
      gridRows: [],
      model: 'claude-opus-5-5',
    },
  },
  rateLimits: [{ kind: 'five_hour', percentUsed: 23.5 }],
  cost: { usd: 1.25 },
}

const TALL = { ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 60 } } } as const

// withClock: false 時由測試自己用 mock.clock 控制時間
const answerEngine = (on: any, { withClock = true, turns = (): number => 3, percent = (): number => 42 } = {}) => {
  let nextId = 0
  on('session.usage', () => ({ value: { ...USAGE, context: { ...USAGE.context, percent: percent() } } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  if (withClock) {
    on('clock.now', () => ({ value: 0 }))
    on('clock.every', () => ({ value: undefined }))
  }
  on('session.turns', () => ({ value: turns() }))
  on('agent.list', () => ({
    value: [
      { id: 'a1', type: 'general-purpose', description: '搜尋 API', status: 'running' },
      { id: 'a2', type: 'Explore', description: '已完成的工作', status: 'completed' },
    ],
  }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('session.root', () => ({ value: 'D:/workspace/LuckyDraw' }))
  on('prompt.submit', (_$: unknown, e: any) => ({ text: e.text }))
  on('tool.call', (_$: unknown, e: any) =>
    e.tool === 'Edit'
      ? {
          result: { filePath: e.file_path, structuredPatch: [{ lines: ['-a', '+b', '+c'] }] },
          text: 'The file has been updated.',
        }
      : e.tool === 'TaskCreate'
      ? { result: { task: { id: String((nextId += 1)), subject: e.subject } }, text: '' }
      : { result: { stdout: '', stderr: '', interrupted: false }, text: '' },
  )
}

test('三個區塊各自顯示用量、任務與上下文', async ($, on) => {
  answerEngine(on)
  await $.command.run({ command: 'session-stats', args: '' })
  await $.tool.call({ tool: 'TaskCreate', subject: '整理三個區塊', description: '' })
  await $.tool.call({ tool: 'PowerShell', command: 'dir' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...TALL, surface })
    // 區塊一
    expect(await ui.find({ type: 'Text', text: /用量與預報/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /3 回合/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /42%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /5 小時/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /23\.5%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$1\.25/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /工具 2 次/ })).toBeDefined()
    // 區塊二：進行中的 subagent 列出，完成的不列；工具排行
    expect(await ui.find({ type: 'Text', text: /⚙ general-purpose · 搜尋 API · 執行中/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /已完成的工作/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /任務與執行紀錄/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2 次/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /○ 整理三個區塊/ })).toBeDefined()
    // 區塊三：deferred 類別不列出
    expect(await ui.find({ type: 'Text', text: /上下文與改動/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Messages/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Deferred tools/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Free space/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Autocompact buffer/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('三個區塊等高，各自用不同顏色的圓角框線', async ($, on) => {
  answerEngine(on)
  await $.command.run({ command: 'session-stats', args: '' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const root: any = await ui.drawn()
    const boxes = root.children.filter((c: any) => c.type === 'Box')
    expect(boxes.map((b: any) => b.props.height)).toEqual([10, 10, 10])
    expect(boxes.map((b: any) => b.props.borderStyle)).toEqual(['round', 'round', 'round'])
    expect(new Set(boxes.map((b: any) => b.props.borderColor)).size).toBe(3)
    await ui.unmount()
  }
})

test('任務太多時顯示「還有 N 項」', async ($, on) => {
  answerEngine(on)
  await $.command.run({ command: 'session-stats', args: '' })
  for (let i = 1; i <= 12; i += 1) {
    await $.tool.call({ tool: 'TaskCreate', subject: `任務 ${i}`, description: '' })
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // 區塊高 10：框線 2 + 標題 1，剩 7 列；上段最多 35%（2 列），其餘留給執行紀錄與回放
  // → 只放得下進行中的 subagent 一列 + 「還有 12 項」
  expect(await ui.find({ type: 'Text', text: /⚙ general-purpose/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /任務 1$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /還有 12 項/ })).toBeDefined()
  await ui.unmount()
})

test('回放劇場列出回合的步驟，可以切換回合與步驟', async ($, on) => {
  answerEngine(on)
  await $.command.run({ command: 'session-stats', args: '' })
  await $.prompt.submit({ text: '第一個問題' })
  await $.tool.call({ tool: 'PowerShell', command: 'dir' })
  await $.prompt.submit({ text: '第二個問題' })
  await $.tool.call({ tool: 'PowerShell', command: 'dotnet build' })
  await $.tool.call({ tool: 'PowerShell', command: 'dotnet test' })

  const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })
  // 預設跟著最新回合的最後一步
  expect(await ui.find({ type: 'Text', text: /回放 2\/2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /第二個問題/ })).toBeDefined()

  await ui.press({ key: 'turn-prev' })
  expect(await ui.find({ type: 'Text', text: /回放 1\/2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /第一個問題/ })).toBeDefined()
  expect(await ui.find({ key: 'follow' })).toBeDefined()

  await ui.press({ key: 'follow' })
  expect(await ui.find({ type: 'Text', text: /回放 2\/2/ })).toBeDefined()
  await ui.unmount()
})

test('影響範圍依資料夾分組，改程式碼沒動測試會警告', async ($, on) => {
  answerEngine(on)
  await $.command.run({ command: 'session-stats', args: '' })
  await $.tool.call({ tool: 'Edit', file_path: 'D:/workspace/LuckyDraw/LuckyDraw.Core/Prize.cs', old_string: 'a', new_string: 'b' })

  const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /有改程式碼但沒動測試/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Prize\.cs/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\+2/ })).toBeDefined()
  await ui.unmount()
})

test('預報顯示天氣與 compact 預估', async ($, on) => {
  answerEngine(on)
  await $.command.run({ command: 'session-stats', args: '' })

  const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })
  // context 42%，5 小時用量沒有可外推的重置時間 → 以 42% 判斷為多雲
  expect(await ui.find({ type: 'Text', text: /─ 預報/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /☁ 多雲|☀ 晴朗/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /累積兩回合以上才能預估/ })).toBeDefined()
  await ui.unmount()
})

test('每一列都限制為單行，內容再長也不會換行撐歪區塊', async ($, on) => {
  answerEngine(on)
  await $.command.run({ command: 'session-stats', args: '' })
  await $.prompt.submit({ text: '一個非常非常長的問題'.repeat(20) })
  await $.tool.call({ tool: 'TaskCreate', subject: '很長的任務名稱'.repeat(20), description: '' })
  await $.tool.call({ tool: 'PowerShell', command: 'dotnet test '.repeat(30) })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...TALL, surface, props: { ...TALL.props, bodyColumns: 30 } })
    const root: any = await ui.drawn()
    for (const sectionBox of root.children) {
      // 區塊的每個子元素就是一列，都必須是高度 1、超出裁掉
      for (const row of sectionBox.children) {
        expect(row.props.height).toBe(1)
        expect(row.props.overflow).toBe('hidden')
      }
    }
    await ui.unmount()
  }
})

test('/session-stats 第二次執行會關閉 pane', async ($, on) => {
  answerEngine(on)
  const opened = await $.command.run({ command: 'session-stats', args: '' })
  const closed = await $.command.run({ command: 'session-stats', args: '' })
  expect(opened.text).toMatch(/已開啟/)
  expect(closed.text).toMatch(/已關閉/)
})

// /clear 之後 session.start 不會再跑、狀態回到初始值，pane 卻還開著
test('pane 開著但沒有資料時，繪製後會自己補讀', async ($, on) => {
  answerEngine(on, { withClock: false })
  const clock = mock.clock(on)

  const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /讀取中/ })).toBeDefined()
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /讀取中/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /42%/ })).toBeDefined()
  await ui.unmount()

  // 補回來的是共用狀態，另一個 surface 也看得到
  const desktop = await $.ui.mount({ ...TALL, surface: 'desktop' })
  expect(await desktop.find({ type: 'Text', text: /3 回合/ })).toBeDefined()
  await desktop.unmount()
})

test('補讀之後計時更新恢復運作', async ($, on) => {
  let turns = 3
  answerEngine(on, { withClock: false, turns: () => turns })
  const clock = mock.clock(on)
  const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /3 回合/ })).toBeDefined()

  // 計時器每 15 秒更新一次，回合數改變後畫面跟著更新
  turns = 7
  await clock.advance(15_000)
  expect(await ui.find({ type: 'Text', text: /7 回合/ })).toBeDefined()
  await ui.unmount()
})

test('按「重新整理」立即重新讀取用量', async ($, on) => {
  answerEngine(on, { withClock: false })
  mock.clock(on)

  const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /讀取中/ })).toBeDefined()
  await ui.press({ key: 'usage-refresh' })

  expect(await ui.find({ type: 'Text', text: /42%/ })).toBeDefined()
  await ui.unmount()
})

// ── context 自動處理 ──

// fs.stat 對不存在的路徑以 ENOENT 拒絕
const missing = (path: string) => ({ deny: `ENOENT: no such file or directory, stat '${path}'` })

const answerFiles = (on: any, written: Record<string, string>) => {
  on('fs.stat', (_$: unknown, e: any) => {
    const path = String(e.path)
    if (!/[.](md|gitignore)$/.test(path)) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: path } }
    if (!(path in written)) return missing(path)
    return { value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false, realPath: path } }
  })
  on('fs.exists', (_$: unknown, e: any) => ({ value: String(e.path) in written }))
  on('fs.list', () => ({ value: [] }))
  on('fs.write', (_$: unknown, e: any) => {
    written[String(e.path).split(String.fromCharCode(92)).join('/')] = e.text
    return { value: undefined }
  })
}

test('每次壓縮都加上要保留的重點，完成後把摘要存到專案（資料夾不提交）', async ($, on) => {
  const written: Record<string, string> = {}
  let instructions = ''
  answerEngine(on)
  answerFiles(on, written)
  on('session.compact', (_$: unknown, e: any) => {
    instructions = e.instructions ?? ''
    return { messages: [{ role: 'user', text: '摘要：正在重構 workbench', toolUses: [] }] }
  })

  await $.session.compact({ trigger: 'manual', instructions: '注意 API 變更', messages: [{ role: 'user', text: '重構 workbench', toolUses: [] }] } as any)

  expect(instructions).toContain('注意 API 變更')
  expect(instructions).toContain('目前正在進行的任務')
  const files = Object.keys(written)
  expect(files.some(f => f.endsWith('.claude/session-notes/.gitignore'))).toBe(true)
  const note = files.find(f => /session-notes[/].+[.]md$/.test(f))
  expect(note === undefined ? '' : written[note]).toContain('摘要：正在重構 workbench')
})

test('回合結束時 context 達 80% 就先壓縮', async ($, on) => {
  const written: Record<string, string> = {}
  let compacted = 0
  answerEngine(on, { withClock: false, percent: () => 85 })
  answerFiles(on, written)
  const clock = mock.clock(on)
  on('session.compact', () => {
    compacted += 1
    return { messages: [{ role: 'user', text: '摘要', toolUses: [] }] }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.turn.complete({ answer: '完成', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.settle()

  expect(compacted).toBe(1)
})

test('context 未達 80% 時不壓縮', async ($, on) => {
  let compacted = 0
  answerEngine(on, { withClock: false, percent: () => 60 })
  answerFiles(on, {})
  const clock = mock.clock(on)
  on('session.compact', () => {
    compacted += 1
    return { messages: [] }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.turn.complete({ answer: '完成', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.settle()

  expect(compacted).toBe(0)
})

test('.claude 是指向專案外的符號連結時不存摘要', async ($, on) => {
  const written: Record<string, string> = {}
  answerEngine(on)
  on('fs.exists', () => ({ value: true }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', (_$: unknown, e: any) => ({
    value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: String(e.path).endsWith('.claude'), realPath: String(e.path).endsWith('.claude') ? 'C:/Users/me/AppData/Roaming/Microsoft/Windows/Start Menu' : String(e.path) },
  }))
  on('fs.write', (_$: unknown, e: any) => {
    written[String(e.path)] = e.text
    return { value: undefined }
  })
  on('session.compact', () => ({ messages: [{ role: 'user', text: '摘要', toolUses: [] }] }))

  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: '對話', toolUses: [] }] } as any)

  expect(Object.keys(written)).toEqual([])
})

test('.gitignore 是指向專案外、目標不存在的符號連結時不存摘要', async ($, on) => {
  const written: Record<string, string> = {}
  answerEngine(on)
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', (_$: unknown, e: any) => {
    const path = String(e.path)
    if (path.endsWith('.gitignore')) return { value: { kind: 'other', size: 0, mtimeMs: 0, isLink: true } }
    if (path.endsWith('.md')) return missing(path)
    return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: path } }
  })
  on('fs.write', (_$: unknown, e: any) => {
    written[String(e.path)] = e.text
    return { value: undefined }
  })
  on('session.compact', () => ({ messages: [{ role: 'user', text: '摘要', toolUses: [] }] }))

  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: '對話', toolUses: [] }] } as any)

  expect(Object.keys(written)).toEqual([])
})

test('無法確認 .claude 的狀態（不是不存在）時不存摘要', async ($, on) => {
  const written: Record<string, string> = {}
  answerEngine(on)
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', (_$: unknown, e: any) => {
    const path = String(e.path)
    if (path.endsWith('.claude')) return { deny: `EACCES: permission denied, stat '${path}'` }
    if (/[.](md|gitignore)$/.test(path) || path.endsWith('session-notes')) return missing(path)
    return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: path } }
  })
  on('fs.write', (_$: unknown, e: any) => {
    written[String(e.path)] = e.text
    return { value: undefined }
  })
  on('session.compact', () => ({ messages: [{ role: 'user', text: '摘要', toolUses: [] }] }))

  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: '對話', toolUses: [] }] } as any)

  expect(Object.keys(written)).toEqual([])
})
