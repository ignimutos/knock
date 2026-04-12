import { assertEquals } from '@std/assert'

import {
  applyCleanupLedgerOutcome,
  buildChildCleanupOutcome,
  classifyChildCleanupPlan,
  type ChildCleanupCandidate,
} from './cleanup.ts'
import {
  createEmptyLedger,
  type SubagentWorktreeLedger,
} from '../../../lib/subagent_worktree_ledger.ts'

function createCandidate(overrides: Partial<ChildCleanupCandidate> = {}): ChildCleanupCandidate {
  return {
    rootSessionId: 'root-1',
    rootWorktreePath: '/repo/.claude/worktrees/root-task',
    agentId: 'agent-a',
    agentSessionId: 'session-a',
    worktreePath: '/repo/.claude/worktrees/agent-a',
    branch: 'agent-a-branch',
    status: 'stopped',
    createdAt: '2026-04-12T03:00:00.000Z',
    updatedAt: '2026-04-12T03:05:00.000Z',
    lastSeenCwd: '/repo/.claude/worktrees/agent-a',
    ...overrides,
  }
}

function createLedger(records: ChildCleanupCandidate[]): SubagentWorktreeLedger {
  return {
    ...createEmptyLedger(),
    records,
  }
}

Deno.test('classifyChildCleanupPlan: rootSessionId 优先，只选当前 root session 子代理', () => {
  const plan = classifyChildCleanupPlan({
    rootSessionId: 'root-1',
    rootWorktreePath: '/repo/.claude/worktrees/root-task',
    records: [
      createCandidate(),
      createCandidate({
        agentId: 'agent-fallback',
        agentSessionId: 'session-fallback',
        worktreePath: '/repo/.claude/worktrees/agent-fallback',
        rootSessionId: 'root-2',
      }),
      createCandidate({
        agentId: 'agent-other',
        agentSessionId: 'session-other',
        worktreePath: '/repo/.claude/worktrees/agent-other',
        rootSessionId: 'root-2',
        rootWorktreePath: '/repo/.claude/worktrees/other-task',
      }),
    ],
  })

  assertEquals(
    plan.candidates.map((record) => record.worktreePath),
    ['/repo/.claude/worktrees/agent-a'],
  )
})

Deno.test('classifyChildCleanupPlan: 缺少 rootSessionId 时回退 rootWorktreePath', () => {
  const plan = classifyChildCleanupPlan({
    rootSessionId: undefined,
    rootWorktreePath: '/repo/.claude/worktrees/root-task',
    records: [
      createCandidate(),
      createCandidate({
        agentId: 'agent-b',
        agentSessionId: 'session-b',
        worktreePath: '/repo/.claude/worktrees/agent-b',
        rootSessionId: 'root-2',
      }),
      createCandidate({
        agentId: 'agent-c',
        agentSessionId: 'session-c',
        worktreePath: '/repo/.claude/worktrees/agent-c',
        rootSessionId: 'root-3',
        rootWorktreePath: '/repo/.claude/worktrees/other-task',
      }),
    ],
  })

  assertEquals(
    plan.candidates.map((record) => record.worktreePath),
    ['/repo/.claude/worktrees/agent-a', '/repo/.claude/worktrees/agent-b'],
  )
})

Deno.test('buildChildCleanupOutcome: 应按 deleted / skipped / failed 分类输出', () => {
  const deleted = buildChildCleanupOutcome(createCandidate(), {
    kind: 'deleted',
  })
  const skipped = buildChildCleanupOutcome(
    createCandidate({ worktreePath: '/repo/.claude/worktrees/agent-b' }),
    {
      kind: 'skipped',
      reason: 'child_worktree_dirty',
      message: '子代理 worktree 有未提交改动',
      details: { status: 'M src/main.ts' },
    },
  )
  const failed = buildChildCleanupOutcome(
    createCandidate({ worktreePath: '/repo/.claude/worktrees/agent-c' }),
    {
      kind: 'failed',
      reason: 'child_worktree_remove_failed',
      message: 'git worktree remove 失败',
      details: { stderr: 'boom' },
    },
  )

  assertEquals(deleted, {
    status: 'deleted',
    worktreePath: '/repo/.claude/worktrees/agent-a',
    featureBranch: 'agent-a-branch',
    rootSessionId: 'root-1',
    rootWorktreePath: '/repo/.claude/worktrees/root-task',
  })
  assertEquals(skipped, {
    status: 'skipped',
    worktreePath: '/repo/.claude/worktrees/agent-b',
    featureBranch: 'agent-a-branch',
    rootSessionId: 'root-1',
    rootWorktreePath: '/repo/.claude/worktrees/root-task',
    reason: 'child_worktree_dirty',
    message: '子代理 worktree 有未提交改动',
    details: { status: 'M src/main.ts' },
  })
  assertEquals(failed, {
    status: 'failed',
    worktreePath: '/repo/.claude/worktrees/agent-c',
    featureBranch: 'agent-a-branch',
    rootSessionId: 'root-1',
    rootWorktreePath: '/repo/.claude/worktrees/root-task',
    reason: 'child_worktree_remove_failed',
    message: 'git worktree remove 失败',
    details: { stderr: 'boom' },
  })
})

Deno.test('applyCleanupLedgerOutcome: deleted 与 skipped 应写回终态并在全终态时可删账本', () => {
  const ledger = createLedger([
    createCandidate(),
    createCandidate({
      agentId: 'agent-b',
      agentSessionId: 'session-b',
      worktreePath: '/repo/.claude/worktrees/agent-b',
      branch: 'agent-b-branch',
    }),
  ])

  const deletedLedger = applyCleanupLedgerOutcome(ledger, {
    worktreePath: '/repo/.claude/worktrees/agent-a',
    cleanupReason: 'deleted_by_root_cleanup',
    timestamp: '2026-04-12T04:00:00.000Z',
    result: buildChildCleanupOutcome(createCandidate(), { kind: 'deleted' }),
  })
  const skippedLedger = applyCleanupLedgerOutcome(deletedLedger, {
    worktreePath: '/repo/.claude/worktrees/agent-b',
    cleanupReason: 'dirty_child_worktree',
    timestamp: '2026-04-12T04:01:00.000Z',
    result: buildChildCleanupOutcome(
      createCandidate({
        agentId: 'agent-b',
        agentSessionId: 'session-b',
        worktreePath: '/repo/.claude/worktrees/agent-b',
        branch: 'agent-b-branch',
      }),
      {
        kind: 'skipped',
        reason: 'child_worktree_dirty',
        message: '子代理 worktree 有未提交改动',
      },
    ),
  })

  assertEquals(
    skippedLedger.records.map((record) => ({
      worktreePath: record.worktreePath,
      status: record.status,
      cleanupReason: record.cleanupReason,
    })),
    [
      {
        worktreePath: '/repo/.claude/worktrees/agent-a',
        status: 'cleanup_done',
        cleanupReason: 'deleted_by_root_cleanup',
      },
      {
        worktreePath: '/repo/.claude/worktrees/agent-b',
        status: 'cleanup_skipped',
        cleanupReason: 'dirty_child_worktree',
      },
    ],
  )
  assertEquals(
    skippedLedger.events.map((event) => event.hookEventName),
    ['WorktreeCleanupDone', 'WorktreeCleanupSkipped'],
  )
})

Deno.test('applyCleanupLedgerOutcome: failed 必须与 skipped 保持可区分的落账语义', () => {
  const ledger = createLedger([
    createCandidate(),
    createCandidate({
      agentId: 'agent-b',
      agentSessionId: 'session-b',
      worktreePath: '/repo/.claude/worktrees/agent-b',
      branch: 'agent-b-branch',
    }),
  ])

  const failedLedger = applyCleanupLedgerOutcome(ledger, {
    worktreePath: '/repo/.claude/worktrees/agent-b',
    cleanupReason: 'child_worktree_remove_failed',
    timestamp: '2026-04-12T04:02:00.000Z',
    result: buildChildCleanupOutcome(
      createCandidate({
        agentId: 'agent-b',
        agentSessionId: 'session-b',
        worktreePath: '/repo/.claude/worktrees/agent-b',
        branch: 'agent-b-branch',
      }),
      {
        kind: 'failed',
        reason: 'child_worktree_remove_failed',
        message: '删除子代理 worktree 失败',
      },
    ),
  })

  assertEquals(
    failedLedger.records.find(
      (record) => record.worktreePath === '/repo/.claude/worktrees/agent-b',
    ),
    {
      ...createCandidate({
        agentId: 'agent-b',
        agentSessionId: 'session-b',
        worktreePath: '/repo/.claude/worktrees/agent-b',
        branch: 'agent-b-branch',
      }),
      status: 'cleanup_skipped',
      updatedAt: '2026-04-12T04:02:00.000Z',
      cleanupReason: 'child_worktree_remove_failed',
    },
  )
  assertEquals(failedLedger.events.at(-1)?.hookEventName, 'WorktreeCleanupFailed')
  assertEquals(failedLedger.events.at(-1)?.status, 'cleanup_skipped')
  assertEquals(failedLedger.events.at(-1)?.cleanupReason, 'child_worktree_remove_failed')
})
