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

async function runTask(task: string, cwd: string, paths: string[] = []) {
  const args = ['task', task, ...paths]
  return await runCommand('deno', args, cwd)
}

function getLintablePaths(paths: string[]) {
  return paths.filter((path) => /\.(ts|tsx|js|jsx|mjs|mts|cts)$/i.test(path))
}

async function runVerification(cwd: string, paths: string[]) {
  console.log('运行 fmt:check')
  const fmtCheck = await runTask('fmt:check', cwd, paths)
  if (fmtCheck.code !== 0) {
    return { ok: false as const, code: 'fmt_check_failed', step: 'fmt:check', ...fmtCheck }
  }

  const lintablePaths = getLintablePaths(paths)
  if (lintablePaths.length > 0) {
    console.log('运行 lint')
    const lint = await runTask('lint', cwd, lintablePaths)
    if (lint.code !== 0) {
      return { ok: false as const, code: 'lint_failed', step: 'lint', ...lint }
    }
  }

  console.log('运行 check')
  const check = await runTask('check', cwd)
  if (check.code !== 0) {
    return { ok: false as const, code: 'check_failed', step: 'check', ...check }
  }

  console.log('运行 test')
  const test = await runTask('test', cwd, paths)
  if (test.code !== 0) {
    return { ok: false as const, code: 'test_failed', step: 'test', ...test }
  }

  return { ok: true as const }
}

async function autoCommitAllChanges(message: string, cwd: string) {
  const status = await runGit(['status', '--short'], cwd)
  if (status.code !== 0) {
    fail('finish', 'git_status_failed', status.stderr || '无法读取 git status', { cwd })
  }

  if (!status.stdout) {
    return { committed: false, status: status.stdout }
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

  return { committed: true, status: status.stdout, stdout: commitResult.stdout }
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

  const worktreePath = await requireGitValue(
    action,
    ['rev-parse', '--show-toplevel'],
    'git_root_failed',
  )
  if (!worktreePath.includes('/.claude/worktrees/')) {
    fail(action, 'finish_requires_worktree', '当前不在 worktree 中，拒绝执行 workflow-finish', {
      worktreePath,
    })
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

  const commitInfo = await autoCommitAllChanges(message, worktreePath)

  console.log(`合并 ${baseBranch} 到当前 worktree`)
  const mergeMainIntoFeature = await runGit(['merge', baseBranch], worktreePath)
  if (mergeMainIntoFeature.code !== 0) {
    if (isMergeConflict(mergeMainIntoFeature)) {
      console.log('合并 main 时发生冲突，需要进入 ralph-loop')
      printJson({
        ok: true,
        action,
        data: {
          status: 'needs_attention',
          nextAction: 'ralph_loop',
          reason: 'merge_conflict',
          worktreePath,
          rootRepoPath,
          featureBranch,
          baseBranch,
          paths: uniquePaths,
          stdout: mergeMainIntoFeature.stdout,
          stderr: mergeMainIntoFeature.stderr,
        },
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
    console.log('验证失败，需要进入 ralph-loop')
    printJson({
      ok: true,
      action,
      data: {
        status: 'needs_attention',
        nextAction: 'ralph_loop',
        reason: 'verification_failed',
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
      },
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

  console.log('删除 worktree')
  const removeWorktree = await runGit(['worktree', 'remove', '-f', worktreePath], rootRepoPath)
  if (removeWorktree.code !== 0) {
    fail(action, 'worktree_remove_failed', removeWorktree.stderr || '删除 worktree 失败', {
      rootRepoPath,
      worktreePath,
      stdout: removeWorktree.stdout,
      stderr: removeWorktree.stderr,
    })
  }

  console.log('删除分支')
  const deleteBranch = await runGit(['branch', '-D', featureBranch], rootRepoPath)
  if (deleteBranch.code !== 0) {
    fail(action, 'branch_delete_failed', deleteBranch.stderr || '删除分支失败', {
      rootRepoPath,
      featureBranch,
      stdout: deleteBranch.stdout,
      stderr: deleteBranch.stderr,
    })
  }

  console.log(`workflow-finish 完成，主工作区：${rootRepoPath}`)
  printJson({
    ok: true,
    action,
    data: {
      status: 'completed',
      worktreePath,
      rootRepoPath,
      featureBranch,
      baseBranch,
      committed: commitInfo.committed,
      paths: uniquePaths,
    },
  } satisfies Success<Record<string, unknown>>)
}

if (import.meta.main) {
  await main()
}
