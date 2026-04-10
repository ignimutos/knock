#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env

import { normalize, resolve } from '@std/path'

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

function parseFlag(args: string[], flag: string) {
  const index = args.indexOf(flag)
  if (index === -1 || index === args.length - 1) return undefined
  return args[index + 1]
}

async function requireGitValue(action: string, args: string[], code: string, cwd = Deno.cwd()) {
  const result = await runGit(args, cwd)
  if (result.code !== 0 || !result.stdout) {
    fail(action, code, result.stderr || 'git 命令失败', { args, cwd })
  }
  return result.stdout
}

function getRootRepoPathByConvention(worktreePath: string) {
  if (!worktreePath.includes('/.claude/worktrees/')) return undefined
  return worktreePath.split('/.claude/worktrees/')[0]
}

async function main() {
  const action = 'cleanup'
  const worktreePath = parseFlag(Deno.args, '--worktree-path')?.trim()
  const rootRepoPath = parseFlag(Deno.args, '--root-repo-path')?.trim()
  const featureBranch = parseFlag(Deno.args, '--feature-branch')?.trim()

  if (!worktreePath) {
    fail(action, 'missing_worktree_path', 'workflow-finish cleanup 需要 --worktree-path')
  }
  if (!rootRepoPath) {
    fail(action, 'missing_root_repo_path', 'workflow-finish cleanup 需要 --root-repo-path')
  }
  if (!featureBranch) {
    fail(action, 'missing_feature_branch', 'workflow-finish cleanup 需要 --feature-branch')
  }

  const normalizedWorktreePath = normalize(resolve(worktreePath))
  const normalizedRootRepoPath = normalize(resolve(rootRepoPath))

  if (!normalizedWorktreePath.includes('/.claude/worktrees/')) {
    fail(action, 'cleanup_requires_worktree_path', 'cleanup 只允许处理 .claude/worktrees 下的 worktree', {
      worktreePath: normalizedWorktreePath,
    })
  }

  const expectedRootRepoPath = getRootRepoPathByConvention(normalizedWorktreePath)
  if (expectedRootRepoPath && expectedRootRepoPath !== normalizedRootRepoPath) {
    fail(action, 'root_repo_path_mismatch', 'worktreePath 与 rootRepoPath 不匹配', {
      worktreePath: normalizedWorktreePath,
      rootRepoPath: normalizedRootRepoPath,
      expectedRootRepoPath,
    })
  }

  const currentRoot = await requireGitValue(
    action,
    ['rev-parse', '--show-toplevel'],
    'git_root_failed',
    normalizedRootRepoPath,
  )
  if (normalize(currentRoot) !== normalizedRootRepoPath) {
    fail(action, 'unexpected_root_repo', 'rootRepoPath 不是有效的仓库根路径', {
      rootRepoPath: normalizedRootRepoPath,
      detectedRoot: currentRoot,
    })
  }

  const actualFeatureBranch = await requireGitValue(
    action,
    ['branch', '--show-current'],
    'git_branch_failed',
    normalizedWorktreePath,
  )
  if (actualFeatureBranch !== featureBranch) {
    fail(action, 'feature_branch_mismatch', 'featureBranch 与 worktree 当前分支不匹配', {
      worktreePath: normalizedWorktreePath,
      featureBranch,
      actualFeatureBranch,
    })
  }

  const rootCurrentBranch = await requireGitValue(
    action,
    ['branch', '--show-current'],
    'git_branch_failed',
    normalizedRootRepoPath,
  )
  if (rootCurrentBranch === featureBranch) {
    fail(action, 'refuse_delete_current_root_branch', '拒绝删除主工作区当前分支', {
      rootRepoPath: normalizedRootRepoPath,
      rootCurrentBranch,
      featureBranch,
    })
  }

  const worktreeStatus = await runGit(['status', '--short'], normalizedWorktreePath)
  if (worktreeStatus.code !== 0) {
    fail(action, 'worktree_status_failed', worktreeStatus.stderr || '无法读取 worktree 状态', {
      worktreePath: normalizedWorktreePath,
      stdout: worktreeStatus.stdout,
      stderr: worktreeStatus.stderr,
    })
  }
  if (worktreeStatus.stdout) {
    fail(action, 'worktree_dirty', 'worktree 存在未提交改动，拒绝 cleanup', {
      worktreePath: normalizedWorktreePath,
      status: worktreeStatus.stdout,
    })
  }

  const mergedIntoRoot = await runGit(
    ['merge-base', '--is-ancestor', featureBranch, rootCurrentBranch],
    normalizedRootRepoPath,
  )
  if (mergedIntoRoot.code !== 0) {
    fail(action, 'branch_not_fully_merged', 'featureBranch 尚未完全并入主工作区当前分支，拒绝 cleanup', {
      rootRepoPath: normalizedRootRepoPath,
      featureBranch,
      rootCurrentBranch,
      stdout: mergedIntoRoot.stdout,
      stderr: mergedIntoRoot.stderr,
    })
  }

  console.log('删除 worktree')
  const removeWorktree = await runGit(
    ['worktree', 'remove', '-f', normalizedWorktreePath],
    normalizedRootRepoPath,
  )
  if (removeWorktree.code !== 0) {
    fail(action, 'worktree_remove_failed', removeWorktree.stderr || '删除 worktree 失败', {
      rootRepoPath: normalizedRootRepoPath,
      worktreePath: normalizedWorktreePath,
      stdout: removeWorktree.stdout,
      stderr: removeWorktree.stderr,
      featureBranch,
    })
  }

  console.log('删除分支')
  const deleteBranch = await runGit(['branch', '-D', featureBranch], normalizedRootRepoPath)
  if (deleteBranch.code !== 0) {
    fail(action, 'branch_delete_failed', deleteBranch.stderr || '删除分支失败', {
      rootRepoPath: normalizedRootRepoPath,
      worktreePath: normalizedWorktreePath,
      featureBranch,
      stdout: deleteBranch.stdout,
      stderr: deleteBranch.stderr,
    })
  }

  printJson({
    ok: true,
    action,
    data: {
      status: 'completed',
      rootRepoPath: normalizedRootRepoPath,
      worktreePath: normalizedWorktreePath,
      featureBranch,
    },
  } satisfies Success<Record<string, unknown>>)
}

if (import.meta.main) {
  await main()
}
