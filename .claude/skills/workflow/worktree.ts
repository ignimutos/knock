#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env

import { dirname, isAbsolute, join, normalize, resolve } from '@std/path'

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

type Result<T> = Success<T> | Failure

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

async function requireGitValue(action: string, args: string[], code: string) {
  const result = await runGit(args)
  if (result.code !== 0 || !result.stdout) {
    fail(action, code, result.stderr || 'git 命令失败', { args })
  }
  return result.stdout
}

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

function parseFlag(args: string[], flag: string) {
  const index = args.indexOf(flag)
  if (index === -1 || index === args.length - 1) return undefined
  return args[index + 1]
}

function parseOptionalPathFlag(args: string[], flag: string) {
  const value = parseFlag(args, flag)
  if (!value) return undefined
  return isAbsolute(value) ? normalize(value) : resolve(value)
}

function ensureNonEmptyFlag(
  action: string,
  args: string[],
  flag: string,
  code: string,
  message: string,
) {
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  if (index === args.length - 1 || !args[index + 1]?.trim()) {
    fail(action, code, message, { flag })
  }
  return args[index + 1]
}

function normalizeWorktreeName(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function getWorktreeDirName(worktreePath: string) {
  if (!worktreePath.includes('/.claude/worktrees/')) return undefined
  const segments = worktreePath.split('/').filter(Boolean)
  return segments.at(-1)
}

function getRootRepoPathByConvention(worktreePath: string) {
  if (!worktreePath.includes('/.claude/worktrees/')) return undefined
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
      if (booleanKeys.has(line)) {
        current[line] = 'true'
      }
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
    if (derivedRootRepoPath && derivedRootRepoPath !== commonDirPath) {
      return derivedRootRepoPath
    }
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
    if (mainEntry?.worktree) {
      return mainEntry.worktree
    }
  }

  if (conventionalRootRepoPath) {
    return conventionalRootRepoPath
  }

  fail(action, 'root_repo_detection_failed', '未能检测到主工作区路径', {
    worktreePath,
    stdout: lastListResult?.stdout,
    stderr: lastListResult?.stderr ?? commonDirResult.stderr,
  })
}

function isBranchMissingError(stderr: string, branchName: string) {
  return [
    new RegExp(
      `branch ['\"]${branchName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\"] not found`,
      'i',
    ),
    /error: branch .* not found/i,
  ].some((pattern) => pattern.test(stderr))
}

type CleanupContext = {
  worktreePath: string
  featureBranch: string
  rootRepoPath: string
  explicitFeatureBranchProvided: boolean
  explicitWorktreePathProvided: boolean
  explicitRootRepoPathProvided: boolean
}

type CleanupReentryReceipt = {
  featureBranch: string
  worktreePath: string
  rootRepoPath: string
}

function getCleanupReceiptPath(rootRepoPath: string) {
  return join(rootRepoPath, '.git', 'workflow-cleanup-receipts.json')
}

async function readCleanupReceipts(rootRepoPath: string): Promise<CleanupReentryReceipt[]> {
  const receiptPath = getCleanupReceiptPath(rootRepoPath)
  try {
    const content = await Deno.readTextFile(receiptPath)
    const parsed = JSON.parse(content)
    if (!Array.isArray(parsed)) return []

    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const featureBranch =
        typeof entry.featureBranch === 'string' ? entry.featureBranch : undefined
      const worktreePath = typeof entry.worktreePath === 'string' ? entry.worktreePath : undefined
      const storedRootRepoPath =
        typeof entry.rootRepoPath === 'string' ? entry.rootRepoPath : undefined
      if (!featureBranch || !worktreePath || !storedRootRepoPath) return []
      return [
        {
          featureBranch,
          worktreePath: normalize(worktreePath),
          rootRepoPath: normalize(storedRootRepoPath),
        },
      ]
    })
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return []
    fail('cleanup', 'cleanup_receipt_read_failed', '无法读取 cleanup 重入回执', {
      rootRepoPath,
      receiptPath,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function writeCleanupReceipts(rootRepoPath: string, receipts: CleanupReentryReceipt[]) {
  const receiptPath = getCleanupReceiptPath(rootRepoPath)
  try {
    await Deno.writeTextFile(receiptPath, JSON.stringify(receipts, null, 2))
  } catch (error) {
    fail('cleanup', 'cleanup_receipt_write_failed', '无法写入 cleanup 重入回执', {
      rootRepoPath,
      receiptPath,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function recordCleanupReceipt(receipt: CleanupReentryReceipt) {
  const receipts = await readCleanupReceipts(receipt.rootRepoPath)
  const deduped = receipts.filter((entry) => {
    return !(
      entry.featureBranch === receipt.featureBranch &&
      entry.worktreePath === receipt.worktreePath &&
      entry.rootRepoPath === receipt.rootRepoPath
    )
  })
  deduped.push(receipt)
  await writeCleanupReceipts(receipt.rootRepoPath, deduped)
}

async function resolveCleanupContext(args: string[]): Promise<CleanupContext> {
  const explicitWorktreePath = parseOptionalPathFlag(args, '--worktree-path')
  const explicitFeatureBranch = ensureNonEmptyFlag(
    'cleanup',
    args,
    '--feature-branch',
    'missing_feature_branch',
    'cleanup 需要非空的 --feature-branch',
  )
  const explicitRootRepoPath = parseOptionalPathFlag(args, '--root-repo-path')

  const worktreePath =
    explicitWorktreePath ??
    (await requireGitValue('cleanup', ['rev-parse', '--show-toplevel'], 'git_root_failed'))
  if (!worktreePath.includes('/.claude/worktrees/')) {
    fail('cleanup', 'cleanup_requires_worktree', '当前不在 worktree 中，拒绝执行 cleanup', {
      worktreePath,
    })
  }

  const featureBranch =
    explicitFeatureBranch ??
    (await requireGitValue('cleanup', ['branch', '--show-current'], 'git_branch_failed'))
  const rootRepoPath = explicitRootRepoPath ?? (await detectRootRepoPath('cleanup', worktreePath))

  return {
    worktreePath,
    featureBranch,
    rootRepoPath,
    explicitFeatureBranchProvided: explicitFeatureBranch !== undefined,
    explicitWorktreePathProvided: explicitWorktreePath !== undefined,
    explicitRootRepoPathProvided: explicitRootRepoPath !== undefined,
  }
}

function isMergeConflict(result: { stdout: string; stderr: string }) {
  const combinedOutput = `${result.stdout}\n${result.stderr}`
  return /(CONFLICT \(|Automatic merge failed; fix conflicts and then commit the result|fix conflicts and then commit the result)/i.test(
    combinedOutput,
  )
}

async function ensureMessage(args: string[]) {
  const message = parseFlag(args, '--message')
  if (!message) {
    fail('finish', 'missing_message', 'workflow-finish 必须提供完整 commit message')
  }
  return message
}

async function getStatusShort(cwd = Deno.cwd()) {
  const result = await runGit(['status', '--short'], cwd)
  if (result.code !== 0) {
    fail('finish', 'git_status_failed', result.stderr || '无法读取 git status', { cwd })
  }
  return result.stdout
}

async function autoCommitAllChanges(message: string, cwd = Deno.cwd()) {
  const status = await getStatusShort(cwd)
  if (!status) {
    return {
      committed: false,
      status,
    }
  }

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

  return {
    committed: true,
    status,
    stdout: commitResult.stdout,
  }
}

async function runCommand(name: string, args: string[], cwd = Deno.cwd()) {
  let result: Deno.CommandOutput
  try {
    result = await new Deno.Command(name, {
      args,
      cwd,
      stdout: 'piped',
      stderr: 'piped',
    }).output()
  } catch (error) {
    fail('finish', 'verification_failed', `${name} ${args.join(' ')} 执行失败`, {
      cwd,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const stdout = new TextDecoder().decode(result.stdout).trim()
  const stderr = new TextDecoder().decode(result.stderr).trim()
  if (result.code !== 0) {
    fail('finish', 'verification_failed', `${name} ${args.join(' ')} 失败`, {
      cwd,
      stdout,
      stderr,
    })
  }

  return { stdout, stderr }
}

async function runVerification(cwd = Deno.cwd()) {
  await runCommand('deno', ['task', 'fmt:check'], cwd)
  await runCommand('deno', ['task', 'test'], cwd)
}

async function main() {
  const [command, ...args] = Deno.args

  switch (command) {
    case 'start':
      return await runStart(args)
    case 'finish':
      return await runFinish(args)
    case 'cleanup':
      return await runCleanup(args)
    default:
      fail('dispatch', 'unknown_command', '未知 workflow 子命令', { command })
  }
}

async function runStart(args: string[]) {
  const explicitLabel = parseFlag(args, '--label')
  const label = explicitLabel ?? 'workflow-task'
  const topLevel = await requireGitValue(
    'start',
    ['rev-parse', '--show-toplevel'],
    'git_root_failed',
  )
  const branch = await requireGitValue('start', ['branch', '--show-current'], 'git_branch_failed')

  if (explicitLabel && !normalizeWorktreeName(explicitLabel)) {
    fail('start', 'invalid_worktree_label', '工作树名称无效', { label: explicitLabel })
  }

  const canonicalName =
    normalizeWorktreeName(label) || normalizeWorktreeName(branch) || 'workflow-task'

  if (topLevel.includes('/.claude/worktrees/')) {
    const worktreeName = getWorktreeDirName(topLevel)
    printJson({
      ok: true,
      action: 'start',
      data: {
        mode: 'already_in_worktree',
        ...(worktreeName ? { worktreeName } : { worktreeDirNameUnavailable: true }),
        worktreePath: topLevel,
      },
    } satisfies Success<Record<string, unknown>>)
    return
  }

  printJson({
    ok: true,
    action: 'start',
    data: {
      mode: 'create_worktree',
      worktreeName: canonicalName,
      currentRoot: topLevel,
    },
  } satisfies Success<Record<string, unknown>>)
}

async function runFinish(args: string[]) {
  const message = await ensureMessage(args)
  const worktreePath = await requireGitValue(
    'finish',
    ['rev-parse', '--show-toplevel'],
    'git_root_failed',
  )
  if (!worktreePath.includes('/.claude/worktrees/')) {
    fail('finish', 'finish_requires_worktree', '当前不在 worktree 中，拒绝执行 finish', {
      worktreePath,
    })
  }

  const featureBranch = await requireGitValue(
    'finish',
    ['branch', '--show-current'],
    'git_branch_failed',
  )
  const baseBranch = 'main'

  const commitInfo = await autoCommitAllChanges(message, worktreePath)

  const mergeMainIntoFeature = await runGit(['merge', baseBranch], worktreePath)
  if (mergeMainIntoFeature.code !== 0) {
    fail(
      'finish',
      isMergeConflict(mergeMainIntoFeature)
        ? 'merge_main_into_feature_conflict'
        : 'merge_main_into_feature_failed',
      isMergeConflict(mergeMainIntoFeature)
        ? 'main 合并到当前分支时发生冲突'
        : mergeMainIntoFeature.stderr || 'main 合并到当前分支失败',
      {
        worktreePath,
        featureBranch,
        baseBranch,
        stdout: mergeMainIntoFeature.stdout,
        stderr: mergeMainIntoFeature.stderr,
      },
    )
  }

  await runVerification(worktreePath)

  const rootRepoPath = await detectRootRepoPath('finish', worktreePath)

  const checkoutMain = await runGit(['checkout', baseBranch], rootRepoPath)
  if (checkoutMain.code !== 0) {
    fail('finish', 'checkout_main_failed', checkoutMain.stderr || '切换 main 失败', {
      rootRepoPath,
      baseBranch,
      stdout: checkoutMain.stdout,
      stderr: checkoutMain.stderr,
    })
  }

  const mergeFeatureIntoMain = await runGit(['merge', featureBranch], rootRepoPath)
  if (mergeFeatureIntoMain.code !== 0) {
    fail(
      'finish',
      isMergeConflict(mergeFeatureIntoMain)
        ? 'merge_feature_into_main_conflict'
        : 'merge_feature_into_main_failed',
      isMergeConflict(mergeFeatureIntoMain)
        ? '当前分支合并回 main 时发生冲突'
        : mergeFeatureIntoMain.stderr || '当前分支合并回 main 失败',
      {
        rootRepoPath,
        featureBranch,
        baseBranch,
        stdout: mergeFeatureIntoMain.stdout,
        stderr: mergeFeatureIntoMain.stderr,
      },
    )
  }

  await runVerification(rootRepoPath)

  printJson({
    ok: true,
    action: 'finish',
    data: {
      worktreePath,
      rootRepoPath,
      featureBranch,
      baseBranch,
      committed: commitInfo.committed,
    },
  } satisfies Success<Record<string, unknown>>)
}

async function ensureMergedIntoMain(
  featureBranch: string,
  rootRepoPath: string,
  options: {
    worktreePath: string
    explicitFeatureBranchProvided: boolean
    explicitWorktreePathProvided: boolean
    explicitRootRepoPathProvided: boolean
  },
) {
  const result = await runGit(['branch', '--merged', 'main'], rootRepoPath)
  if (result.code !== 0) {
    fail('cleanup', 'git_branch_merged_failed', result.stderr || '无法检查分支合并状态', {
      rootRepoPath,
      featureBranch,
      stdout: result.stdout,
      stderr: result.stderr,
    })
  }

  const mergedBranches = result.stdout
    .split('\n')
    .map((line) => line.replace(/^[*+ ]+/, '').trim())
    .filter(Boolean)

  if (mergedBranches.includes(featureBranch)) {
    return {
      merged: true,
      branchMissing: false,
      reentryReceiptMatched: false,
    }
  }

  const branchExistsResult = await runGit(
    ['show-ref', '--verify', '--quiet', `refs/heads/${featureBranch}`],
    rootRepoPath,
  )
  if (branchExistsResult.code === 0) {
    fail('cleanup', 'feature_not_merged', 'feature 尚未确认合回 main', {
      featureBranch,
      rootRepoPath,
      mergedBranches,
      branch: {
        exists: true,
        explicitFeatureBranchProvided: options.explicitFeatureBranchProvided,
      },
    })
  }

  if (branchExistsResult.code === 1) {
    const hasExplicitReentryContext =
      options.explicitFeatureBranchProvided &&
      options.explicitWorktreePathProvided &&
      options.explicitRootRepoPathProvided
    const receipts = hasExplicitReentryContext ? await readCleanupReceipts(rootRepoPath) : []
    const matchedReceipt = receipts.find((receipt) => {
      return (
        receipt.featureBranch === featureBranch &&
        receipt.worktreePath === options.worktreePath &&
        receipt.rootRepoPath === rootRepoPath
      )
    })

    if (matchedReceipt) {
      return {
        merged: false,
        branchMissing: true,
        reentryReceiptMatched: true,
      }
    }

    fail(
      'cleanup',
      'cleanup_reentry_context_required',
      '缺少可验证的 cleanup 重入上下文，不能放行不存在的 feature branch',
      {
        featureBranch,
        rootRepoPath,
        worktreePath: options.worktreePath,
        mergedBranches,
        branch: {
          exists: false,
          explicitFeatureBranchProvided: options.explicitFeatureBranchProvided,
        },
        reentry: {
          explicitWorktreePathProvided: options.explicitWorktreePathProvided,
          explicitRootRepoPathProvided: options.explicitRootRepoPathProvided,
          receiptMatched: false,
        },
      },
    )
  }

  fail('cleanup', 'git_branch_lookup_failed', branchExistsResult.stderr || '无法检查分支是否存在', {
    featureBranch,
    rootRepoPath,
    mergedBranches,
    stdout: branchExistsResult.stdout,
    stderr: branchExistsResult.stderr,
    explicitFeatureBranchProvided: options.explicitFeatureBranchProvided,
  })
}

async function runCleanup(args: string[]) {
  const {
    worktreePath,
    featureBranch,
    rootRepoPath,
    explicitFeatureBranchProvided,
    explicitWorktreePathProvided,
    explicitRootRepoPathProvided,
  } = await resolveCleanupContext(args)

  const mergeCheck = await ensureMergedIntoMain(featureBranch, rootRepoPath, {
    worktreePath,
    explicitFeatureBranchProvided,
    explicitWorktreePathProvided,
    explicitRootRepoPathProvided,
  })

  const status = await runGit(['status', '--short'], worktreePath)
  const worktreeMissing =
    status.code !== 0 &&
    (status.stderr.includes('No such file or directory') ||
      status.stderr.includes('No such cwd') ||
      status.stderr.includes('not a git repository'))

  if (status.code !== 0 && !worktreeMissing) {
    fail('cleanup', 'git_status_failed', status.stderr || '无法读取 git status', {
      worktreePath,
      stdout: status.stdout,
      stderr: status.stderr,
    })
  }
  if (status.stdout) {
    fail('cleanup', 'cleanup_worktree_dirty', 'cleanup 前存在未提交改动，拒绝删除当前 worktree', {
      worktreePath,
      featureBranch,
      rootRepoPath,
      status: status.stdout,
    })
  }

  const removeWorktree = await runGit(['worktree', 'remove', '-f', worktreePath], rootRepoPath)
  const worktreeAlreadyAbsent =
    removeWorktree.code !== 0 &&
    (removeWorktree.stderr.includes('is not a working tree') ||
      removeWorktree.stderr.includes('does not exist') ||
      removeWorktree.stderr.includes('No such file or directory'))
  if (removeWorktree.code !== 0 && !worktreeAlreadyAbsent) {
    fail('cleanup', 'worktree_remove_failed', removeWorktree.stderr || '删除 worktree 失败', {
      worktreePath,
      rootRepoPath,
      stdout: removeWorktree.stdout,
      stderr: removeWorktree.stderr,
    })
  }

  const deleteBranch = await runGit(['branch', '-D', featureBranch], rootRepoPath)
  const branchAlreadyAbsent =
    deleteBranch.code !== 0 && isBranchMissingError(deleteBranch.stderr, featureBranch)
  if (deleteBranch.code !== 0 && !branchAlreadyAbsent) {
    fail('cleanup', 'branch_delete_failed', deleteBranch.stderr || '删除分支失败', {
      featureBranch,
      rootRepoPath,
      stdout: deleteBranch.stdout,
      stderr: deleteBranch.stderr,
    })
  }

  await recordCleanupReceipt({
    featureBranch,
    worktreePath,
    rootRepoPath,
  })

  printJson({
    ok: true,
    action: 'cleanup',
    data: {
      rootRepoPath,
      worktreePath,
      featureBranch,
      gitCwd: rootRepoPath,
      mergeCheck: {
        mergedIntoMain: mergeCheck.merged,
        branchMissing: mergeCheck.branchMissing,
        explicitFeatureBranchProvided,
        reentryReceiptMatched: mergeCheck.reentryReceiptMatched,
      },
      worktree: {
        deleted: removeWorktree.code === 0,
        alreadyAbsent: worktreeAlreadyAbsent,
      },
      branch: {
        deleted: deleteBranch.code === 0,
        alreadyAbsent: branchAlreadyAbsent,
      },
    },
  } satisfies Success<Record<string, unknown>>)
}

if (import.meta.main) {
  await main()
}
