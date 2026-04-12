import { assertEquals, assertExists } from '@std/assert'

import { createFinishSmokeFixture, runJsonScript } from './finish_smoke_fixture.ts'

Deno.test('workflow-finish skill: frontmatter 名称与标题应命中本地唯一名', async () => {
  const skillText = await Deno.readTextFile(new URL('../SKILL.md', import.meta.url))
  assertEquals(skillText.includes('name: workflow-finish'), true)
  assertEquals(skillText.includes('# workflow-finish'), true)
})

Deno.test(
  'finish smoke fixture: 会搭出 root repo、managed worktree、child worktree 与 ledger',
  async () => {
    const fixture = await createFinishSmokeFixture()

    try {
      const rootRepoStat = await Deno.stat(fixture.rootRepoPath)
      const rootWorktreeStat = await Deno.stat(fixture.rootWorktreePath)
      const childWorktreeStat = await Deno.stat(fixture.childWorktreePath)
      const ledgerStat = await Deno.stat(fixture.ledgerPath)

      assertEquals(rootRepoStat.isDirectory, true)
      assertEquals(rootWorktreeStat.isDirectory, true)
      assertEquals(childWorktreeStat.isDirectory, true)
      assertEquals(ledgerStat.isFile, true)
      assertEquals(
        fixture.ledgerPath,
        `${fixture.rootRepoPath}/.claude/state/subagent-worktrees.json`,
      )
      assertEquals(fixture.rootWorktreePath.includes('/.claude/worktrees/'), true)
      assertEquals(fixture.childWorktreePath.includes('/.claude/worktrees/'), true)
    } finally {
      await fixture.dispose()
    }
  },
)

Deno.test('finish smoke: 非受管 root repo 先红灯验证 finish_requires_worktree', async () => {
  const fixture = await createFinishSmokeFixture()

  try {
    const result = await runJsonScript({
      cwd: fixture.rootRepoPath,
      scriptPath: fixture.finishScriptPath,
      args: ['--message', 'smoke finish commit', '--path', 'README.md'],
    })

    assertEquals(result.code, 1)
    assertEquals(result.json.ok, false)
    assertExists(result.json.error)
    assertEquals(result.json.error.code, 'finish_requires_worktree')
  } finally {
    await fixture.dispose()
  }
})

Deno.test(
  'finish smoke: 受管 root worktree 可完成 merge-back 并返回 completed_pending_choice',
  async () => {
    const fixture = await createFinishSmokeFixture()

    try {
      await Deno.writeTextFile(`${fixture.rootWorktreePath}/README.md`, 'smoke finish update\n')

      const result = await runJsonScript({
        cwd: fixture.rootWorktreePath,
        scriptPath: fixture.finishScriptPath,
        args: ['--message', 'smoke: finish flow', '--path', 'README.md', '--base-branch', 'main'],
      })

      assertEquals(result.code, 0)
      assertEquals(result.json.ok, true)
      assertExists(result.json.data)
      assertEquals(result.json.data.status, 'completed_pending_choice')
      assertEquals(result.json.data.featureBranch, 'feature/root-task')
      assertEquals(result.json.data.baseBranch, 'main')
      assertEquals(result.json.data.worktreePath, fixture.rootWorktreePath)
      assertEquals(result.json.data.rootRepoPath, fixture.rootRepoPath)
    } finally {
      await fixture.dispose()
    }
  },
)

Deno.test('finish smoke: cleanup 会删除 child worktree 并返回 childCleanup completed', async () => {
  const fixture = await createFinishSmokeFixture()

  try {
    await Deno.writeTextFile(`${fixture.rootWorktreePath}/README.md`, 'smoke cleanup update\n')

    const finishResult = await runJsonScript({
      cwd: fixture.rootWorktreePath,
      scriptPath: fixture.finishScriptPath,
      args: [
        '--message',
        'smoke: finish before cleanup',
        '--path',
        'README.md',
        '--base-branch',
        'main',
      ],
    })

    assertEquals(finishResult.code, 0)
    assertEquals(finishResult.json.data?.status, 'completed_pending_choice')

    const cleanupResult = await runJsonScript({
      cwd: fixture.rootRepoPath,
      scriptPath: fixture.cleanupScriptPath,
      args: [
        '--worktree-path',
        fixture.rootWorktreePath,
        '--root-repo-path',
        fixture.rootRepoPath,
        '--feature-branch',
        'feature/root-task',
        '--root-session-id',
        'root-session-smoke',
      ],
    })

    assertEquals(cleanupResult.code, 0)
    assertEquals(cleanupResult.json.ok, true)

    const cleanupData = cleanupResult.json.data as {
      status?: string
      mainCleanup?: { status?: string }
      childCleanup?: {
        status?: string
        results?: Array<{ status?: string }>
      }
    }

    assertEquals(cleanupData.status, 'completed')
    assertEquals(cleanupData.mainCleanup?.status, 'deleted')
    assertEquals(cleanupData.childCleanup?.status, 'completed')
    assertEquals(cleanupData.childCleanup?.results?.length, 1)
    assertEquals(cleanupData.childCleanup?.results?.[0]?.status, 'deleted')

    const worktreeList = await new Deno.Command('git', {
      args: ['worktree', 'list', '--porcelain'],
      cwd: fixture.rootRepoPath,
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    const worktreeListText = new TextDecoder().decode(worktreeList.stdout)
    assertEquals(worktreeListText.includes(fixture.childWorktreePath), false)
  } finally {
    await fixture.dispose()
  }
})
