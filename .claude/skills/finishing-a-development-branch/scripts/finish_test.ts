import { assertEquals } from '@std/assert'
import {
  buildCompletionChoices,
  buildVerificationPlan,
  classifyFinishAttention,
  runVerificationPlan,
} from './finish.ts'

Deno.test('buildCompletionChoices: 应返回新的 3 个完成选项文案', () => {
  const choices = buildCompletionChoices({
    worktreePath: '/root/git/knock/.claude/worktrees/agent-123',
    rootRepoPath: '/root/git/knock',
    featureBranch: 'feature/test',
    baseBranch: 'main',
  })

  assertEquals(choices, [
    {
      id: '1',
      label: '删除当前 worktree（默认也清理当前 root session 的子代理 worktree）',
      worktreePath: '/root/git/knock/.claude/worktrees/agent-123',
      featureBranch: 'feature/test',
      rootRepoPath: '/root/git/knock',
      baseBranch: 'main',
    },
    {
      id: '2',
      label: '保留当前 worktree（默认仍清理当前 root session 的子代理 worktree）',
      worktreePath: '/root/git/knock/.claude/worktrees/agent-123',
      featureBranch: 'feature/test',
      rootRepoPath: '/root/git/knock',
      baseBranch: 'main',
    },
    {
      id: '3',
      label: '用户输入',
    },
  ])
})

Deno.test(
  'classifyFinishAttention: merge main 冲突应返回 repair_loop 与 merge_main_conflict',
  () => {
    assertEquals(
      classifyFinishAttention({
        type: 'merge_main_conflict',
        worktreePath: '/root/git/knock/.claude/worktrees/agent-123',
        rootRepoPath: '/root/git/knock',
        featureBranch: 'feature/test',
        baseBranch: 'main',
        paths: ['src/main.ts'],
        stdout: 'CONFLICT (content): merge conflict in src/main.ts',
        stderr: '',
      }),
      {
        status: 'needs_attention',
        nextAction: 'repair_loop',
        reason: 'merge_main_conflict',
        worktreePath: '/root/git/knock/.claude/worktrees/agent-123',
        rootRepoPath: '/root/git/knock',
        featureBranch: 'feature/test',
        baseBranch: 'main',
        paths: ['src/main.ts'],
        stdout: 'CONFLICT (content): merge conflict in src/main.ts',
        stderr: '',
      },
    )
  },
)

Deno.test(
  'classifyFinishAttention: verification 失败应返回 repair_loop 与 verification_failed',
  () => {
    assertEquals(
      classifyFinishAttention({
        type: 'verification_failed',
        worktreePath: '/root/git/knock/.claude/worktrees/agent-123',
        rootRepoPath: '/root/git/knock',
        featureBranch: 'feature/test',
        baseBranch: 'main',
        paths: ['src/main.ts', 'src/main_test.ts'],
        verification: {
          step: 'test',
          code: 'test_failed',
          stdout: 'failing output',
          stderr: 'failing stderr',
        },
      }),
      {
        status: 'needs_attention',
        nextAction: 'repair_loop',
        reason: 'verification_failed',
        worktreePath: '/root/git/knock/.claude/worktrees/agent-123',
        rootRepoPath: '/root/git/knock',
        featureBranch: 'feature/test',
        baseBranch: 'main',
        paths: ['src/main.ts', 'src/main_test.ts'],
        verification: {
          step: 'test',
          code: 'test_failed',
          stdout: 'failing output',
          stderr: 'failing stderr',
        },
      },
    )
  },
)

Deno.test(
  'classifyFinishAttention: merge-back 冲突应返回 repair_loop 与 merge_back_conflict',
  () => {
    assertEquals(
      classifyFinishAttention({
        type: 'merge_back_conflict',
        worktreePath: '/root/git/knock/.claude/worktrees/agent-123',
        rootRepoPath: '/root/git/knock',
        featureBranch: 'feature/test',
        baseBranch: 'main',
        paths: ['src/main.ts'],
        stdout: '',
        stderr: 'Automatic merge failed; fix conflicts and then commit the result.',
      }),
      {
        status: 'needs_attention',
        nextAction: 'repair_loop',
        reason: 'merge_back_conflict',
        worktreePath: '/root/git/knock/.claude/worktrees/agent-123',
        rootRepoPath: '/root/git/knock',
        featureBranch: 'feature/test',
        baseBranch: 'main',
        paths: ['src/main.ts'],
        stdout: '',
        stderr: 'Automatic merge failed; fix conflicts and then commit the result.',
      },
    )
  },
)

Deno.test('buildVerificationPlan: docs-only 路径应只跑 fmt:check', async () => {
  const plan = await buildVerificationPlan('/root/git/knock', ['README.md', 'CLAUDE.md'])

  assertEquals(plan, {
    fmtCheck: {
      mode: 'paths',
      reason: 'scoped_paths',
      paths: ['README.md', 'CLAUDE.md'],
    },
    lintCheck: {
      mode: 'skip',
      reason: 'no_lint_targets',
    },
    check: {
      mode: 'skip',
      reason: 'no_check_targets',
    },
    test: {
      mode: 'skip',
      reason: 'docs_only',
    },
  })
})

Deno.test('runVerificationPlan: 失败时应返回验证步骤信息', async () => {
  const result = await runVerificationPlan(
    '/root/git/knock',
    {
      fmtCheck: { mode: 'skip', reason: 'not_needed' },
      lintCheck: { mode: 'skip', reason: 'not_needed' },
      check: { mode: 'skip', reason: 'not_needed' },
      test: { mode: 'paths', reason: 'scoped_paths', paths: ['src/main_test.ts'] },
    },
    (task: string) => {
      if (task === 'test') {
        return Promise.resolve({
          code: 1,
          stdout: 'failed stdout',
          stderr: 'failed stderr',
        })
      }

      return Promise.resolve({
        code: 0,
        stdout: '',
        stderr: '',
      })
    },
  )

  assertEquals(result, {
    ok: false,
    code: 'test_failed',
    step: 'test',
    stdout: 'failed stdout',
    stderr: 'failed stderr',
  })
})
