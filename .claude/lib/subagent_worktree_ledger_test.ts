import { assert, assertEquals, assertExists } from '@std/assert'
import { ensureDir } from '@std/fs'
import { fromFileUrl, join } from '@std/path'

const DENO_CONFIG_PATH = fromFileUrl(new URL('../../deno.json', import.meta.url))

async function loadLedgerModule() {
  return await import('./subagent_worktree_ledger.ts')
}

function atMinuteOffset(offset: number) {
  return new Date(Date.UTC(2026, 3, 12, 10, offset, 0)).toISOString()
}

Deno.test('ledger: WorktreeCreate 与 SubagentStop 会更新同一条记录并保留顶层两条事件', async () => {
  const { SUBAGENT_WORKTREE_LEDGER_RELATIVE_PATH, applyLedgerEvent, createEmptyLedger } =
    await loadLedgerModule()

  assertEquals(SUBAGENT_WORKTREE_LEDGER_RELATIVE_PATH, '.claude/state/subagent-worktrees.json')

  const worktreePath = '/tmp/project/.claude/worktrees/agent-1'
  const rootWorktreePath = '/tmp/project/.claude/worktrees/root-agent'
  const createdAt = '2026-04-12T10:00:00.000Z'
  const stoppedAt = '2026-04-12T10:05:00.000Z'

  const createdLedger = applyLedgerEvent(createEmptyLedger(), {
    hookEventName: 'WorktreeCreate',
    status: 'created',
    at: createdAt,
    worktreePath,
    rootSessionId: 'root-session-1',
    rootWorktreePath,
    agentId: 'agent-1',
    agentSessionId: 'agent-session-1',
    cwd: worktreePath,
    sessionId: 'session-1',
    branch: 'feature/ledger',
  })

  const updatedLedger = applyLedgerEvent(createdLedger, {
    hookEventName: 'SubagentStop',
    status: 'stopped',
    at: stoppedAt,
    worktreePath,
    rootSessionId: 'root-session-1',
    rootWorktreePath,
    agentId: 'agent-1',
    agentSessionId: 'agent-session-1',
    cwd: worktreePath,
    sessionId: 'session-1',
    branch: 'feature/ledger',
    cleanupReason: 'finished',
  })

  assertEquals(updatedLedger.records.length, 1)

  const [record] = updatedLedger.records
  assertExists(record)
  assertEquals(record.status, 'stopped')
  assertEquals(record.createdAt, createdAt)
  assertEquals(record.updatedAt, stoppedAt)
  assertEquals(record.lastSeenCwd, worktreePath)
  assertEquals(record.rootSessionId, 'root-session-1')
  assertEquals(record.rootWorktreePath, rootWorktreePath)
  assertEquals(record.agentId, 'agent-1')
  assertEquals(record.agentSessionId, 'agent-session-1')
  assertEquals(record.cleanupReason, 'finished')
  assertEquals(record.sessionId, 'session-1')
  assertEquals(record.branch, 'feature/ledger')
  assertEquals(updatedLedger.events.length, 2)
  assertEquals(
    updatedLedger.events.map((event: { hookEventName: string }) => event.hookEventName),
    ['WorktreeCreate', 'SubagentStop'],
  )
  assertEquals(
    updatedLedger.events.map((event) => ({
      rootSessionId: event.rootSessionId,
      rootWorktreePath: event.rootWorktreePath,
      agentId: event.agentId,
      agentSessionId: event.agentSessionId,
    })),
    [
      {
        rootSessionId: 'root-session-1',
        rootWorktreePath,
        agentId: 'agent-1',
        agentSessionId: 'agent-session-1',
      },
      {
        rootSessionId: 'root-session-1',
        rootWorktreePath,
        agentId: 'agent-1',
        agentSessionId: 'agent-session-1',
      },
    ],
  )
})

Deno.test('ledger: 终态记录会触发 deleteLedgerFile 并删除账本文件', async () => {
  const { applyLedgerEvent, createEmptyLedger, readLedger, summarizeCleanupState, writeLedger } =
    await loadLedgerModule()

  const repoRoot = await Deno.makeTempDir()
  const ledgerPath = join(repoRoot, '.claude/state/subagent-worktrees.json')

  const ledger = applyLedgerEvent(createEmptyLedger(), {
    hookEventName: 'WorktreeCleanupDone',
    status: 'cleanup_done',
    at: '2026-04-12T10:10:00.000Z',
    worktreePath: '/tmp/project/.claude/worktrees/agent-2',
    cwd: '/tmp/project/.claude/worktrees/agent-2',
  })

  assertEquals(ledger.records[0]?.rootSessionId, 'unknown-root-session')
  assertEquals(ledger.records[0]?.rootWorktreePath, '/tmp/project/.claude/worktrees/agent-2')
  assertEquals(ledger.records[0]?.agentId, 'agent-2')
  assertEquals(ledger.records[0]?.agentSessionId, 'unknown-agent-session')
  assertEquals(ledger.events[0]?.rootSessionId, 'unknown-root-session')
  assertEquals(ledger.events[0]?.rootWorktreePath, '/tmp/project/.claude/worktrees/agent-2')
  assertEquals(ledger.events[0]?.agentId, 'agent-2')
  assertEquals(ledger.events[0]?.agentSessionId, 'unknown-agent-session')
  assertEquals(summarizeCleanupState(ledger).deleteLedgerFile, true)

  await writeLedger(repoRoot, ledger)

  const statResult = await Deno.stat(ledgerPath).catch(() => undefined)
  assertEquals(statResult, undefined)

  const reloaded = await readLedger(repoRoot)
  assertEquals(reloaded.records.length, 0)
  assertEquals(reloaded.events.length, 0)
})

Deno.test(
  'ledger: extractLedgerEventFromHookInput 在缺少 worktree_path 时回退到 cwd 并写入上下文字段',
  async () => {
    const { extractLedgerEventFromHookInput } = await loadLedgerModule()

    const event = extractLedgerEventFromHookInput(
      {
        hook_event_name: 'SubagentStop',
        session_id: 'session-2',
        cwd: '/tmp/project/.claude/worktrees/agent-3',
        branch: 'feature/cwd-fallback',
      },
      {
        rootSessionId: 'root-session-2',
        rootWorktreePath: '/tmp/project/.claude/worktrees/root-agent-3',
        timestamp: '2026-04-12T10:20:00.000Z',
      },
    )

    assertExists(event)
    assertEquals(event.worktreePath, '/tmp/project/.claude/worktrees/agent-3')
    assertEquals(event.cwd, '/tmp/project/.claude/worktrees/agent-3')
    assertEquals(event.rootSessionId, 'root-session-2')
    assertEquals(event.rootWorktreePath, '/tmp/project/.claude/worktrees/root-agent-3')
    assertEquals(event.agentId, 'agent-3')
    assertEquals(event.agentSessionId, 'session-2')
    assertEquals(event.sessionId, 'session-2')
    assertEquals(event.branch, 'feature/cwd-fallback')
    assertEquals(event.hookEventName, 'SubagentStop')
    assertEquals(event.status, 'stopped')
    assertEquals(event.at, '2026-04-12T10:20:00.000Z')
  },
)

Deno.test('ledger: extractLedgerEventFromHookInput 在上下文缺失时仍补齐最小归属字段', async () => {
  const { extractLedgerEventFromHookInput } = await loadLedgerModule()

  const event = extractLedgerEventFromHookInput({
    hook_event_name: 'SubagentStart',
    session_id: 'session-3',
    worktree_path: '/tmp/project/.claude/worktrees/agent-4',
  })

  assertExists(event)
  assertEquals(event.status, 'active')
  assertEquals(event.rootSessionId, 'unknown-root-session')
  assertEquals(event.rootWorktreePath, '/tmp/project/.claude/worktrees/agent-4')
  assertEquals(event.agentId, 'agent-4')
  assertEquals(event.agentSessionId, 'session-3')
})

Deno.test(
  'ledger: extractLedgerEventFromHookInput 支持 WorktreeRemove 并从 hookSpecificOutput 读取路径',
  async () => {
    const { extractLedgerEventFromHookInput } = await loadLedgerModule()

    const event = extractLedgerEventFromHookInput(
      {
        hook_event_name: 'WorktreeRemove',
        session_id: 'session-4',
        cwd: '/tmp/project',
        hookSpecificOutput: {
          worktreePath: '/tmp/project/.claude/worktrees/agent-5',
        },
      },
      {
        rootSessionId: 'root-session-4',
        rootWorktreePath: '/tmp/project/.claude/worktrees/root-agent-5',
        timestamp: '2026-04-12T10:25:00.000Z',
      },
    )

    assertExists(event)
    assertEquals(event.status, 'removed')
    assertEquals(event.worktreePath, '/tmp/project/.claude/worktrees/agent-5')
    assertEquals(event.rootSessionId, 'root-session-4')
    assertEquals(event.rootWorktreePath, '/tmp/project/.claude/worktrees/root-agent-5')
    assertEquals(event.agentId, 'agent-5')
    assertEquals(event.agentSessionId, 'session-4')
    assertEquals(event.at, '2026-04-12T10:25:00.000Z')
  },
)

Deno.test('ledger: extractLedgerEventFromHookInput 会过滤非 worktree 路径', async () => {
  const { extractLedgerEventFromHookInput } = await loadLedgerModule()

  const event = extractLedgerEventFromHookInput({
    hook_event_name: 'WorktreeCreate',
    cwd: '/tmp/project/runtime',
    worktree_path: '/tmp/project/runtime',
  })

  assertEquals(event, undefined)
})

Deno.test(
  'ledger: extractLedgerEventFromHookInput 遇到未知 hook 且无合法状态时返回 undefined',
  async () => {
    const { extractLedgerEventFromHookInput } = await loadLedgerModule()

    const event = extractLedgerEventFromHookInput({
      hook_event_name: 'UnknownHook',
      worktree_path: '/tmp/project/.claude/worktrees/agent-5',
    })

    assertEquals(event, undefined)
  },
)

Deno.test('ledger: 同路径终态记录在 WorktreeCreate 后会重置生命周期字段', async () => {
  const { applyLedgerEvent, createEmptyLedger } = await loadLedgerModule()

  const worktreePath = '/tmp/project/.claude/worktrees/agent-6'
  const reopenedAt = '2026-04-12T10:40:00.000Z'

  const closedLedger = applyLedgerEvent(createEmptyLedger(), {
    hookEventName: 'WorktreeCleanupDone',
    status: 'cleanup_done',
    at: '2026-04-12T10:30:00.000Z',
    worktreePath,
    rootSessionId: 'root-session-old',
    rootWorktreePath: '/tmp/project/.claude/worktrees/root-old',
    agentId: 'agent-old',
    agentSessionId: 'agent-session-old',
    cwd: worktreePath,
    sessionId: 'session-old',
    branch: 'feature/old',
    cleanupReason: 'cleanup-finished',
  })

  const reopenedLedger = applyLedgerEvent(closedLedger, {
    hookEventName: 'WorktreeCreate',
    status: 'created',
    at: reopenedAt,
    worktreePath,
    rootSessionId: 'root-session-new',
    rootWorktreePath: '/tmp/project/.claude/worktrees/root-new',
    agentId: 'agent-6',
    agentSessionId: 'agent-session-new',
    cwd: worktreePath,
    sessionId: 'session-new',
    branch: 'feature/new',
  })

  const [record] = reopenedLedger.records
  assertExists(record)
  assertEquals(record.status, 'created')
  assertEquals(record.createdAt, reopenedAt)
  assertEquals(record.updatedAt, reopenedAt)
  assertEquals(record.cleanupReason, undefined)
  assertEquals(record.rootSessionId, 'root-session-new')
  assertEquals(record.rootWorktreePath, '/tmp/project/.claude/worktrees/root-new')
  assertEquals(record.agentId, 'agent-6')
  assertEquals(record.agentSessionId, 'agent-session-new')
  assertEquals(record.sessionId, 'session-new')
  assertEquals(record.branch, 'feature/new')
})

Deno.test('ledger hook entrypoint: WorktreeCreate payload 会写入账本文件', async () => {
  const tempDir = await Deno.makeTempDir()
  try {
    const hooksDir = join(tempDir, '.claude', 'hooks')
    const libDir = join(tempDir, '.claude', 'lib')
    await ensureDir(hooksDir)
    await ensureDir(libDir)

    const ledgerScript = join(hooksDir, 'subagent-worktree-ledger.ts')
    await Deno.copyFile(
      fromFileUrl(new URL('../hooks/subagent-worktree-ledger.ts', import.meta.url)),
      ledgerScript,
    )
    await Deno.copyFile(
      fromFileUrl(new URL('./subagent_worktree_ledger.ts', import.meta.url)),
      join(libDir, 'subagent_worktree_ledger.ts'),
    )

    const command = new Deno.Command('deno', {
      args: [
        'run',
        '--config',
        DENO_CONFIG_PATH,
        '--allow-read',
        '--allow-write',
        '--allow-env',
        ledgerScript,
      ],
      cwd: tempDir,
      stdin: 'piped',
      stdout: 'piped',
      stderr: 'piped',
      env: {
        CLAUDE_SESSION_ID: 'root-session-hook',
      },
    })

    const child = command.spawn()
    const writer = child.stdin.getWriter()
    await writer.write(
      new TextEncoder().encode(
        JSON.stringify({
          hook_event_name: 'WorktreeCreate',
          cwd: '/tmp/project/.claude/worktrees/root-task',
          worktree_path: '/tmp/project/.claude/worktrees/agent-hook',
          session_id: 'agent-session-hook',
          branch: 'agent-hook',
        }),
      ),
    )
    await writer.close()

    const result = await child.output()
    assertEquals(result.code, 0)

    const stdout = new TextDecoder().decode(result.stdout).trim()
    assertEquals(stdout, '{"continue":true,"suppressOutput":true}')

    const { readLedger } = await loadLedgerModule()
    const ledger = await readLedger(tempDir)
    assertEquals(ledger.records.length, 1)
    assertEquals(ledger.records[0]?.status, 'created')
    assertEquals(ledger.records[0]?.rootSessionId, 'root-session-hook')
    assertEquals(ledger.records[0]?.rootWorktreePath, '/tmp/project/.claude/worktrees/root-task')
    assertEquals(ledger.records[0]?.agentSessionId, 'agent-session-hook')
    assertEquals(ledger.records[0]?.branch, 'agent-hook')
  } finally {
    await Deno.remove(tempDir, { recursive: true })
  }
})

Deno.test('ledger hook entrypoint: 无合法 worktreePath 时不写账本', async () => {
  const tempDir = await Deno.makeTempDir()
  try {
    const hooksDir = join(tempDir, '.claude', 'hooks')
    const libDir = join(tempDir, '.claude', 'lib')
    await ensureDir(hooksDir)
    await ensureDir(libDir)

    const ledgerScript = join(hooksDir, 'subagent-worktree-ledger.ts')
    await Deno.copyFile(
      fromFileUrl(new URL('../hooks/subagent-worktree-ledger.ts', import.meta.url)),
      ledgerScript,
    )
    await Deno.copyFile(
      fromFileUrl(new URL('./subagent_worktree_ledger.ts', import.meta.url)),
      join(libDir, 'subagent_worktree_ledger.ts'),
    )

    const command = new Deno.Command('deno', {
      args: [
        'run',
        '--config',
        DENO_CONFIG_PATH,
        '--allow-read',
        '--allow-write',
        '--allow-env',
        ledgerScript,
      ],
      cwd: tempDir,
      stdin: 'piped',
      stdout: 'piped',
      stderr: 'piped',
    })

    const child = command.spawn()
    const writer = child.stdin.getWriter()
    await writer.write(
      new TextEncoder().encode(
        JSON.stringify({
          hook_event_name: 'SubagentStop',
          cwd: '/tmp/project/runtime',
          session_id: 'agent-session-hook',
        }),
      ),
    )
    await writer.close()

    const result = await child.output()
    assertEquals(result.code, 0)

    const { readLedger } = await loadLedgerModule()
    const ledger = await readLedger(tempDir)
    assertEquals(ledger.records.length, 0)
    assertEquals(ledger.events.length, 0)
  } finally {
    await Deno.remove(tempDir, { recursive: true })
  }
})

Deno.test('ledger settings: 已注册四个 lifecycle hooks', async () => {
  const settings = JSON.parse(
    await Deno.readTextFile(new URL('../settings.json', import.meta.url)),
  ) as {
    hooks?: Record<string, Array<{ hooks?: Array<{ type?: string; command?: string }> }>>
  }

  for (const hookEventName of [
    'WorktreeCreate',
    'WorktreeRemove',
    'SubagentStart',
    'SubagentStop',
  ]) {
    const entries = settings.hooks?.[hookEventName]
    assertExists(entries)
    assertEquals(entries.length, 1)
    assertEquals(entries[0]?.hooks?.[0]?.type, 'command')
    assertEquals(
      entries[0]?.hooks?.[0]?.command,
      'deno run --allow-read --allow-write --allow-env .claude/hooks/subagent-worktree-ledger.ts',
    )
  }
})

Deno.test('ledger gitignore: state 目录已忽略', async () => {
  const gitignore = await Deno.readTextFile(new URL('../../.gitignore', import.meta.url))
  assertEquals(gitignore.includes('.claude/state/'), true)
})

Deno.test('ledger: applyLedgerEvent 只保留最近 100 条顶层事件', async () => {
  const { applyLedgerEvent, createEmptyLedger } = await loadLedgerModule()

  const worktreePath = '/tmp/project/.claude/worktrees/agent-4'
  let ledger = createEmptyLedger()

  for (let index = 0; index < 105; index += 1) {
    ledger = applyLedgerEvent(ledger, {
      hookEventName: `Event${index}`,
      status: 'active',
      at: atMinuteOffset(index),
      worktreePath,
      cwd: worktreePath,
    })
  }

  const [record] = ledger.records
  assert(record !== undefined)
  assertEquals(record.createdAt, '2026-04-12T10:00:00.000Z')
  assertEquals(record.updatedAt, '2026-04-12T11:44:00.000Z')
  assertEquals(record.rootSessionId, 'unknown-root-session')
  assertEquals(record.rootWorktreePath, worktreePath)
  assertEquals(record.agentId, 'agent-4')
  assertEquals(record.agentSessionId, 'unknown-agent-session')
  assertEquals(ledger.events.length, 100)
  assertEquals(ledger.events[0].hookEventName, 'Event5')
  assertEquals(ledger.events[0].rootSessionId, 'unknown-root-session')
  assertEquals(ledger.events[0].rootWorktreePath, worktreePath)
  assertEquals(ledger.events[0].agentId, 'agent-4')
  assertEquals(ledger.events[0].agentSessionId, 'unknown-agent-session')
  assertEquals(ledger.events.at(-1)?.hookEventName, 'Event104')
})
