import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { CheckRow, GitView, ProjectStatus, ToolCall, Turn } from '../types'
import { LOG_FORMAT, letterOf, parseLog, parseNumstat, parseStatus, STATUS_NAMES } from './git'
import { fit, SECTION_CHROME, share, splitRows } from './layout'
import { formatStatus, isTestCommand, parseTestSummary } from './parse'
import { ago, CONFIG_PATH, describeCheck, detectTypes, hottest, keyFiles, parseConfig, recordHeat } from './project'
import type { Found } from './project'
import { clean, clip } from './text'
import { barOf, diff, line, more, rule, section, text } from './ui'

const PANE = 'project-activity'
const PANE_TITLE = '專案活動'
const GIT_PANE = 'git-status'
const GIT_TITLE = 'Git 狀態'
const COLOR = { project: 'success', heat: 'claude', activity: 'suggestion' } as const
const GIT_COLOR = { branch: 'claude', changes: 'warning', commits: 'success' } as const
const LETTER_COLOR: Record<string, string> = { M: 'warning', A: 'success', D: 'error', R: 'suggestion', C: 'suggestion', U: 'error' }
const COMMIT_COUNT = 30
const FILTER_SKIPPED = '這個 repository 的設定定義了 filter，為了安全不自動執行 git 指令'

const lastTest = atom({ plugin: 'project-activity', key: 'lastTest' } as const, null)
const lastTestAt = atom({ plugin: 'project-activity', key: 'lastTestAt' } as const, null)
const calls = atom({ plugin: 'project-activity', key: 'calls' } as const, [])
const edited = atom({ plugin: 'project-activity', key: 'edited' } as const, [])
const turn = atom({ plugin: 'project-activity', key: 'turn' } as const, null)
const isBandHidden = atom({ plugin: 'project-activity', key: 'isBandHidden' } as const, false)
const heat = atom({ plugin: 'project-activity', key: 'heat' } as const, [])
const project = atom({ plugin: 'project-activity', key: 'project' } as const, null)
const isGitOpen = atom({ plugin: 'project-activity', key: 'isGitOpen' } as const, false)
const git = atom({ plugin: 'project-activity', key: 'git' } as const, null)

const EMPTY_TURN: Turn = { seconds: null, tools: 0, edits: 0 }

const slash = (path: string): string => path.replaceAll(String.fromCharCode(92), '/')
const shortPath = (path: string): string => slash(path).split('/').slice(-2).join('/')
const fileName = (path: string): string => clean(slash(path).split('/').pop() ?? path)
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

// ── 專案狀態 ──────────────────────────────────────────────

const inspect = async ($: EngineInterface, path: string, isDir: boolean): Promise<Found | undefined> => {
  if (!(await $.fs.exists(path))) return undefined
  const stat = await $.fs.stat(path)
  const count = isDir && stat.kind === 'dir' ? (await $.fs.list(path)).filter(e => e.kind === 'file').length : 0
  return { kind: stat.kind, size: stat.size, mtimeMs: stat.mtimeMs, count }
}

// 讀專案根目錄與專案設定檔；設定檔有問題只顯示原因，不擋其他資訊
const refreshProject = async ($: EngineInterface): Promise<void> => {
  const root = slash(await $.session.root())
  const entries = await $.fs.list(root)
  let checks: CheckRow[] | null = null
  let configError: string | null = null
  const configFile = `${root}/${CONFIG_PATH}`
  if (await $.fs.exists(configFile)) {
    try {
      const specs = parseConfig(await $.fs.read(configFile))
      const now = await $.clock.now()
      checks = []
      for (const spec of specs) checks.push(describeCheck(spec, await inspect($, `${root}/${spec.path}`, spec.dir), now))
    } catch (err) {
      configError = message(err)
    }
  }
  const next: ProjectStatus = { name: fileName(root), types: detectTypes(entries), keyFiles: keyFiles(entries), checks, configError }
  await update($, project, () => next)
}

// ── Git 狀態 ──────────────────────────────────────────────

// 開啟的資料夾可能是別人的 repo：.git/config 能設定 fsmonitor、外部 diff、textconv、簽章驗證程式，
// 讓 git status／diff／log 順便執行任意程式。以命令列設定（優先權高於 repo 設定）關閉這些功能，
// diff 另加 --no-ext-diff、--no-textconv，並忽略 submodule（會讀取 submodule 自己的設定）。
const SAFE_CONFIG = [
  '-c', 'core.fsmonitor=false',
  '-c', 'core.untrackedCache=false',
  '-c', 'diff.external=',
  '-c', 'log.showSignature=false',
  '-c', 'status.submoduleSummary=false',
]
const gitArgv = (args: readonly string[]): string[] => ['git', ...SAFE_CONFIG, ...args]

// filter（clean／smudge／process）可能在 git status 時被執行，名稱由 repo 自訂、無法逐一關閉：
// repo 自己的設定（local 與 worktree 範圍，含 include 的檔案）定義了 filter 時，就不自動執行 git。
// 使用者全域或系統設定的 filter（例如 git-lfs）是使用者自己裝的，不受影響。讀取設定本身不會執行任何程式。
const hasRepoFilters = async ($: EngineInterface): Promise<boolean> => {
  const result = await $.process.run(
    gitArgv(['config', '--includes', '--show-scope', '--name-only', '--get-regexp', '^filter[.].*[.](clean|smudge|process)$']),
    { timeoutMs: 10_000 },
  )
  if (result.exitCode !== 0) return false
  return result.stdout
    .split(String.fromCharCode(10))
    .map(line => line.split(String.fromCharCode(9))[0]?.trim())
    .some(scope => scope === 'local' || scope === 'worktree')
}

// Windows 執行 git 時會先找目前資料夾（專案根目錄）裡的 git.exe、git.cmd 等。
// 根目錄有這類檔案時，執行的會是 repo 提供的程式，所以完全不執行 git。
const SHADOWING_GIT = /^git[.](com|exe|bat|cmd|vbs|vbe|js|jse|wsf|wsh|msc|cpl|ps1)$/i

const shadowingGit = async ($: EngineInterface): Promise<string | null> => {
  const root = slash(await $.session.root())
  const entry = (await $.fs.list(root)).find(e => SHADOWING_GIT.test(e.name))
  return entry ? clean(entry.name) : null
}

const gitRun = async ($: EngineInterface, args: readonly string[]): Promise<string> => {
  const result = await $.process.run(gitArgv(args), { timeoutMs: 10_000 })
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `git ${args[0] ?? ''} 失敗（${result.exitCode}）`)
  return result.stdout
}

// git pane 關著時不跑任何 git 指令
const refreshGit = async ($: EngineInterface): Promise<void> => {
  if (!(await read($, isGitOpen))) return
  let next: GitView
  try {
    const shadow = await shadowingGit($)
    if (shadow !== null) {
      await update($, git, () => ({
        isRepo: true, status: null, staged: {}, unstaged: {}, commits: [], stashes: 0,
        error: `專案根目錄有 ${shadow}，Windows 執行 git 時會優先執行它，為了安全不自動執行 git 指令`,
      }))
      return
    }
    const inside = await $.process.run(gitArgv(['rev-parse', '--is-inside-work-tree']), { timeoutMs: 10_000 })
    if (inside.exitCode !== 0 || inside.stdout.trim() !== 'true') {
      next = { isRepo: false, status: null, staged: {}, unstaged: {}, commits: [], stashes: 0, error: null }
    } else if (await hasRepoFilters($)) {
      next = { isRepo: true, status: null, staged: {}, unstaged: {}, commits: [], stashes: 0, error: FILTER_SKIPPED }
    } else {
      const status = parseStatus(await gitRun($, ['status', '--porcelain=v2', '--branch', '-z', '--ignore-submodules=all']))
      const diff = ['diff', '--numstat', '-z', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all']
      const staged = parseNumstat(await gitRun($, [...diff, '--cached']))
      const unstaged = parseNumstat(await gitRun($, diff))
      // 剛 init、還沒有任何 commit 時 git log 會失敗，視為沒有提交
      const log = await $.process.run(gitArgv(['log', `-n${COMMIT_COUNT}`, `--format=${LOG_FORMAT}`]), { timeoutMs: 10_000 })
      const commits = log.exitCode === 0 ? parseLog(log.stdout) : []
      const stashes = (await gitRun($, ['stash', 'list'])).split('\n').filter(l => l.trim() !== '').length
      next = { isRepo: true, status, staged, unstaged, commits, stashes, error: null }
    }
  } catch (err) {
    next = { isRepo: true, status: null, staged: {}, unstaged: {}, commits: [], stashes: 0, error: `git 指令失敗：${message(err)}` }
  }
  await update($, git, () => next)
}

const openGit = async ($: EngineInterface): Promise<void> => {
  await update($, isGitOpen, () => true)
  await refreshGit($)
  await $.ui.open({ id: GIT_PANE, title: GIT_TITLE })
}

// ── 補讀 ──────────────────────────────────────────────────
// /clear 或新的工作階段不會再觸發 session.start，狀態卻會重置：pane 還開著，開關與資料都回到初始值，
// git pane 之後的更新全被當成「關著」而跳過。繪製時發現沒有資料，就安排一次更新補回來。
// 繪製期間不能寫狀態，所以交給 clock.after 在繪製之後執行；失敗時隔一段時間才再試，避免每次重繪都重試。
const HEAL_RETRY_MS = 5_000
const healing = new Set<string>()
const lastHealAt = new Map<string, number>()

const scheduleHeal = async ($: EngineInterface, name: string, work: () => Promise<void>): Promise<void> => {
  const now = await $.clock.now()
  if (healing.has(name) || now - (lastHealAt.get(name) ?? Number.NEGATIVE_INFINITY) < HEAL_RETRY_MS) return
  healing.add(name)
  lastHealAt.set(name, now)
  $.clock.after(0, () => {
    void (async () => {
      try {
        await work()
      } catch (err) {
        $.ui.log(`${name} 資料補讀失敗：${message(err)}`, { to: 'debug' })
      } finally {
        healing.delete(name)
      }
    })()
  })
}

// ── Hooks ─────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'project-activity', description: `開啟「${PANE_TITLE}」pane` })
    await $.command.register({ name: 'git-status', description: `開啟或關閉「${GIT_TITLE}」pane` })
    $.ui.status(formatStatus(await read($, lastTest)))
    await refreshProject($)
    void $.ui.open({ id: PANE, title: PANE_TITLE })
    await openGit($)
    return next(e)
  })

  on('command.run', { command: 'project-activity' }, async $ => {
    await update($, isBandHidden, () => false)
    await refreshProject($)
    await $.ui.open({ id: PANE, title: PANE_TITLE })
    return { text: `已開啟「${PANE_TITLE}」pane。` }
  })

  on('command.run', { command: 'git-status' }, async $ => {
    if (await read($, isGitOpen)) {
      await $.ui.close({ id: GIT_PANE })
      return { text: `已關閉「${GIT_TITLE}」pane。` }
    }
    await openGit($)
    return { text: `已開啟「${GIT_TITLE}」pane。` }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === GIT_PANE) await update($, isGitOpen, () => false)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, turn, () => EMPTY_TURN)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await update($, turn, t => ({ ...(t ?? EMPTY_TURN), tools: (t?.tools ?? 0) + 1 }))
    const command = e.tool === 'Bash' || e.tool === 'PowerShell' ? e.command : undefined
    const file = e.tool === 'Edit' || e.tool === 'Write' ? e.file_path : undefined
    const readFile = e.tool === 'Read' ? e.file_path : undefined
    const label = clean(command?.slice(0, 60) ?? (file !== undefined ? shortPath(file) : readFile !== undefined ? shortPath(readFile) : ''))
    const call: ToolCall = { id: e.tool_use_id, tool: e.tool, label, isDone: false, isError: false }
    await update($, calls, list => [...list, call].slice(-200))

    const ran = await next(e)
    const isError = ran.deny !== undefined || ran.isError === true
    await update($, calls, list =>
      list.map(one => (one.id === call.id ? { ...one, isDone: true, isError } : one)),
    )

    if (readFile !== undefined && !isError) {
      await update($, heat, list => recordHeat(list, readFile, 'read'))
    }

    if (file !== undefined && !isError) {
      await update($, turn, t => ({ ...(t ?? EMPTY_TURN), edits: (t?.edits ?? 0) + 1 }))
      await update($, edited, list => (list.includes(file) ? list : [...list, file]))
      await update($, heat, list => recordHeat(list, file, 'edit'))
    }

    if (command !== undefined && isTestCommand(command) && ran.deny === undefined) {
      const result = parseTestSummary(ran.text ?? '')
      if (result !== null) {
        await update($, lastTest, () => result)
        const at = await $.clock.now()
        await update($, lastTestAt, () => at)
        $.ui.status(formatStatus(result))
      } else if (ran.isError === true) {
        $.ui.status('測試 ✗ 建置或執行失敗')
      }
    }

    // 改了檔案或跑了 git 指令，工作區狀態就可能變了
    if (file !== undefined || (command !== undefined && /\bgit\b/.test(command))) await refreshGit($)

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    // subagent 的回合也會觸發 turn.complete，只記主迴圈的
    if (e.agentId === undefined) {
      const seconds = Math.round(e.durationMs / 1000)
      await update($, turn, t => ({ ...(t ?? EMPTY_TURN), seconds }))
      await refreshProject($)
      await refreshGit($)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = await read($, turn)
    if (e.props.hasSurvey || now === null || (await read($, isBandHidden))) {
      return next(e)
    }
    const test = await read($, lastTest)
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text key="turn" dimColor>
          {now.seconds === null ? '本回合' : `上一回合 ${now.seconds}s`} · {now.tools} 次工具呼叫 · 修改 {now.edits} 個檔案
        </Text>
        {test !== null && (
          <Text key="test" color={test.isOk ? 'green' : 'red'}>
            {' '}· 測試 {test.isOk ? '✓' : '✗'} {test.passed}/{test.total}{' '}
          </Text>
        )}
        <Button key="hide" label="隱藏" onPress={() => update($, isBandHidden, () => true)} />
      </Box>
    )
  })

  // ── 專案活動 pane ──
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e)
    const { Box, Text } = kit
    const test = await read($, lastTest)
    const testAt = await read($, lastTestAt)
    const status = await read($, project)
    const heatList = hottest(await read($, heat))
    const files = await read($, edited)
    const list = await read($, calls)
    if (status === null) await scheduleHeal($, PANE, () => refreshProject($))
    const now = await $.clock.now()

    const [projectRows = 4, heatRows = 4, activityRows = 4] = splitRows(Math.max(12, e.props.scroll.bodyRows), 3)
    const inner = Math.max(24, e.props.bodyColumns - 4)

    // ── 區塊一：專案狀態 ──
    const headRows: RenderChildren[] =
      status === null
        ? [text(kit, '讀取中…', { dim: true })]
        : [
            line(
              kit,
              <Text wrap="truncate-end">
                <Text bold>{status.name}</Text>
                <Text dimColor>{status.types.length === 0 ? '  · 未偵測到專案類型' : `  · ${status.types.join(' · ')}`}</Text>
              </Text>,
            ),
            test === null
              ? text(kit, '測試  尚未在這個 session 跑過測試', { dim: true })
              : line(
                  kit,
                  <Text wrap="truncate-end">
                    <Text dimColor>測試  </Text>
                    <Text color={test.isOk ? 'success' : 'error'} bold>
                      {test.isOk ? `✓ ${test.passed}/${test.total} 全部通過` : `✗ ${test.failed} 個失敗（${test.passed}/${test.total}）`}
                    </Text>
                    <Text dimColor>{` · ${test.runner}${testAt === null ? '' : ` · ${ago(testAt, now)}`}`}</Text>
                  </Text>,
                ),
            line(
              kit,
              <Text wrap="truncate-end">
                {status.keyFiles.map((k, i) => (
                  <Text>
                    <Text>{i === 0 ? '' : '  '}</Text>
                    <Text color={k.found ? 'success' : undefined} dimColor={!k.found}>{`${k.found ? '✓' : '○'} ${k.label}`}</Text>
                  </Text>
                ))}
              </Text>,
            ),
          ]
    const missingRequired = status?.checks?.some(r => r.state === 'missing-required') ?? false
    const checkRows: RenderChildren[] =
      status === null
        ? []
        : status.configError !== null
          ? [text(kit, `設定檔有誤：${status.configError}`, { color: 'error' })]
          : status.checks === null
            ? [text(kit, `可在 ${CONFIG_PATH} 設定要檢查的檔案`, { dim: true })]
            : status.checks.map(r =>
                line(
                  kit,
                  <Box flexGrow={1}>
                    <Text color={r.state === 'ok' ? 'success' : r.state === 'missing-required' ? 'error' : undefined} dimColor={r.state === 'missing-optional'}>
                      {r.state === 'ok' ? '✓ ' : r.state === 'missing-required' ? '✗ ' : '○ '}
                    </Text>
                    <Box flexGrow={1} overflow="hidden">
                      <Text bold={r.state === 'missing-required'} dimColor={r.state === 'missing-optional'} wrap="truncate-end">{r.name}</Text>
                    </Box>
                    <Text color={r.state === 'missing-required' ? 'error' : undefined} dimColor={r.state !== 'missing-required'}>{` ${r.detail}`}</Text>
                  </Box>,
                ),
              )
    const checkFit = fit(checkRows, projectRows - SECTION_CHROME - headRows.length - 1)

    // ── 區塊二：熱門檔案 ──
    const maxHeat = Math.max(1, ...heatList.map(f => f.reads + f.edits))
    const heatBar = Math.max(4, Math.floor(inner / 4))
    const heatFit = fit(
      // 變數不能取名 h：JSX 編譯後呼叫的就是全域 h
      heatList.map(f => {
        const bar = barOf(((f.reads + f.edits) / maxHeat) * 100, heatBar)
        return line(
          kit,
          <Box flexGrow={1}>
            <Box flexGrow={1} overflow="hidden"><Text wrap="truncate-end">{fileName(f.path)}</Text></Box>
            <Text color={COLOR.heat}>{` ${bar.full}`}</Text>
            <Text dimColor>{bar.rest}</Text>
            <Text dimColor>{` 讀 ${String(f.reads).padStart(2)}`}</Text>
            <Text color={f.edits > 0 ? 'warning' : undefined} dimColor={f.edits === 0}>{` 改 ${String(f.edits).padStart(2)}`}</Text>
          </Box>,
        )
      }),
      heatRows - SECTION_CHROME,
    )

    // ── 區塊三：最近活動 ──
    const split = share(activityRows - SECTION_CHROME, Math.max(1, files.length), 0.4, 2)
    const fileFit = fit(
      [...files].reverse().map(path => text(kit, `✎ ${shortPath(path)}`, { color: COLOR.activity })),
      split.upper,
    )
    const callRows = list.slice(-Math.max(1, split.lower - 1)).map(call =>
      line(
        kit,
        <Box flexGrow={1}>
          <Text color={call.isError ? 'error' : call.isDone ? 'success' : 'warning'}>
            {call.isDone ? (call.isError ? '✗ ' : '✓ ') : '… '}
          </Text>
          <Text bold={!call.isDone}>{`${call.tool} `}</Text>
          <Box flexGrow={1} overflow="hidden">
            <Text dimColor wrap="truncate-end">{call.label}</Text>
          </Box>
        </Box>,
      ),
    )

    return (
      <Box flexDirection="column">
        {section(
          kit,
          {
            color: COLOR.project,
            title: '◆ 專案狀態',
            height: projectRows,
            right: missingRequired ? <Text color="error">缺少必要檔案</Text> : undefined,
          },
          [...headRows, rule(kit, '專案檢查', COLOR.project), ...checkFit.shown, ...more(kit, checkFit.more, '項')],
        )}

        {section(
          kit,
          {
            color: COLOR.heat,
            title: '◆ 熱門檔案',
            height: heatRows,
            right: heatList.length > 0 ? <Text dimColor>{`共 ${heatList.length} 檔`}</Text> : undefined,
          },
          heatList.length === 0
            ? [text(kit, '還沒有讀取或修改任何檔案', { dim: true })]
            : [...heatFit.shown, ...more(kit, heatFit.more, '檔')],
        )}

        {section(
          kit,
          {
            color: COLOR.activity,
            title: '◆ 最近活動',
            height: activityRows,
            right: <Text dimColor>{`修改 ${files.length} 檔 · 工具 ${list.length} 次`}</Text>,
          },
          [
            ...(files.length === 0 ? [text(kit, '本 session 還沒有修改檔案', { dim: true })] : [...fileFit.shown, ...more(kit, fileFit.more, '檔')]),
            rule(kit, '工具呼叫', COLOR.activity),
            ...(callRows.length === 0 ? [text(kit, '尚無', { dim: true })] : callRows),
          ],
        )}
      </Box>
    )
  })

  // ── Git 狀態 pane ──
  on('ui.render', { component: 'Pane', requestId: GIT_PANE }, async ($, e) => {
    const kit = $.ui.resolve(e)
    const { Box, Button, Text } = kit
    const view = await read($, git)
    if (view === null || !(await read($, isGitOpen))) {
      await scheduleHeal($, GIT_PANE, async () => {
        await update($, isGitOpen, () => true)
        await refreshGit($)
      })
    }
    const now = await $.clock.now()
    const bodyRows = Math.max(12, e.props.scroll.bodyRows)
    const inner = Math.max(24, e.props.bodyColumns - 4)

    const controls = (
      <Box columnGap={1}>
        <Button key="git-refresh" dimColor hotkey="r" onPress={() => refreshGit($)}>重新整理</Button>
        <Button key="git-close" dimColor onPress={() => $.ui.close({ id: GIT_PANE })}>關閉</Button>
      </Box>
    )

    // 不是 repo、讀取中或出錯時，整個 pane 只用一個區塊說明
    if (view === null || !view.isRepo || view.error !== null || view.status === null) {
      const rows =
        view === null
          ? [text(kit, '讀取中…', { dim: true })]
          : !view.isRepo
            ? [text(kit, '這個資料夾不是 git repository'), text(kit, '執行 git init 開始版本控制後，這裡會顯示分支與變更', { dim: true })]
            : [text(kit, view.error ?? 'git 指令失敗：未知原因', { color: 'error' })]
      return (
        <Box flexDirection="column">
          {section(kit, { color: GIT_COLOR.branch, title: '◆ Git 狀態', height: Math.min(bodyRows, rows.length + SECTION_CHROME), right: controls }, rows)}
        </Box>
      )
    }

    const s = view.status
    const [branchRows = 4, changeRows = 4, commitRows = 4] = splitRows(bodyRows, 3)
    const stagedFiles = s.files.filter(f => f.kind === 'changed' && f.staged !== '.')
    const otherFiles = s.files.filter(f => !(f.kind === 'changed' && f.staged !== '.'))
    const untracked = s.files.filter(f => f.kind === 'untracked').length
    const conflicts = s.files.filter(f => f.kind === 'conflict').length
    const unstagedCount = otherFiles.length - untracked - conflicts
    const totals = [...Object.values(view.staged), ...Object.values(view.unstaged)].reduce(
      (t, n) => ({ added: t.added + n.added, removed: t.removed + n.removed }),
      { added: 0, removed: 0 },
    )
    const latest = view.commits[0]

    // ── 區塊一：分支 ──
    const branchLines: RenderChildren[] = [
      line(
        kit,
        <Text wrap="truncate-end">
          <Text color={GIT_COLOR.branch} bold>{`⎇ ${s.branch === '(detached)' ? '分離 HEAD' : s.branch || '(未命名)'}`}</Text>
          <Text dimColor>{s.upstream === null ? '  沒有上游分支' : `  → ${s.upstream}`}</Text>
        </Text>,
      ),
      s.upstream === null
        ? text(kit, '尚未設定 upstream，push 前需要 git push -u', { dim: true })
        : line(
            kit,
            <Text wrap="truncate-end">
              {s.ahead === 0 && s.behind === 0 ? <Text color="success">✓ 與遠端同步</Text> : null}
              {s.ahead > 0 ? <Text color="suggestion">{`↑ 領先 ${s.ahead} 個提交  `}</Text> : null}
              {s.behind > 0 ? <Text color="warning">{`↓ 落後 ${s.behind} 個提交`}</Text> : null}
            </Text>,
          ),
      latest === undefined
        ? text(kit, '還沒有任何提交', { dim: true })
        : line(
            kit,
            <Box flexGrow={1}>
              <Text dimColor>{`最新 ${latest.hash} `}</Text>
              <Box flexGrow={1} overflow="hidden"><Text wrap="truncate-end">{latest.subject}</Text></Box>
              <Text dimColor>{` ${ago(latest.time, now)}`}</Text>
            </Box>,
          ),
      line(
        kit,
        <Text wrap="truncate-end">
          <Text color={stagedFiles.length > 0 ? 'success' : undefined} dimColor={stagedFiles.length === 0}>{`暫存 ${stagedFiles.length}`}</Text>
          <Text dimColor> · </Text>
          <Text color={unstagedCount > 0 ? 'warning' : undefined} dimColor={unstagedCount === 0}>{`未暫存 ${unstagedCount}`}</Text>
          <Text dimColor>{` · 未追蹤 ${untracked}`}</Text>
          {conflicts > 0 ? <Text color="error">{` · 衝突 ${conflicts}`}</Text> : null}
          <Text dimColor>{` · stash ${view.stashes}`}</Text>
        </Text>,
      ),
    ]

    // ── 區塊二：工作區變更（已暫存在前） ──
    const fileRow = (f: (typeof s.files)[number], counts: { added: number; removed: number } | undefined): RenderChildren => {
      const letter = letterOf(f)
      return line(
        kit,
        <Box flexGrow={1}>
          <Text color={LETTER_COLOR[letter]} dimColor={letter === '?'} bold>{`${letter} `}</Text>
          <Box flexGrow={1} overflow="hidden"><Text dimColor={letter === '?'} wrap="truncate-end">{f.path}</Text></Box>
          {counts === undefined ? <Text dimColor>{` ${STATUS_NAMES[letter] ?? ''}`}</Text> : <Text> </Text>}
          {counts === undefined ? null : diff(kit, counts.added, counts.removed)}
        </Box>,
      )
    }
    const changeLines: RenderChildren[] = [
      ...(stagedFiles.length === 0 ? [] : [rule(kit, `已暫存 ${stagedFiles.length}`, 'success'), ...stagedFiles.map(f => fileRow(f, view.staged[f.path]))]),
      ...(otherFiles.length === 0 ? [] : [rule(kit, `未暫存 ${otherFiles.length}`, GIT_COLOR.changes), ...otherFiles.map(f => fileRow(f, view.unstaged[f.path]))]),
    ]
    const changeFit = fit(changeLines, changeRows - SECTION_CHROME)

    // ── 區塊三：最近提交 ──
    const commitFit = fit(
      view.commits.map(c =>
        line(
          kit,
          <Box flexGrow={1}>
            <Text color={GIT_COLOR.commits}>{`${c.hash} `}</Text>
            <Box flexGrow={1} overflow="hidden"><Text wrap="truncate-end">{c.subject}</Text></Box>
            <Text dimColor>{` ${clip(c.author, 10)} · ${ago(c.time, now)}`}</Text>
          </Box>,
        ),
      ),
      commitRows - SECTION_CHROME,
    )

    return (
      <Box flexDirection="column">
        {section(kit, { color: GIT_COLOR.branch, title: '◆ 分支', height: branchRows, right: controls }, branchLines)}
        {section(
          kit,
          {
            color: GIT_COLOR.changes,
            title: '◆ 工作區變更',
            height: changeRows,
            right: s.files.length === 0 ? undefined : (
              <Text>
                <Text dimColor>{`${s.files.length} 檔 `}</Text>
                {diff(kit, totals.added, totals.removed)}
              </Text>
            ),
          },
          s.files.length === 0 ? [text(kit, '✓ 工作區乾淨，沒有未提交的變更', { color: 'success' })] : [...changeFit.shown, ...more(kit, changeFit.more, '列')],
        )}
        {section(
          kit,
          {
            color: GIT_COLOR.commits,
            title: '◆ 最近提交',
            height: commitRows,
            right: view.commits.length === 0 ? undefined : <Text dimColor>{`最近 ${view.commits.length} 筆`}</Text>,
          },
          view.commits.length === 0 ? [text(kit, '還沒有任何提交', { dim: true })] : [...commitFit.shown, ...more(kit, commitFit.more, '筆')],
        )}
      </Box>
    )
  })
}
