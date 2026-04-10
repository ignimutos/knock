import { assertEquals, assertRejects } from '@std/assert'
import {
  buildVerificationPlan,
  runVerificationPlan,
} from '../../.claude/skills/workflow-finish/scripts/finish.ts'

const workspaceRoot = new URL('../../', import.meta.url).pathname

type TaskCall = {
  task: string
  cwd: string
  paths: readonly string[]
}

Deno.test('workflow-finish: docs-only 改动只跑 fmt:check', async () => {
  const plan = await buildVerificationPlan(workspaceRoot, ['README.md'])

  assertEquals(plan.fmtCheck, {
    mode: 'paths',
    reason: 'scoped_paths',
    paths: ['README.md'],
  })
  assertEquals(plan.lintCheck, {
    mode: 'skip',
    reason: 'no_lint_targets',
  })
  assertEquals(plan.check, {
    mode: 'skip',
    reason: 'no_check_targets',
  })
  assertEquals(plan.test, {
    mode: 'skip',
    reason: 'docs_only',
  })
})

Deno.test('workflow-finish: 混合路径时 lint:check 与 check 只保留代码文件或目录', async () => {
  const plan = await buildVerificationPlan(workspaceRoot, ['README.md', 'src/config'])

  assertEquals(plan.lintCheck, {
    mode: 'paths',
    reason: 'scoped_paths',
    paths: ['src/config'],
  })
  assertEquals(plan.check, {
    mode: 'paths',
    reason: 'scoped_paths',
    paths: ['src/config'],
  })
})

Deno.test('workflow-finish: 命中全量触发项时 test 回退默认全量', async () => {
  const plan = await buildVerificationPlan(workspaceRoot, ['deno.json'])

  assertEquals(plan.test, {
    mode: 'default',
    reason: 'full_test_trigger',
  })
})

Deno.test('workflow-finish: test 只使用显式传入路径，不再隐式推导关联测试', async () => {
  const plan = await buildVerificationPlan(workspaceRoot, ['src/db/source_state_store.ts'])

  assertEquals(plan.test, {
    mode: 'paths',
    reason: 'scoped_paths',
    paths: ['src/db/source_state_store.ts'],
  })
})

Deno.test('workflow-finish: 未提供 paths 时直接报错', async () => {
  await assertRejects(
    () => buildVerificationPlan(workspaceRoot, []),
    Error,
    'workflow-finish 需要至少一个 --path',
  )
})

Deno.test('workflow-finish: 缺少 paths 时在执行前失败', async () => {
  await assertRejects(
    () => buildVerificationPlan(workspaceRoot, []),
    Error,
    'workflow-finish 需要至少一个 --path',
  )
})

Deno.test(
  'workflow-finish: 按 fmt:check -> lint:check -> check -> test 顺序执行验证计划',
  async () => {
    const calls: TaskCall[] = []
    const plan = {
      fmtCheck: { mode: 'paths', reason: 'scoped_paths', paths: ['README.md'] },
      lintCheck: { mode: 'paths', reason: 'scoped_paths', paths: ['src/config'] },
      check: { mode: 'skip', reason: 'no_check_targets' },
      test: { mode: 'default', reason: 'full_test_trigger' },
    } as const

    const result = await runVerificationPlan(workspaceRoot, plan, (task, cwd, paths = []) => {
      calls.push({ task, cwd, paths })
      return Promise.resolve({ code: 0, stdout: '', stderr: '' })
    })

    assertEquals(result, { ok: true })
    assertEquals(calls, [
      { task: 'fmt:check', cwd: workspaceRoot, paths: ['README.md'] },
      { task: 'lint:check', cwd: workspaceRoot, paths: ['src/config'] },
      { task: 'test', cwd: workspaceRoot, paths: [] },
    ])
  },
)

Deno.test('workflow-finish: 验证失败后返回失败步骤并短路', async () => {
  const calls: TaskCall[] = []
  const plan = {
    fmtCheck: { mode: 'paths', reason: 'scoped_paths', paths: ['README.md'] },
    lintCheck: { mode: 'default', reason: 'lint_default' },
    check: { mode: 'default', reason: 'check_default' },
    test: { mode: 'default', reason: 'test_default' },
  } as const

  const result = await runVerificationPlan(workspaceRoot, plan, (task, cwd, paths = []) => {
    calls.push({ task, cwd, paths })
    if (task === 'lint:check') {
      return Promise.resolve({ code: 1, stdout: '', stderr: 'lint failed' })
    }
    return Promise.resolve({ code: 0, stdout: '', stderr: '' })
  })

  assertEquals(result, {
    ok: false,
    code: 'lint_check_failed',
    step: 'lint:check',
    stdout: '',
    stderr: 'lint failed',
  })
  assertEquals(calls, [
    { task: 'fmt:check', cwd: workspaceRoot, paths: ['README.md'] },
    { task: 'lint:check', cwd: workspaceRoot, paths: [] },
  ])
})
