import { assertEquals } from '@std/assert'

import {
  buildLedgerContext,
  CONTINUE_RESPONSE,
  runSubagentWorktreeLedgerHook,
} from './subagent-worktree-ledger.ts'
import { readLedger } from '../lib/subagent_worktree_ledger.ts'

Deno.test(
  'subagent-worktree-ledger hook: WorktreeCreate 从当前 payload 补齐最小上下文并写入 ledger',
  async () => {
    const repoRoot = await Deno.makeTempDir()
    const worktreePath = '/tmp/project/.claude/worktrees/agent-hook-1'

    try {
      const response = await runSubagentWorktreeLedgerHook(
        {
          hook_event_name: 'WorktreeCreate',
          session_id: 'root-session-hook-1',
          cwd: worktreePath,
          branch: 'feature/hook-ledger',
        },
        { repoRoot },
      )

      assertEquals(response, CONTINUE_RESPONSE)

      const ledger = await readLedger(repoRoot)
      assertEquals(ledger.records.length, 1)
      assertEquals(ledger.events.length, 1)
      assertEquals(ledger.records[0]?.status, 'created')
      assertEquals(ledger.records[0]?.rootSessionId, 'root-session-hook-1')
      assertEquals(ledger.records[0]?.rootWorktreePath, worktreePath)
      assertEquals(ledger.records[0]?.agentSessionId, 'root-session-hook-1')
      assertEquals(ledger.records[0]?.branch, 'feature/hook-ledger')
      assertEquals(ledger.events[0]?.hookEventName, 'WorktreeCreate')
      assertEquals(ledger.events[0]?.worktreePath, worktreePath)
    } finally {
      await Deno.remove(repoRoot, { recursive: true })
    }
  },
)

Deno.test('subagent-worktree-ledger hook: 非法 payload 与写入失败都保持 fail-open', async () => {
  const invalidPayloadResponse = await runSubagentWorktreeLedgerHook({
    hook_event_name: 'UnknownHook',
    cwd: '/tmp/project/.claude/worktrees/agent-hook-2',
  })

  assertEquals(invalidPayloadResponse, CONTINUE_RESPONSE)

  const writeFailureResponse = await runSubagentWorktreeLedgerHook(
    {
      hook_event_name: 'SubagentStop',
      session_id: 'agent-session-hook-2',
      cwd: '/tmp/project/.claude/worktrees/agent-hook-2',
    },
    {
      repoRoot: '/proc/claude-hook-ledger-test',
    },
  )

  assertEquals(writeFailureResponse, CONTINUE_RESPONSE)
})

Deno.test(
  'subagent-worktree-ledger hook: buildLedgerContext 优先读取根上下文字段并保留 timestamp',
  () => {
    const context = buildLedgerContext({
      hook_event_name: 'SubagentStart',
      timestamp: '2026-04-12T04:20:00.000Z',
      root_session_id: 'root-session-hook-3',
      root_worktree_path: '/tmp/project/.claude/worktrees/root-hook-3',
      session_id: 'agent-session-hook-3',
      cwd: '/tmp/project/.claude/worktrees/agent-hook-3',
    })

    assertEquals(context, {
      rootSessionId: 'root-session-hook-3',
      rootWorktreePath: '/tmp/project/.claude/worktrees/root-hook-3',
      timestamp: '2026-04-12T04:20:00.000Z',
    })
  },
)

Deno.test(
  'subagent-worktree-ledger hook: WorktreeRemove 不应把非 worktree cwd 误当 rootWorktreePath',
  () => {
    const context = buildLedgerContext({
      hook_event_name: 'WorktreeRemove',
      session_id: 'agent-session-hook-4',
      cwd: '/tmp/project',
      hookSpecificOutput: {
        worktreePath: '/tmp/project/.claude/worktrees/agent-hook-4',
      },
    })

    assertEquals(context.rootSessionId, undefined)
    assertEquals(context.rootWorktreePath, undefined)
  },
)
