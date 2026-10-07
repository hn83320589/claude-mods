import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, SessionMessage, Timer } from 'claude-code'

import type { ContextBreakdown, ReplayCursor, Running, Task, Usage } from '../types'
import { countPatch, groupEdits, isUntested, recordEdit } from './blast'
import { ACCENT, barOf, compact, levelColor, limitName, resetIn } from './format'
import { fit, pick, SECTION_CHROME, share, splitRows } from './layout'
import { COMPACT_INSTRUCTIONS, COMPACT_THRESHOLD, isInside, NOTES_DIR, NOTES_GITIGNORE, notesFileName, notesMarkdown } from './notes'
import { addStep, firstLine, resolveCursor, startTurn, windowAround } from './replay'
import { duration, ratio, recordCache, recordTool, statusName, summarizeTools, visibleAgents } from './stats'
import { applyTaskTool, runningLabel } from './tasks'
import { clip } from './text'
import { diff, gauge, LABEL_WIDTH, labeled, line, more, rule, section, text } from './ui'
import { burnRate, projectLimit, sparkline, turnsUntil, weatherOf } from './weather'

const PANE = 'session-stats'
const TITLE = '工作階段狀態'
const TASK_TOOLS = ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList']
const EDIT_TOOLS = ['Edit', 'Write']
const HISTORY_SIZE = 20
const TICK_MS = 15_000
const TASK_ORDER: Record<Task['status'], number> = { in_progress: 0, pending: 1, completed: 2 }

const isOpen = atom({ plugin: 'session-stats', key: 'isOpen' } as const, false)
const toolCalls = atom({ plugin: 'session-stats', key: 'toolCalls' } as const, 0)
const usage = atom({ plugin: 'session-stats', key: 'usage' } as const, null)
const tasks = atom({ plugin: 'session-stats', key: 'tasks' } as const, [])
const running = atom({ plugin: 'session-stats', key: 'running' } as const, [])
const context = atom({ plugin: 'session-stats', key: 'context' } as const, null)
const history = atom({ plugin: 'session-stats', key: 'history' } as const, [])
const edits = atom({ plugin: 'session-stats', key: 'edits' } as const, [])
const root = atom({ plugin: 'session-stats', key: 'root' } as const, '')
const replay = atom({ plugin: 'session-stats', key: 'replay' } as const, [])
const cursor = atom({ plugin: 'session-stats', key: 'cursor' } as const, null)
const toolStats = atom({ plugin: 'session-stats', key: 'toolStats' } as const, [])
const cache = atom({ plugin: 'session-stats', key: 'cache' } as const, { read: 0, creation: 0, input: 0, last: null })
const agents = atom({ plugin: 'session-stats', key: 'agents' } as const, [])
const tick = atom({ plugin: 'session-stats', key: 'tick' } as const, 0)

// ── 資料更新 ──────────────────────────────────────────────

// pane 關著的時候不去讀用量，省掉沒人看的工作。
// breakdown 用 'summary'：本地估算，不會多送 token-count 請求。
const refresh = async ($: EngineInterface, withBreakdown: boolean): Promise<void> => {
  if (!(await read($, isOpen))) return
  const now = await $.session.usage(withBreakdown ? { breakdown: 'summary' } : undefined)
  const next: Usage = {
    model: await $.session.model(),
    startedAt: now.startedAt,
    turns: await $.session.turns(),
    percent: now.context.percent ?? null,
    tokens: now.context.tokens ?? null,
    window: now.context.window,
    costUsd: now.cost?.usd ?? null,
    rateLimits: now.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt ?? null })),
  }
  await update($, usage, () => next)

  const list = await $.agent.list()
  await update($, agents, () => list.map(a => ({ id: a.id, type: a.type, description: a.description, status: a.status })))

  const b = now.context.breakdown
  if (b !== undefined) {
    // 只列真正占用的內容；剩餘空間（free）與 auto-compact 保留區（buffer）不算
    const rows = b.categories
      .filter(c => c.kind === 'used' && c.tokens > 0)
      .map(c => ({ name: c.name, tokens: c.tokens }))
      .sort((x, y) => y.tokens - x.tokens)
    const buffer = b.categories.filter(c => c.kind === 'buffer').reduce((n, c) => n + c.tokens, 0)
    const breakdown: ContextBreakdown = {
      rows,
      totalTokens: b.totalTokens,
      maxTokens: b.rawMaxTokens,
      percentage: b.percentage,
      compactAt: buffer > 0 ? b.rawMaxTokens - buffer : null,
    }
    await update($, context, () => breakdown)
  }
}

// Session 計時與 subagent 狀態要隨時間更新；只在 pane 開著時跑。
// 模組重新載入時這個變數會歸零，舊的計時器由 engine 隨舊模組一起清掉。
let timer: Timer | null = null

// 計時器在背景跑，沒有人 await 它：錯誤寫進 debug log，不讓它變成沒人處理的 rejection
const onTick = async ($: EngineInterface): Promise<void> => {
  try {
    await refresh($, false)
    await update($, tick, n => n + 1)
  } catch (err) {
    $.ui.log(`計時更新失敗：${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
  }
}

// 手動重新整理：讀取失敗或停在「讀取中」時用。開關可能被重置（例如 /clear 之後），一併設回並恢復計時更新。
const refreshNow = async ($: EngineInterface): Promise<void> => {
  await update($, isOpen, () => true)
  await refresh($, true)
  timer ??= $.clock.every(TICK_MS, () => void onTick($))
}

const open = async ($: EngineInterface): Promise<void> => {
  await update($, isOpen, () => true)
  await refresh($, true)
  await $.ui.open({ id: PANE, title: TITLE })
  timer ??= $.clock.every(TICK_MS, () => void onTick($))
}

// /clear 或新的工作階段不會再觸發 session.start，狀態卻會重置：pane 還開著，isOpen 與資料都回到初始值，
// 之後的更新全被當成「pane 關著」而跳過。繪製時發現這種情形，就安排一次開啟流程補回來。
// 繪製期間不能寫狀態，所以交給 clock.after 在繪製之後執行；失敗時隔一段時間才再試，避免每次重繪都重試。
const HEAL_RETRY_MS = 5_000
let healing = false
let lastHealAt = Number.NEGATIVE_INFINITY

const scheduleHeal = async ($: EngineInterface): Promise<void> => {
  const now = await $.clock.now()
  if (healing || now - lastHealAt < HEAL_RETRY_MS) return
  healing = true
  lastHealAt = now
  $.clock.after(0, () => {
    void (async () => {
      try {
        await update($, isOpen, () => true)
        await refresh($, true)
        timer ??= $.clock.every(TICK_MS, () => void onTick($))
      } catch (err) {
        $.ui.log(`pane 資料補讀失敗：${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
      } finally {
        healing = false
      }
    })()
  })
}

// ── Context 自動處理 ──────────────────────────────────────

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))
const slashed = (path: string): string => path.replaceAll(String.fromCharCode(92), '/')

// 預先壓縮進行中時不重複觸發（模組重新載入時歸零，最多多觸發一次，引擎會擋下重疊的壓縮）
let compacting = false

/**
 * 確認摘要資料夾在專案之內：別人的 repo 可以把 .claude 或 session-notes 做成符號連結，
 * 指向專案外（例如開機自動執行的資料夾），讓存檔寫到那裡。路徑上已存在的每一層都必須是
 * 一般資料夾、不是連結，且實際位置在專案根目錄之內；不符合就不存檔。
 */
const assertNotesDirSafe = async ($: EngineInterface, root: string): Promise<void> => {
  const rootReal = (await $.fs.stat(root, { resolve: true })).realPath ?? root
  for (const path of [`${root}/.claude`, `${root}/${NOTES_DIR}`]) {
    let stat: Awaited<ReturnType<EngineInterface['fs']['stat']>>
    try {
      stat = await $.fs.stat(path, { resolve: true })
    } catch {
      return // 還不存在：之後由 fs.write 在專案內建立
    }
    if (stat.isLink || stat.kind !== 'dir' || stat.realPath === undefined || !isInside(stat.realPath, rootReal)) {
      throw new Error(`${path} 不是專案內的一般資料夾（可能是符號連結），略過存檔`)
    }
  }
}

/** 把壓縮產生的摘要存到專案的 .claude/session-notes/，資料夾自帶 .gitignore 不會被提交。 */
const saveNotes = async (
  $: EngineInterface,
  messages: readonly SessionMessage[],
  meta: { trigger: string; percent: number | null },
): Promise<string> => {
  const root = slashed(await $.session.root())
  await assertNotesDirSafe($, root)
  const dir = `${root}/${NOTES_DIR}`
  const ignore = `${dir}/.gitignore`
  if (!(await $.fs.exists(ignore))) await $.fs.write(ignore, NOTES_GITIGNORE)
  const existing = (await $.fs.exists(dir)) ? (await $.fs.list(dir)).map(e => e.name) : []
  const when = new Date(await $.clock.now())
  const file = `${dir}/${notesFileName(when, existing)}`
  await $.fs.write(file, notesMarkdown(messages, { when, ...meta }))
  return file
}

/** 回合結束後 context 達到門檻就先壓縮：不等引擎在工具執行到一半時才自動壓縮。 */
const compactIfNeeded = async ($: EngineInterface): Promise<void> => {
  const percent = (await $.session.usage()).context.percent ?? null
  if (percent === null || percent < COMPACT_THRESHOLD || compacting) return
  compacting = true
  // 回合進行中不能壓縮：排到這個事件處理完之後
  $.clock.after(0, () => {
    void (async () => {
      try {
        // 自己發起的壓縮不會經過自己的 session.compact hook，所以指示與存檔在這裡處理
        const result = await $.session.compact({ instructions: COMPACT_INSTRUCTIONS })
        if (result.skip !== undefined) return
        const file = await saveNotes($, result.messages, { trigger: 'plugin', percent })
        $.ui.toast(`Context 已達 ${percent}%，已先壓縮；摘要存在 ${file.split('/').slice(-3).join('/')}`)
      } catch (err) {
        $.ui.log(`預先壓縮失敗：${errorText(err)}`, { to: 'debug' })
      } finally {
        compacting = false
      }
    })()
  })
}

// 換回合時從第一步開始看；換步驟時停在同一回合
const moveCursor = async ($: EngineInterface, dTurn: number, dStep: number): Promise<void> => {
  const turns = await read($, replay)
  const at = resolveCursor(turns, await read($, cursor))
  if (at === null) return
  const next: ReplayCursor = dTurn !== 0 ? { turn: at.turn + dTurn, step: 0 } : { turn: at.turn, step: at.step + dStep }
  await update($, cursor, () => resolveCursor(turns, next))
}

// ── Hooks ─────────────────────────────────────────────────

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'session-stats', description: `開啟或關閉「${TITLE}」pane` })
    const ran = await next(e)
    const dir = await $.session.root()
    await update($, root, () => dir)
    await open($)
    return ran
  })

  on('command.run', { command: 'session-stats' }, async $ => {
    if (await read($, isOpen)) {
      await $.ui.close({ id: PANE })
      return { text: `已關閉「${TITLE}」pane。` }
    }
    await open($)
    return { text: `已開啟「${TITLE}」pane。` }
  })

  // 不論是按鈕、/session-stats 還是使用者自己關掉 pane，都停止更新
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      await update($, isOpen, () => false)
      timer?.cancel()
      timer = null
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const id = String(await $.clock.now())
    await update($, replay, turns => startTurn(turns, id, e.text))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const item: Running = { id: e.tool_use_id, tool: e.tool, label: runningLabel(e.tool, e) }
    await update($, running, list => [...list, item])
    const startedAt = await $.clock.now()

    const ran = await next(e)

    const ms = (await $.clock.now()) - startedAt
    const ok = ran.deny === undefined && ran.isError !== true
    await update($, running, list => list.filter(one => one.id !== item.id))
    await update($, toolCalls, n => n + 1)
    await update($, toolStats, stats => recordTool(stats, e.tool, ms, ok))
    await update($, replay, turns =>
      addStep(turns, { id: item.id, tool: item.tool, label: item.label, ms, ok, summary: ran.deny ?? firstLine(ran.text ?? '') }),
    )
    if (ok && TASK_TOOLS.includes(e.tool)) {
      await update($, tasks, list => applyTaskTool(list, e.tool, e, ran.result))
    }
    if (ok && EDIT_TOOLS.includes(e.tool) && typeof e.file_path === 'string') {
      const path = e.file_path
      const { added, removed } = countPatch((ran.result as { structuredPatch?: unknown } | undefined)?.structuredPatch)
      // mod 重新載入或測試時 session.start 可能還沒跑過，root 為空就當場查
      const dir = (await read($, root)) || (await $.session.root())
      await update($, edits, list => recordEdit(list, path, dir, added, removed))
    }
    await refresh($, false)
    return ran
  })

  // 回合結束：記 context 走勢與 cache 命中（不論 pane 開關，plain usage 不花成本），再重算明細
  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined) {
      const tokens = (await $.session.usage()).context.tokens
      if (tokens !== undefined) await update($, history, list => [...list, tokens].slice(-HISTORY_SIZE))
      await update($, cache, c => recordCache(c, e.usage))
      try {
        await compactIfNeeded($)
      } catch (err) {
        $.ui.log(`context 用量檢查失敗：${errorText(err)}`, { to: 'debug' })
      }
    }
    await refresh($, true)
    return ran
  })

  // 所有壓縮（引擎自動、/compact、預先計算）都加上要保留的重點；完成的壓縮把結果存到專案
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const instructions = [e.instructions, COMPACT_INSTRUCTIONS].filter(text => text !== undefined && text !== '').join(String.fromCharCode(10).repeat(2))
    const result = await next({ ...e, instructions })
    // precompute 是提前算好、之後才套用的摘要，套用時（auto）才存
    if (result.skip === undefined && e.trigger !== 'precompute') {
      try {
        await saveNotes($, result.messages, { trigger: e.trigger, percent: null })
      } catch (err) {
        $.ui.log(`工作階段摘要存檔失敗：${errorText(err)}`, { to: 'debug' })
      }
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e)
    const { Box, Button, Text } = kit
    const calls = await read($, toolCalls)
    const u = await read($, usage)
    const taskList = await read($, tasks)
    const inFlight = await read($, running)
    const ctx = await read($, context)
    const trend = await read($, history)
    const changed = await read($, edits)
    const turns = await read($, replay)
    const pinned = await read($, cursor)
    const stats = await read($, toolStats)
    const cacheStat = await read($, cache)
    const agentRows = visibleAgents(await read($, agents))
    await read($, tick)
    if (u === null || !(await read($, isOpen))) await scheduleHeal($)
    const now = await $.clock.now()

    const [usageRows = 4, taskRows = 4, contextRows = 4] = splitRows(Math.max(12, e.props.scroll.bodyRows), 3)
    const inner = Math.max(24, e.props.bodyColumns - 4)
    const barWidth = Math.max(6, inner - LABEL_WIDTH - 14)

    // ── 區塊一：用量與預報 ──
    const burn = burnRate(trend)
    const currentTokens = u?.tokens ?? trend[trend.length - 1] ?? null
    const compactAt = ctx?.compactAt ?? ctx?.maxTokens ?? null
    const turnsLeft = currentTokens !== null && compactAt !== null ? turnsUntil(currentTokens, compactAt, burn) : null
    const forecasts = (u?.rateLimits ?? []).map(r => ({ limit: r, projected: projectLimit(r, now) }))
    const worst = Math.max(u?.percent ?? 0, ...forecasts.map(f => f.projected ?? f.limit.percentUsed))
    const weather = weatherOf(worst)
    const cacheTotal = ratio(cacheStat.read, cacheStat.creation, cacheStat.input)
    const elapsed = u === null ? 0 : now - u.startedAt
    const perTurn = u !== null && u.turns > 0 ? elapsed / u.turns : null

    const usageLines = pick<RenderChildren>(
      u === null
        ? [{ item: text(kit, '讀取中…', { dim: true }), priority: 10 }]
        : [
            {
              item: labeled(
                kit,
                'Session',
                <Text wrap="truncate-end">
                  <Text>{duration(elapsed)}</Text>
                  <Text dimColor>{` · ${u.turns} 回合${perTurn === null ? '' : ` · ${duration(perTurn)}/回合`}${u.costUsd === null ? '' : ` · $${u.costUsd.toFixed(2)}`}`}</Text>
                </Text>,
              ),
              priority: 6,
            },
            {
              item:
                u.percent === null
                  ? labeled(kit, 'Context', <Text dimColor wrap="truncate-end">等待第一次 API 回應…</Text>)
                  : gauge(kit, 'Context', u.percent, barWidth, `${u.percent}%`, levelColor(u.percent)),
              priority: 10,
            },
            ...u.rateLimits.map(r => ({
              item: gauge(kit, limitName(r.kind), r.percentUsed, barWidth, `${r.percentUsed}% ↻${resetIn(r.resetsAt, now)}`, levelColor(r.percentUsed)),
              priority: 8,
            })),
            {
              // cache 命中率越高越好，顏色與用量相反
              item:
                cacheTotal === null
                  ? labeled(kit, 'Cache', <Text dimColor wrap="truncate-end">回合結束後計算</Text>)
                  : gauge(
                      kit,
                      'Cache',
                      cacheTotal,
                      barWidth,
                      `${cacheTotal}%${cacheStat.last === null ? '' : ` 本回${cacheStat.last}%`}`,
                      cacheTotal >= 70 ? 'success' : cacheTotal >= 40 ? 'warning' : 'error',
                    ),
              priority: 7,
            },
            {
              item: labeled(
                kit,
                'Tokens',
                <Text dimColor wrap="truncate-end">
                  {`${u.tokens === null ? '—' : compact(u.tokens)} / ${compact(u.window)} · 工具 ${calls} 次`}
                </Text>,
              ),
              priority: 3,
            },
            { item: rule(kit, '預報', ACCENT.usage, <Text color={weather.color}>{`${weather.icon} ${weather.label}`}</Text>), priority: 9 },
            {
              item: labeled(
                kit,
                '每回合',
                <Text wrap="truncate-end">
                  <Text>{burn === null ? '—' : `+${compact(Math.round(burn))}`}</Text>
                  <Text color={ACCENT.usage}>{`  ${sparkline(trend.slice(-Math.max(4, barWidth - 4)), u.window)}`}</Text>
                </Text>,
              ),
              priority: 9,
            },
            {
              item: labeled(
                kit,
                'Compact',
                <Text color={turnsLeft !== null && turnsLeft <= 3 ? 'warning' : undefined} dimColor={turnsLeft === null} wrap="truncate-end">
                  {turnsLeft === null ? '累積兩回合以上才能預估' : turnsLeft === 0 ? '下一回合就可能觸發' : `約 ${turnsLeft} 回合後觸發`}
                </Text>,
              ),
              priority: 7,
            },
            ...forecasts.map(f => ({
              item: labeled(
                kit,
                limitName(f.limit.kind),
                <Text color={f.projected === null ? undefined : levelColor(f.projected)} dimColor={f.projected === null} wrap="truncate-end">
                  {f.projected === null ? '視窗剛開始，資料不足' : `重置前約用到 ${f.projected}%`}
                </Text>,
              ),
              priority: 5,
            })),
          ],
      usageRows - SECTION_CHROME,
    )

    // ── 區塊二：任務與執行紀錄 ──
    // 背景 subagent 已有自己的列，就不再重複列出執行中的 Agent 工具呼叫
    const runningRows = inFlight.filter(r => !(r.tool === 'Agent' && agentRows.length > 0))
    const taskLines: RenderChildren[] = [
      ...agentRows.map(a =>
        line(
          kit,
          <Text color={a.status === 'failed' ? 'error' : ACCENT.tasks} wrap="truncate-end">
            {`⚙ ${a.type} · ${a.description} · ${statusName(a.status)}`}
          </Text>,
        ),
      ),
      ...runningRows.map(r => text(kit, `▶ ${r.tool} ${r.label}`, { color: 'warning' })),
      ...[...taskList]
        .sort((a, b) => TASK_ORDER[a.status] - TASK_ORDER[b.status])
        .map(t =>
          text(kit, `${t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '◐' : '○'} ${t.subject}`, {
            color: t.status === 'in_progress' ? ACCENT.tasks : t.status === 'completed' ? 'success' : undefined,
            dim: t.status !== 'in_progress',
          }),
        ),
    ]
    // 下段最少要有：執行紀錄分隔線、工具排行、回放控制、prompt、一個步驟
    const taskSplit = share(taskRows - SECTION_CHROME, Math.max(1, taskLines.length), 0.35, turns.length === 0 ? 3 : 5)
    const taskFit = fit(taskLines, taskSplit.upper)
    const doneCount = taskList.filter(t => t.status === 'completed').length

    const tools = summarizeTools(stats)
    const at = resolveCursor(turns, pinned)
    const shownTurn = at === null ? undefined : turns[at.turn]
    const steps = shownTurn?.steps ?? []
    // 下段固定列：分隔線、工具排行、回放控制、prompt、輸出摘要
    const stepRoom = Math.max(1, taskSplit.lower - 5)
    const view = windowAround(steps.length, at?.step ?? 0, stepRoom)
    const selected = at === null ? undefined : steps[at.step]

    const replayRows: RenderChildren[] =
      shownTurn === undefined
        ? [text(kit, '還沒有回合紀錄', { dim: true })]
        : [
            line(
              kit,
              <Box columnGap={1}>
                <Text color={ACCENT.tasks}>{`回放 ${(at?.turn ?? 0) + 1}/${turns.length}`}</Text>
                <Button key="turn-prev" dimColor hotkey="p" onPress={() => moveCursor($, -1, 0)}>◀</Button>
                <Button key="turn-next" dimColor hotkey="n" onPress={() => moveCursor($, 1, 0)}>▶</Button>
                <Text dimColor>步驟</Text>
                <Button key="step-prev" dimColor hotkey="k" onPress={() => moveCursor($, 0, -1)}>▲</Button>
                <Button key="step-next" dimColor hotkey="j" onPress={() => moveCursor($, 0, 1)}>▼</Button>
                {pinned !== null && (
                  <Button key="follow" dimColor hotkey="f" onPress={() => update($, cursor, () => null)}>跟隨</Button>
                )}
              </Box>,
            ),
            text(kit, clip(`「${shownTurn.prompt}」`, inner), { italic: true }),
            ...(steps.length === 0
              ? [text(kit, '這一回合沒有工具呼叫', { dim: true })]
              : steps.slice(view.start, view.end).map((s, i) => {
                  const index = view.start + i
                  const isSelected = index === at?.step
                  const time = s.ms >= 1000 ? `${(s.ms / 1000).toFixed(1)}s` : `${s.ms}ms`
                  return line(
                    kit,
                    <Box flexGrow={1}>
                      <Text color={isSelected ? ACCENT.tasks : undefined} bold={isSelected}>{isSelected ? '▸' : ' '}</Text>
                      <Text dimColor>{`${String(index + 1).padStart(2)} `}</Text>
                      <Text color={s.ok ? 'success' : 'error'}>{s.ok ? '✓ ' : '✗ '}</Text>
                      <Box flexGrow={1} overflow="hidden">
                        <Text dimColor={!isSelected} wrap="truncate-end">{`${s.tool} ${s.label}`}</Text>
                      </Box>
                      <Text dimColor>{` ${time}`}</Text>
                    </Box>,
                  )
                })),
            ...(selected === undefined ? [] : [text(kit, clip(`└ ${selected.summary === '' ? '（沒有輸出）' : selected.summary}`, inner), { dim: true })]),
          ]

    // ── 區塊三：上下文與改動 ──
    const groups = groupEdits(changed)
    const maxGroup = Math.max(1, ...groups.map(g => g.added + g.removed))
    const totalAdded = changed.reduce((n, f) => n + f.added, 0)
    const totalRemoved = changed.reduce((n, f) => n + f.removed, 0)
    const groupBar = Math.max(4, Math.floor(barWidth / 2))
    const blastLines: RenderChildren[] = [
      ...(isUntested(changed) ? [text(kit, '⚠ 有改程式碼但沒動測試', { color: 'warning' })] : []),
      ...groups.flatMap(g => {
        const bar = barOf(((g.added + g.removed) / maxGroup) * 100, groupBar)
        return [
          line(
            kit,
            <Box flexGrow={1}>
              <Box flexGrow={1} overflow="hidden"><Text bold wrap="truncate-end">{g.name}</Text></Box>
              <Text color={ACCENT.context}>{` ${bar.full}`}</Text>
              <Text dimColor>{bar.rest}</Text>
              <Text dimColor>{` ${g.files.length} 檔 `}</Text>
              {diff(kit, g.added, g.removed)}
            </Box>,
          ),
          ...g.files.map(f =>
            line(
              kit,
              <Box flexGrow={1}>
                <Box flexGrow={1} overflow="hidden">
                  <Text dimColor wrap="truncate-end">{`  ${f.rel.split('/').pop() ?? f.rel}`}</Text>
                </Box>
                <Text> </Text>
                {diff(kit, f.added, f.removed)}
              </Box>,
            ),
          ),
        ]
      }),
    ]
    const ctxSplit = share(contextRows - SECTION_CHROME, Math.max(1, ctx?.rows.length ?? 1), 0.45, changed.length === 0 ? 2 : 3)
    const ctxFit = fit(ctx?.rows ?? [], ctxSplit.upper)
    const blastFit = fit(blastLines, Math.max(1, ctxSplit.lower - 1))

    return (
      <Box flexDirection="column">
        {section(
          kit,
          {
            color: ACCENT.usage,
            title: '◆ 用量與預報',
            height: usageRows,
            right: (
              <Box columnGap={1}>
                <Text dimColor wrap="truncate-end">{u === null ? '' : clip(u.model, Math.max(8, inner - 32))}</Text>
                <Button key="usage-refresh" dimColor hotkey="r" onPress={() => refreshNow($)}>重新整理</Button>
                <Button key="close" dimColor onPress={() => $.ui.close({ id: PANE })}>關閉</Button>
              </Box>
            ),
          },
          usageLines,
        )}

        {section(
          kit,
          {
            color: ACCENT.tasks,
            title: '◆ 任務與執行紀錄',
            height: taskRows,
            right: taskList.length > 0 ? <Text dimColor>{`${doneCount}/${taskList.length} 完成`}</Text> : undefined,
          },
          [
            ...(taskLines.length === 0 ? [text(kit, '目前沒有執行中的工作', { dim: true })] : [...taskFit.shown, ...more(kit, taskFit.more, '項')]),
            rule(
              kit,
              '執行紀錄',
              ACCENT.tasks,
              tools.total === 0 ? undefined : (
                <Text dimColor>
                  {`${tools.total} 次`}
                  {tools.failed > 0 ? <Text color="error">{` ✗${tools.failed}`}</Text> : null}
                  {tools.slowest === null ? '' : ` · 最慢 ${tools.slowest.tool} ${duration(tools.slowest.maxMs)}`}
                </Text>
              ),
            ),
            tools.total === 0
              ? text(kit, '還沒有工具呼叫', { dim: true })
              : line(
                  kit,
                  <Text wrap="truncate-end">
                    {tools.top.slice(0, 6).map((t, i) => (
                      <Text>
                        <Text>{`${i === 0 ? '' : '  '}${t.tool} `}</Text>
                        <Text color={ACCENT.tasks} bold>{String(t.count)}</Text>
                        {t.failed > 0 ? <Text color="error">{`✗${t.failed}`}</Text> : null}
                      </Text>
                    ))}
                  </Text>,
                ),
            ...replayRows,
          ],
        )}

        {section(
          kit,
          {
            color: ACCENT.context,
            title: '◆ 上下文與改動',
            height: contextRows,
            right: ctx !== null ? <Text dimColor>{`${compact(ctx.totalTokens)} / ${compact(ctx.maxTokens)} · ${ctx.percentage}%`}</Text> : undefined,
          },
          [
            ...(ctx === null
              ? [text(kit, '回合結束後顯示', { dim: true })]
              : [
                  ...ctxFit.shown.map(row => {
                    const bar = barOf(ctx.maxTokens > 0 ? (row.tokens / ctx.maxTokens) * 100 : 0, barWidth)
                    return line(
                      kit,
                      <Box flexGrow={1}>
                        <Box flexGrow={1} overflow="hidden"><Text wrap="truncate-end">{row.name}</Text></Box>
                        <Text color={ACCENT.context}>{` ${bar.full}`}</Text>
                        <Text dimColor>{bar.rest}</Text>
                        <Text dimColor>{` ${compact(row.tokens).padStart(6)}`}</Text>
                      </Box>,
                    )
                  }),
                  ...more(kit, ctxFit.more, '類'),
                ]),
            rule(
              kit,
              '改動範圍',
              ACCENT.context,
              changed.length === 0 ? undefined : (
                <Text>
                  <Text dimColor>{`${changed.length} 檔 `}</Text>
                  {diff(kit, totalAdded, totalRemoved)}
                </Text>
              ),
            ),
            ...(changed.length === 0 ? [text(kit, '本 session 還沒有改動檔案', { dim: true })] : [...blastFit.shown, ...more(kit, blastFit.more, '列')]),
          ],
        )}
      </Box>
    )
  })
}
