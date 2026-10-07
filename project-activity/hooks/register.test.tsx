import { expect, mock, test } from 'claude-code/testing'

const SUMMARY = 'Passed!  - Failed:     0, Passed:   153, Skipped:     0, Total:   153, Duration: 2 s'
const NOW = 1_000_000_000_000
const ROOT = 'D:/workspace/LuckyDraw'
const NUL = String.fromCharCode(0)
const TAB = String.fromCharCode(9)
const FIELD = String.fromCharCode(31)
const RECORD = String.fromCharCode(30)

const PANE_PROPS = {
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 45 },
  view: {},
} as const
const PANE = { plugin: 'project-activity', component: 'Pane', requestId: 'project-activity', props: { title: '專案活動', ...PANE_PROPS } } as const
const GIT = { plugin: 'project-activity', component: 'Pane', requestId: 'git-status', props: { title: 'Git 狀態', ...PANE_PROPS } } as const

type Fake = {
  // 相對於 ROOT 的路徑 → 檔案或資料夾
  files: Record<string, { kind: 'file' | 'dir'; size?: number; mtimeMs?: number; text?: string }>
  // null 代表不是 git repo
  git: null | { status: string; staged: string; unstaged: string; log: string; stash: string; filters?: string; configFails?: boolean }
}

const LUCKYDRAW: Fake = {
  files: {
    'LuckyDraw.sln': { kind: 'file' },
    'README.md': { kind: 'file' },
    'CLAUDE.md': { kind: 'file' },
    '.claude': { kind: 'dir' },
    '.claude/project-activity.json': {
      kind: 'file',
      text: JSON.stringify({
        checks: [
          { path: 'Data/摸彩名單.xlsx', required: true, note: '缺少時程式拒絕啟動' },
          { path: 'Data/獎項清單.xlsx', note: '啟動時自動建立' },
          { path: 'Data/中獎名單', dir: true },
        ],
      }),
    },
    Data: { kind: 'dir' },
    'Data/獎項清單.xlsx': { kind: 'file', size: 4096, mtimeMs: NOW - 10 * 60000 },
    'Data/中獎名單': { kind: 'dir', mtimeMs: NOW - 60000 },
    'Data/中獎名單/頭獎.xlsx': { kind: 'file' },
    'Data/中獎名單/二獎.xlsx': { kind: 'file' },
  },
  git: null,
}

const REPO: Fake['git'] = {
  status: [
    '# branch.oid abc',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1',
    '1 M. N... 100644 100644 100644 a b src/Draw.cs',
    '1 .M N... 100644 100644 100644 a b README.md',
    '? 筆記.txt',
    '',
  ].join(NUL),
  staged: [`12${TAB}3${TAB}src/Draw.cs`, ''].join(NUL),
  unstaged: [`1${TAB}1${TAB}README.md`, ''].join(NUL),
  log: [
    `abc1234${FIELD}feat: 新增抽獎${FIELD}DADA${FIELD}${Math.floor((NOW - 3 * 3600_000) / 1000)}${RECORD}`,
    `def5678${FIELD}init${FIELD}DADA${FIELD}${Math.floor((NOW - 2 * 86400_000) / 1000)}${RECORD}`,
  ].join(''),
  stash: 'stash@{0}: WIP',
}

// engine 在 Windows 上會把路徑正規化成反斜線，比對前先統一並轉成相對路徑
const rel = (path: unknown): string => {
  const p = String(path).split(String.fromCharCode(92)).join('/')
  return p === ROOT ? '' : p.startsWith(`${ROOT}/`) ? p.slice(ROOT.length + 1) : p
}

// withClock: false 時由測試自己用 mock.clock 控制時間
let gitCalls: string[][] = []
let gitCwds: unknown[] = []

const answerEngine = (on: any, fake: Fake, { withClock = true } = {}) => {
  gitCalls = []
  gitCwds = []
  const children = (dir: string) =>
    Object.entries(fake.files)
      .filter(([p]) => (dir === '' ? !p.includes('/') : p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/')))
      .map(([p, f]) => ({ name: p.split('/').pop(), kind: f.kind, size: f.size ?? 0, mtimeMs: f.mtimeMs ?? NOW, isLink: false }))
  on('session.root', () => ({ value: ROOT }))
  if (withClock) on('clock.now', () => ({ value: NOW }))
  on('fs.list', (_$: unknown, e: any) => ({ value: children(rel(e.path)) }))
  on('fs.exists', (_$: unknown, e: any) => ({ value: rel(e.path) in fake.files }))
  on('fs.stat', (_$: unknown, e: any) => {
    const f = fake.files[rel(e.path)]
    return { value: { kind: f?.kind ?? 'other', size: f?.size ?? 0, mtimeMs: f?.mtimeMs ?? NOW, isLink: false } }
  })
  on('fs.read', (_$: unknown, e: any) => ({ value: fake.files[rel(e.path)]?.text ?? '' }))
  on('process.run', (_$: unknown, e: any) => {
    const argv: string[] = [...e.argv]
    gitCalls.push(argv)
    gitCwds.push(e.init?.cwd)
    // 略過安全設定的 -c key=value，取出真正的子指令
    const args = argv.slice(1)
    while (args[0] === '-c') args.splice(0, 2)
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } })
    if (fake.git === null) return { value: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' } }
    if (args[0] === 'config') {
      if (fake.git.configFails) return { value: { exitCode: 128, stdout: '', stderr: 'fatal: bad config line 3' } }
      return fake.git.filters ? ok(fake.git.filters) : { value: { exitCode: 1, stdout: '', stderr: '' } }
    }
    if (args[0] === 'rev-parse') return ok('true')
    if (args[0] === 'status') return ok(fake.git.status)
    if (args[0] === 'diff') return ok(args.includes('--cached') ? fake.git.staged : fake.git.unstaged)
    if (args[0] === 'log') return ok(fake.git.log)
    if (args[0] === 'stash') return ok(fake.git.stash)
    return ok('')
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('tool.call', () => ({ result: { stdout: SUMMARY, stderr: '', interrupted: false }, text: SUMMARY }))
}

const expectSingleLineRows = async (ui: any) => {
  const root: any = await ui.drawn()
  for (const sectionBox of root.children) {
    for (const row of sectionBox.children) {
      expect(row.props.height).toBe(1)
      expect(row.props.overflow).toBe('hidden')
    }
  }
}

test('測試跑完後 status line 顯示結果與框架', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('clock.now', () => ({ value: NOW }))
  on('tool.call', () => ({ result: { stdout: SUMMARY, stderr: '', interrupted: false }, text: SUMMARY }))

  await $.tool.call({ tool: 'PowerShell', command: 'dotnet test LuckyDraw.Core.slnf' })

  expect(statuses.at(-1)).toBe('測試 ✓ 153/153 · dotnet')
})

test('專案狀態：專案類型、關鍵檔案、測試結果與專案設定的檢查', async ($, on) => {
  answerEngine(on, LUCKYDRAW)
  await $.command.run({ command: 'project-activity', args: '' })
  await $.tool.call({ tool: 'PowerShell', command: 'dotnet test LuckyDraw.Core.slnf' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^LuckyDraw$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /· [.]NET/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /✓ README/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /○ [.]gitignore/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /✓ 153.153 全部通過/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /缺少必要檔案/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /缺少時程式拒絕啟動/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /4KB · 10 分鐘前/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2 份/ })).toBeDefined()
    await ui.unmount()
  }
})

test('其他專案：沒有設定檔時提示可以設定，設定檔格式錯誤時顯示原因', async ($, on) => {
  const other: Fake = { files: { 'package.json': { kind: 'file' } }, git: null }
  answerEngine(on, other)
  await $.command.run({ command: 'project-activity', args: '' })
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /· Node[.]js/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /可在 [.]claude.project-activity[.]json 設定/ })).toBeDefined()
  await ui.unmount()

  other.files['.claude/project-activity.json'] = { kind: 'file', text: '{"checks": "oops"}' }
  await $.command.run({ command: 'project-activity', args: '' })
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /設定檔有誤：缺少 "checks" 陣列/ })).toBeDefined()
  await ui.unmount()
})

test('熱門檔案與最近活動', async ($, on) => {
  answerEngine(on, LUCKYDRAW)
  await $.command.run({ command: 'project-activity', args: '' })
  const service = `${ROOT}/LuckyDraw.Core/Services/DrawService.cs`
  await $.tool.call({ tool: 'Read', file_path: service })
  await $.tool.call({ tool: 'Read', file_path: service })
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/CLAUDE.md` })
  await $.tool.call({ tool: 'Write', file_path: service, content: '' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /共 2 檔/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /讀  2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /✎ Services.DrawService[.]cs/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /修改 1 檔 · 工具 4 次/ })).toBeDefined()
    await ui.unmount()
  }
})

test('專案活動：三區等高、色框不同，每一列都限制為單行', async ($, on) => {
  answerEngine(on, LUCKYDRAW)
  await $.command.run({ command: 'project-activity', args: '' })
  await $.tool.call({ tool: 'PowerShell', command: 'dotnet test '.repeat(40) })
  await $.tool.call({ tool: 'Read', file_path: `D:/workspace/${'很長的資料夾名稱'.repeat(10)}/x.cs` })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, bodyColumns: 30 } })
    const root: any = await ui.drawn()
    expect(root.children.map((b: any) => b.props.height)).toEqual([15, 15, 15])
    expect(new Set(root.children.map((b: any) => b.props.borderColor)).size).toBe(3)
    await expectSingleLineRows(ui)
    await ui.unmount()
  }
})

test('Git 狀態：不是 repo 時提示 git init', async ($, on) => {
  answerEngine(on, LUCKYDRAW)
  await $.command.run({ command: 'git-status', args: '' })
  const ui = await $.ui.mount({ ...GIT, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /不是 git repository/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /git init/ })).toBeDefined()
  await ui.unmount()
})

test('Git 狀態：分支、工作區變更與最近提交', async ($, on) => {
  answerEngine(on, { ...LUCKYDRAW, git: REPO })
  await $.command.run({ command: 'git-status', args: '' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...GIT, surface })
    // 分支
    expect(await ui.find({ type: 'Text', text: /⎇ main/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /→ origin.main/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↑ 領先 2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↓ 落後 1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /stash 1/ })).toBeDefined()
    // 工作區變更：已暫存在前，附增刪行數
    expect(await ui.find({ type: 'Text', text: /已暫存 1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /未暫存 2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /src.Draw[.]cs/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /[+]12/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /筆記[.]txt/ })).toBeDefined()
    // 最近提交
    expect(await ui.find({ type: 'Text', text: /feat: 新增抽獎/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /3 小時前/ })).toBeDefined()
    await expectSingleLineRows(ui)
    await ui.unmount()
  }
})

test('/git-status 第二次執行會關閉 pane', async ($, on) => {
  answerEngine(on, LUCKYDRAW)
  expect((await $.command.run({ command: 'git-status', args: '' })).text).toMatch(/已開啟/)
  expect((await $.command.run({ command: 'git-status', args: '' })).text).toMatch(/已關閉/)
})

const BAND = {
  plugin: 'project-activity',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 10 },
} as const

test('band 在還沒有任何回合時不出現', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /工具呼叫/ })).toBeUndefined()
  await ui.unmount()
})

test('band 即時顯示本回合計數，按隱藏就消失', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  answerEngine(on, LUCKYDRAW)
  await $.tool.call({ tool: 'PowerShell', command: 'dir' })
  await $.tool.call({ tool: 'Write', file_path: `${ROOT}/Prize.cs`, content: '' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /本回合 · 2 次工具呼叫 · 修改 1 個檔案/ })).toBeDefined()
  await ui.press({ key: 'hide' })
  expect(await ui.find({ type: 'Text', text: /工具呼叫/ })).toBeUndefined()
  await ui.unmount()
})

// /clear 之後 session.start 不會再跑、狀態回到初始值，pane 卻還開著
test('Git pane 開著但沒有資料時，繪製後會自己補讀', async ($, on) => {
  answerEngine(on, { ...LUCKYDRAW, git: REPO }, { withClock: false })
  const clock = mock.clock(on, { now: NOW })

  const ui = await $.ui.mount({ ...GIT, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /讀取中/ })).toBeDefined()
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /讀取中/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /main/ })).toBeDefined()
  await ui.unmount()

  // 開關也一併恢復：之後的 git 指令會觸發更新
  const desktop = await $.ui.mount({ ...GIT, surface: 'desktop' })
  expect(await desktop.find({ type: 'Text', text: /新增抽獎/ })).toBeDefined()
  await desktop.unmount()
})

test('專案活動 pane 沒有資料時，繪製後會自己補讀', async ($, on) => {
  answerEngine(on, LUCKYDRAW, { withClock: false })
  const clock = mock.clock(on, { now: NOW })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /讀取中/ })).toBeDefined()
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /^LuckyDraw$/ })).toBeDefined()
  await ui.unmount()
})

test('git 指令一律以命令列設定關閉 repo 設定可能執行的外部程式', async ($, on) => {
  answerEngine(on, { ...LUCKYDRAW, git: REPO })
  await $.command.run({ command: 'git-status', args: '' })

  const reading = gitCalls.filter(argv => !argv.includes('config') && !argv.includes('rev-parse'))
  expect(reading.length).toBeGreaterThan(0)
  for (const argv of reading) {
    expect(argv).toContain('core.fsmonitor=false')
    expect(argv).toContain('log.showSignature=false')
  }
  const diffs = reading.filter(argv => argv.includes('diff'))
  for (const argv of diffs) {
    expect(argv).toContain('--no-ext-diff')
    expect(argv).toContain('--no-textconv')
  }
})

test('repo 自訂了 filter 時不執行 git status，並說明原因', async ($, on) => {
  answerEngine(on, { ...LUCKYDRAW, git: { ...REPO!, filters: `worktree${TAB}filter.evil.clean` } })
  await $.command.run({ command: 'git-status', args: '' })

  expect(gitCalls.some(argv => argv.includes('status'))).toBe(false)
  const ui = await $.ui.mount({ ...GIT, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /filter/ })).toBeDefined()
  await ui.unmount()
})

test('使用者全域設定的 filter（例如 git-lfs）不影響 Git pane', async ($, on) => {
  answerEngine(on, { ...LUCKYDRAW, git: { ...REPO!, filters: `global${TAB}filter.lfs.clean` } })
  await $.command.run({ command: 'git-status', args: '' })

  expect(gitCalls.some(argv => argv.includes('status'))).toBe(true)
})

test('專案根目錄有 git 執行檔（Windows 會優先執行）時，完全不執行 git', async ($, on) => {
  const files = { ...LUCKYDRAW.files, 'git.cmd': { kind: 'file' as const } }
  answerEngine(on, { files, git: REPO })
  await $.command.run({ command: 'git-status', args: '' })

  expect(gitCalls.length).toBe(0)
  const ui = await $.ui.mount({ ...GIT, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /git[.]cmd/ })).toBeDefined()
  await ui.unmount()
})

test('無法確認 repo 設定（git config 失敗）時不執行 git status', async ($, on) => {
  answerEngine(on, { ...LUCKYDRAW, git: { ...REPO!, configFails: true } })
  await $.command.run({ command: 'git-status', args: '' })

  expect(gitCalls.some(argv => argv.includes('status'))).toBe(false)
  const ui = await $.ui.mount({ ...GIT, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /無法確認/ })).toBeDefined()
  await ui.unmount()
})

test('git 指令都在專案根目錄執行', async ($, on) => {
  answerEngine(on, { ...LUCKYDRAW, git: REPO })
  await $.command.run({ command: 'git-status', args: '' })

  expect(gitCwds.length).toBeGreaterThan(0)
  for (const cwd of gitCwds) expect(String(cwd).split(String.fromCharCode(92)).join('/')).toBe(ROOT)
})

// 之前按了沒反應：pane 開著但開關被重置（例如 /clear 後）時，重新整理直接被略過
test('按「重新整理」一定會重新讀取 Git 狀態', async ($, on) => {
  answerEngine(on, { ...LUCKYDRAW, git: REPO }, { withClock: false })
  mock.clock(on, { now: NOW })

  const ui = await $.ui.mount({ ...GIT, surface: 'terminal' })
  await ui.press({ key: 'git-refresh' })

  expect(gitCalls.some(argv => argv.includes('status'))).toBe(true)
  expect(await ui.find({ type: 'Text', text: /⎇ main/ })).toBeDefined()
  await ui.unmount()
})
