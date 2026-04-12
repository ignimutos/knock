#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env

import { dirname, normalize, resolve } from '@std/path'

type Success<T> = {
  ok: true
  action: string
  data: T
}

type Failure = {
  ok: false
  action: string
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

type CommandResult = {
  code: number
  stdout: string
  stderr: string
}

type TaskSelection =
  | { mode: 'skip'; reason: string }
  | { mode: 'default'; reason: string }
  | { mode: 'paths'; reason: string; paths: readonly string[] }

type VerificationPlan = {
  fmtCheck: TaskSelection
  lintCheck: TaskSelection
  check: TaskSelection
  test: TaskSelection
}

type TaskRunner = (task: string, cwd: string, paths?: readonly string[]) => Promise<CommandResult>

type FinishContext = {
  worktreePath: string
  rootRepoPath: string
  featureBranch: string
  baseBranch: string
  paths: readonly string[]
}

type VerificationFailure = {
  step: string
  code: string
  stdout: string
  stderr: string
}

type FinishAttentionInput =
  | (FinishContext & {
      type: 'merge_main_conflict'
      stdout: string
      stderr: string
    })
  | (FinishContext & {
      type: 'verification_failed'
      verification: VerificationFailure
    })
  | (FinishContext & {
      type: 'merge_back_conflict'
      stdout: string
      stderr: string
    })

const CODE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|mts|cts)$/i
const NON_CODE_FILE_PATTERN = /\.(md|ya?ml|json)$/i
const FULL_TEST_TRIGGER_PATTERNS = [
  /^deno\.json$/,
  /^scripts\/run-paths\.sh$/,
  /^src\/test_runtime\.ts$/,
  /^src\/main\.ts$/,
  /^src\/core\/app\.ts$/,
  /^src\/db\/client\.ts$/,
  /^src\/db\/schema\.ts$/,
  /^src\/db\/migrations\//,
  /^src\/sources\/xquery\.ts$/,
  /^src\/sources\/source_runtime\.ts$/,
]

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2))
}

function fail(
  action: string,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): never {
  printJson({
    ok: false,
    action,
    error: { code, message, details },
  } satisfies Failure)
  Deno.exit(1)
}

async function runGit(args: string[], cwd = Deno.cwd()) {
  try {
    const command = new Deno.Command('git', {
      args,
      cwd,
      stdout: 'piped',
      stderr: 'piped',
    })
    const result = await command.output()
    return {
      code: result.code,
      stdout: new TextDecoder().decode(result.stdout).trim(),
      stderr: new TextDecoder().decode(result.stderr).trim(),
    }
  } catch (error) {
    return {
      code: 1,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
    }
  }
}

async function requireGitValue(action: string, args: string[], code: string, cwd = Deno.cwd()) {
  const result = await runGit(args, cwd)
  if (result.code !== 0 || !result.stdout) {
    fail(action, code, result.stderr || 'git 命令失败', { args, cwd })
  }
  return result.stdout
}

function parseFlag(args: string[], flag: string) {
  const index = args.indexOf(flag)
  if (index === -1 || index === args.length - 1) return undefined
  return args[index + 1]
}

function parseRepeatedFlag(args: string[], flag: string) {
  const values: string[] = []
  for (let index = 0; index < args.length; index++) {
    if (args[index] === flag && args[index + 1]) {
      values.push(args[index + 1])
      index++
    }
  }
  return values
}

export function isManagedFinishWorktreePath(worktreePath: string) {
  return worktreePath.includes('/.claude/worktrees/')
}

function getRootRepoPathByConvention(worktreePath: string) {
  if (!isManagedFinishWorktreePath(worktreePath)) return undefined
  return worktreePath.split('/.claude/worktrees/')[0]
}

function parseWorktreePorcelain(stdout: string) {
  const validKeys = new Set([
    'worktree',
    'HEAD',
    'branch',
    'bare',
    'detached',
    'locked',
    'prunable',
  ])
  const booleanKeys = new Set(['bare', 'detached', 'locked', 'prunable'])
  const entries: Array<Record<string, string>> = []
  let current: Record<string, string> | undefined

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (!line) {
      if (current) {
        entries.push(current)
        current = undefined
      }
      continue
    }

    if (line.startsWith('worktree ')) {
      if (current) entries.push(current)
      current = { worktree: line.slice('worktree '.length) }
      continue
    }

    if (!current) continue

    const separatorIndex = line.indexOf(' ')
    if (separatorIndex === -1) {
      if (booleanKeys.has(line)) current[line] = 'true'
      continue
    }

    const key = line.slice(0, separatorIndex)
    if (!validKeys.has(key)) continue
    current[key] = line.slice(separatorIndex + 1)
  }

  if (current) entries.push(current)
  return entries
}

async function detectRootRepoPath(action: string, worktreePath: string) {
  const conventionalRootRepoPath = getRootRepoPathByConvention(worktreePath)
  const commonDirResult = await runGit(['rev-parse', '--git-common-dir'], worktreePath)
  if (commonDirResult.code === 0 && commonDirResult.stdout) {
    const commonDirPath = normalize(resolve(worktreePath, commonDirResult.stdout))
    const derivedRootRepoPath = dirname(commonDirPath)
    if (derivedRootRepoPath && derivedRootRepoPath !== commonDirPath) return derivedRootRepoPath
  }

  const probeCwds = [conventionalRootRepoPath, worktreePath].filter((value): value is string =>
    Boolean(value),
  )

  let lastListResult: { code: number; stdout: string; stderr: string } | undefined
  for (const probeCwd of probeCwds) {
    const listResult = await runGit(['worktree', 'list', '--porcelain'], probeCwd)
    lastListResult = listResult
    if (listResult.code !== 0 || !listResult.stdout) continue

    const entries = parseWorktreePorcelain(listResult.stdout)
    const currentEntry = entries.find((entry) => entry.worktree === worktreePath)
    const currentGitDir = currentEntry?.worktree
      ? normalize(resolve(currentEntry.worktree, '.git'))
      : undefined

    const mainEntry = entries.find((entry) => {
      if (!entry.worktree || entry.bare === 'true') return false
      if (currentEntry && entry.worktree === currentEntry.worktree) return false
      if (entry.branch) return false
      const entryGitDir = normalize(resolve(entry.worktree, '.git'))
      return currentGitDir ? entryGitDir !== currentGitDir : true
    })
    if (mainEntry?.worktree) return mainEntry.worktree
  }

  if (conventionalRootRepoPath) return conventionalRootRepoPath

  fail(action, 'root_repo_detection_failed', '未能检测到主工作区路径', {
    worktreePath,
    stdout: lastListResult?.stdout,
    stderr: lastListResult?.stderr ?? commonDirResult.stderr,
  })
}

function isMergeConflict(result: { stdout: string; stderr: string }) {
  const combinedOutput = `${result.stdout}\n${result.stderr}`
  return /(CONFLICT \(|Automatic merge failed; fix conflicts and then commit the result|fix conflicts and then commit the result)/i.test(
    combinedOutput,
  )
}

async function runCommand(name: string, args: string[], cwd = Deno.cwd()) {
  try {
    const result = await new Deno.Command(name, {
      args,
      cwd,
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    return {
      code: result.code,
      stdout: new TextDecoder().decode(result.stdout).trim(),
      stderr: new TextDecoder().decode(result.stderr).trim(),
    }
  } catch (error) {
    return {
      code: 1,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
    }
  }
}

async function runTask(task: string, cwd: string, paths: readonly string[] = []) {
  const args = ['task', task, ...paths]
  return await runCommand('deno', args, cwd)
}

function dedupePaths(paths: string[]) {
  return [...new Set(paths)]
}

function isCodeFile(path: string) {
  return CODE_FILE_PATTERN.test(path)
}

function isNonCodeFile(path: string) {
  return NON_CODE_FILE_PATTERN.test(path)
}

async function isDirectoryTarget(cwd: string, path: string) {
  try {
    return (await Deno.stat(resolve(cwd, path))).isDirectory
  } catch {
    return false
  }
}

async function getCodeTargets(cwd: string, paths: string[]) {
  const targets: string[] = []
  for (const path of paths) {
    if (isCodeFile(path)) {
      targets.push(path)
      continue
    }
    if (!isNonCodeFile(path) && (await isDirectoryTarget(cwd, path))) {
      targets.push(path)
    }
  }
  return dedupePaths(targets)
}

function isFullTestTrigger(path: string) {
  return FULL_TEST_TRIGGER_PATTERNS.some((pattern) => pattern.test(path))
}

async function getTestSelection(cwd: string, paths: string[]): Promise<TaskSelection> {
  if (paths.some(isFullTestTrigger)) {
    return { mode: 'default', reason: 'full_test_trigger' }
  }

  const testTargets = await getCodeTargets(cwd, paths)

  if (testTargets.length === 0) {
    return {
      mode: 'skip',
      reason: paths.every(isNonCodeFile) ? 'docs_only' : 'no_test_targets',
    }
  }

  return {
    mode: 'paths',
    reason: 'scoped_paths',
    paths: testTargets,
  }
}

export function buildCompletionChoices(context: {
  worktreePath: string
  rootRepoPath: string
  featureBranch: string
  baseBranch: string
}) {
  return [
    {
      id: '1',
      label: '删除当前 worktree（默认也清理当前 root session 的子代理 worktree）',
      worktreePath: context.worktreePath,
      featureBranch: context.featureBranch,
      rootRepoPath: context.rootRepoPath,
      baseBranch: context.baseBranch,
    },
    {
      id: '2',
      label: '保留当前 worktree（默认仍清理当前 root session 的子代理 worktree）',
      worktreePath: context.worktreePath,
      featureBranch: context.featureBranch,
      rootRepoPath: context.rootRepoPath,
      baseBranch: context.baseBranch,
    },
    {
      id: '3',
      label: '用户输入',
    },
  ] as const
}

export function classifyFinishAttention(input: FinishAttentionInput) {
  const base = {
    status: 'needs_attention' as const,
    nextAction: 'repair_loop' as const,
    reason: input.type,
    worktreePath: input.worktreePath,
    rootRepoPath: input.rootRepoPath,
    featureBranch: input.featureBranch,
    baseBranch: input.baseBranch,
    paths: [...input.paths],
  }

  if (input.type === 'verification_failed') {
    return {
      ...base,
      verification: input.verification,
    }
  }

  return {
    ...base,
    stdout: input.stdout,
    stderr: input.stderr,
  }
}

export async function buildVerificationPlan(
  cwd: string,
  paths: string[],
): Promise<VerificationPlan> {
  if (paths.length === 0) {
    throw new Error('workflow-finish 需要至少一个 --path')
  }

  const fmtCheck: TaskSelection = { mode: 'paths', reason: 'scoped_paths', paths }
  const codeTargets = await getCodeTargets(cwd, paths)

  return {
    fmtCheck,
    lintCheck:
      codeTargets.length > 0
        ? { mode: 'paths', reason: 'scoped_paths', paths: codeTargets }
        : { mode: 'skip', reason: 'no_lint_targets' },
    check:
      codeTargets.length > 0
        ? { mode: 'paths', reason: 'scoped_paths', paths: codeTargets }
        : { mode: 'skip', reason: 'no_check_targets' },
    test: await getTestSelection(cwd, paths),
  }
}

function getTaskPaths(selection: TaskSelection) {
  return selection.mode === 'paths' ? selection.paths : []
}

async function runSelectedTask(
  task: string,
  step: string,
  errorCode: string,
  selection: TaskSelection,
  cwd: string,
  runner: TaskRunner,
) {
  if (selection.mode === 'skip') return { ok: true as const }

  console.log(`运行 ${step}`)
  const result = await runner(task, cwd, getTaskPaths(selection))
  if (result.code !== 0) {
    return {
      ok: false as const,
      code: errorCode,
      step,
      stdout: result.stdout,
      stderr: result.stderr,
    }
  }

  return { ok: true as const }
}

export async function runVerificationPlan(
  cwd: string,
  plan: VerificationPlan,
  runner: TaskRunner = runTask,
) {
  const fmtCheck = await runSelectedTask(
    'fmt:check',
    'fmt:check',
    'fmt_check_failed',
    plan.fmtCheck,
    cwd,
    runner,
  )
  if (!fmtCheck.ok) return fmtCheck

  const lintCheck = await runSelectedTask(
    'lint:check',
    'lint:check',
    'lint_check_failed',
    plan.lintCheck,
    cwd,
    runner,
  )
  if (!lintCheck.ok) return lintCheck

  const check = await runSelectedTask('check', 'check', 'check_failed', plan.check, cwd, runner)
  if (!check.ok) return check

  const test = await runSelectedTask('test', 'test', 'test_failed', plan.test, cwd, runner)
  if (!test.ok) return test

  return { ok: true as const }
}

async function ensureRootWorkspaceClean(action: string, rootRepoPath: string) {
  const status = await runGit(['status', '--short'], rootRepoPath)
  if (status.code !== 0) {
    fail(action, 'root_git_status_failed', status.stderr || '无法读取主工作区 git status', {
      rootRepoPath,
      stdout: status.stdout,
      stderr: status.stderr,
    })
  }

  if (status.stdout) {
    fail(action, 'root_workspace_dirty', '主工作区存在未提交改动，拒绝执行 merge-back', {
      rootRepoPath,
      status: status.stdout,
    })
  }
}

async function runVerification(cwd: string, paths: string[]) {
  const plan = await buildVerificationPlan(cwd, paths)
  return await runVerificationPlan(cwd, plan)
}

async function autoCommitAllChanges(message: string, cwd: string) {
  const status = await runGit(['status', '--short'], cwd)
  if (status.code !== 0) {
    fail('finish', 'git_status_failed', status.stderr || '无法读取 git status', { cwd })
  }

  if (!status.stdout) {
    return { autoCommitted: false, status: status.stdout }
  }

  console.log('暂存并提交当前改动')
  const addResult = await runGit(['add', '-A'], cwd)
  if (addResult.code !== 0) {
    fail('finish', 'git_add_failed', addResult.stderr || 'git add 失败', { cwd })
  }

  const commitResult = await runGit(['commit', '-m', message], cwd)
  if (commitResult.code !== 0) {
    fail('finish', 'git_commit_failed', commitResult.stderr || 'git commit 失败', {
      cwd,
      stdout: commitResult.stdout,
      stderr: commitResult.stderr,
    })
  }

  return { autoCommitted: true, status: status.stdout, stdout: commitResult.stdout }
}

async function main() {
  const action = 'finish'
  const message = parseFlag(Deno.args, '--message')?.trim()
  if (!message) {
    fail(action, 'missing_message', 'workflow-finish 需要完整 commit message')
  }

  const rawPaths = parseRepeatedFlag(Deno.args, '--path')
    .map((path) => path.trim())
    .filter(Boolean)
  const uniquePaths = [...new Set(rawPaths)]
  if (uniquePaths.length === 0) {
    fail(action, 'missing_paths', 'workflow-finish 需要至少一个 --path')
  }

  const worktreePath = await requireGitValue(
    action,
    ['rev-parse', '--show-toplevel'],
    'git_root_failed',
  )
  if (!isManagedFinishWorktreePath(worktreePath)) {
    fail(
      action,
      'finish_requires_worktree',
      '当前不在 .claude/worktrees/ 下，拒绝执行 workflow-finish',
      {
        worktreePath,
      },
    )
  }

  const featureBranch = await requireGitValue(
    action,
    ['branch', '--show-current'],
    'git_branch_failed',
  )
  const rootRepoPath = await detectRootRepoPath(action, worktreePath)
  const baseBranch =
    parseFlag(Deno.args, '--base-branch')?.trim() ||
    (await requireGitValue(action, ['branch', '--show-current'], 'git_branch_failed', rootRepoPath))

  await ensureRootWorkspaceClean(action, rootRepoPath)
  const commitInfo = await autoCommitAllChanges(message, worktreePath)

  console.log(`合并 ${baseBranch} 到当前 worktree`)
  const mergeMainIntoFeature = await runGit(['merge', baseBranch], worktreePath)
  if (mergeMainIntoFeature.code !== 0) {
    if (isMergeConflict(mergeMainIntoFeature)) {
      console.log('合并主分支时发生冲突，需要进入 repair loop')
      printJson({
        ok: true,
        action,
        data: classifyFinishAttention({
          type: 'merge_main_conflict',
          worktreePath,
          rootRepoPath,
          featureBranch,
          baseBranch,
          paths: uniquePaths,
          stdout: mergeMainIntoFeature.stdout,
          stderr: mergeMainIntoFeature.stderr,
        }),
      } satisfies Success<Record<string, unknown>>)
      return
    }

    fail(
      action,
      'merge_main_into_feature_failed',
      mergeMainIntoFeature.stderr || 'main 合并到当前分支失败',
      {
        worktreePath,
        rootRepoPath,
        featureBranch,
        baseBranch,
        stdout: mergeMainIntoFeature.stdout,
        stderr: mergeMainIntoFeature.stderr,
      },
    )
  }

  const verification = await runVerification(worktreePath, uniquePaths)
  if (!verification.ok) {
    console.log('验证失败，需要进入 repair loop')
    printJson({
      ok: true,
      action,
      data: classifyFinishAttention({
        type: 'verification_failed',
        worktreePath,
        rootRepoPath,
        featureBranch,
        baseBranch,
        paths: uniquePaths,
        verification: {
          step: verification.step,
          code: verification.code,
          stdout: verification.stdout,
          stderr: verification.stderr,
        },
      }),
    } satisfies Success<Record<string, unknown>>)
    return
  }

  console.log(`切换主工作区到 ${baseBranch}`)
  const checkoutMain = await runGit(['checkout', baseBranch], rootRepoPath)
  if (checkoutMain.code !== 0) {
    fail(action, 'checkout_main_failed', checkoutMain.stderr || '切换 main 失败', {
      rootRepoPath,
      baseBranch,
      stdout: checkoutMain.stdout,
      stderr: checkoutMain.stderr,
    })
  }

  console.log(`合并 ${featureBranch} 回 ${baseBranch}`)
  const mergeFeatureIntoMain = await runGit(['merge', featureBranch], rootRepoPath)
  if (mergeFeatureIntoMain.code !== 0) {
    if (isMergeConflict(mergeFeatureIntoMain)) {
      console.log('merge-back 时发生冲突，需要进入 repair loop')
      printJson({
        ok: true,
        action,
        data: classifyFinishAttention({
          type: 'merge_back_conflict',
          worktreePath,
          rootRepoPath,
          featureBranch,
          baseBranch,
          paths: uniquePaths,
          stdout: mergeFeatureIntoMain.stdout,
          stderr: mergeFeatureIntoMain.stderr,
        }),
      } satisfies Success<Record<string, unknown>>)
      return
    }

    fail(
      action,
      'merge_feature_into_main_failed',
      mergeFeatureIntoMain.stderr || '当前分支合并回 main 失败',
      {
        rootRepoPath,
        featureBranch,
        baseBranch,
        stdout: mergeFeatureIntoMain.stdout,
        stderr: mergeFeatureIntoMain.stderr,
      },
    )
  }

  console.log('merge-back 已完成，等待用户选择后续动作')
  printJson({
    ok: true,
    action,
    data: {
      status: 'completed_pending_choice',
      worktreePath,
      rootRepoPath,
      featureBranch,
      baseBranch,
      autoCommitted: commitInfo.autoCommitted,
      paths: uniquePaths,
      choices: buildCompletionChoices({
        worktreePath,
        rootRepoPath,
        featureBranch,
        baseBranch,
      }),
    },
  } satisfies Success<Record<string, unknown>>)
}

if (import.meta.main) {
  await main()
}
