#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env

import { normalize, resolve } from '@std/path'
import {
  applyLedgerEvent,
  readLedger,
  writeLedger,
  type LedgerRecord,
  type SubagentWorktreeLedger,
} from '../../../lib/subagent_worktree_ledger.ts'

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

type GitResult = {
  code: number
  stdout: string
  stderr: string
  source: 'git' | 'spawn'
}

type GitRunner = (args: string[], cwd?: string) => Promise<GitResult>
type ReadLedgerFn = (repoRoot: string) => Promise<SubagentWorktreeLedger>
type WriteLedgerFn = (repoRoot: string, ledger: SubagentWorktreeLedger) => Promise<void>

type ChildCleanupProof = {
  matchedBy: 'rootSessionId' | 'rootWorktreePath'
}

export type ChildCleanupCandidate = LedgerRecord

export type ChildCleanupOutcome =
  | {
      status: 'deleted'
      worktreePath: string
      featureBranch?: string
      rootSessionId: string
      rootWorktreePath: string
    }
  | {
      status: 'skipped' | 'failed'
      worktreePath: string
      featureBranch?: string
      rootSessionId: string
      rootWorktreePath: string
      reason: string
      message: string
      details?: Record<string, unknown>
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

async function runGit(args: string[], cwd = Deno.cwd()): Promise<GitResult> {
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
      source: 'git',
    }
  } catch (error) {
    return {
      code: 1,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      source: 'spawn',
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
    fail(action, code, result.stderr || 'git 命令失败', {
      args,
      cwd,
      source: result.source,
      ...(result.stderr ? { stderr: result.stderr } : {}),
    })
  }
  return result.stdout
}

function getRootRepoPathByConvention(worktreePath: string) {
  if (!worktreePath.includes('/.claude/worktrees/')) return undefined
  return worktreePath.split('/.claude/worktrees/')[0]
}

function isManagedWorktreePath(path: string) {
  return path.includes('/.claude/worktrees/')
}

function isTerminalLedgerStatus(status: LedgerRecord['status']) {
  return status === 'removed' || status === 'cleanup_done'
}

export function classifyChildCleanupPlan(args: {
  rootSessionId?: string
  rootWorktreePath: string
  records: LedgerRecord[]
}) {
  const normalizedRootWorktreePath = normalize(resolve(args.rootWorktreePath))
  const normalizedRootSessionId = args.rootSessionId?.trim()
  const candidates: LedgerRecord[] = []
  const proofs = new Map<string, ChildCleanupProof>()

  for (const record of args.records) {
    const normalizedRecordWorktreePath = normalize(resolve(record.worktreePath))
    const normalizedRecordRootWorktreePath = normalize(resolve(record.rootWorktreePath))
    const isRootWorktree = normalizedRecordWorktreePath === normalizedRootWorktreePath
    if (isRootWorktree || isTerminalLedgerStatus(record.status)) continue

    if (normalizedRootSessionId && record.rootSessionId === normalizedRootSessionId) {
      candidates.push(record)
      proofs.set(record.worktreePath, { matchedBy: 'rootSessionId' })
      continue
    }

    if (
      !normalizedRootSessionId &&
      normalizedRecordRootWorktreePath === normalizedRootWorktreePath
    ) {
      candidates.push(record)
      proofs.set(record.worktreePath, { matchedBy: 'rootWorktreePath' })
    }
  }

  return {
    candidates,
    proofs,
  }
}

export function buildChildCleanupOutcome(
  candidate: ChildCleanupCandidate,
  input:
    | { kind: 'deleted' }
    | {
        kind: 'skipped' | 'failed'
        reason: string
        message: string
        details?: Record<string, unknown>
      },
): ChildCleanupOutcome {
  const base = {
    worktreePath: candidate.worktreePath,
    featureBranch: candidate.branch,
    rootSessionId: candidate.rootSessionId,
    rootWorktreePath: candidate.rootWorktreePath,
  }

  if (input.kind === 'deleted') {
    return {
      status: 'deleted',
      ...base,
    }
  }

  return {
    status: input.kind,
    ...base,
    reason: input.reason,
    message: input.message,
    ...(input.details ? { details: input.details } : {}),
  }
}

export function applyCleanupLedgerOutcome(
  ledger: SubagentWorktreeLedger,
  input: {
    worktreePath: string
    cleanupReason: string
    timestamp: string
    result: ChildCleanupOutcome
  },
) {
  const record = ledger.records.find((entry) => entry.worktreePath === input.worktreePath)
  if (!record) return ledger

  const hookEventName =
    input.result.status === 'deleted'
      ? 'WorktreeCleanupDone'
      : input.result.status === 'failed'
        ? 'WorktreeCleanupFailed'
        : 'WorktreeCleanupSkipped'

  return applyLedgerEvent(ledger, {
    hookEventName,
    status: input.result.status === 'deleted' ? 'cleanup_done' : 'cleanup_skipped',
    at: input.timestamp,
    rootSessionId: record.rootSessionId,
    rootWorktreePath: record.rootWorktreePath,
    agentId: record.agentId,
    agentSessionId: record.agentSessionId,
    worktreePath: record.worktreePath,
    branch: record.branch,
    cwd: record.lastSeenCwd,
    cleanupReason: input.cleanupReason,
  })
}

function buildSkippedOutcome(
  candidate: ChildCleanupCandidate,
  reason: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return buildChildCleanupOutcome(candidate, { kind: 'skipped', reason, message, details })
}

function buildFailedOutcome(
  candidate: ChildCleanupCandidate,
  reason: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return buildChildCleanupOutcome(candidate, { kind: 'failed', reason, message, details })
}

async function cleanupChildCandidate(args: {
  candidate: ChildCleanupCandidate
  proof?: ChildCleanupProof
  rootRepoPath: string
  rootCurrentBranch: string
  runGitFn: GitRunner
}) {
  const { candidate, proof, rootRepoPath, rootCurrentBranch, runGitFn } = args

  if (!isManagedWorktreePath(candidate.worktreePath)) {
    return buildSkippedOutcome(
      candidate,
      'child_outside_managed_worktrees',
      '子代理 worktree 不在 .claude/worktrees/ 下',
    )
  }

  if (!proof) {
    return buildSkippedOutcome(
      candidate,
      'child_ownership_unproven',
      '无法证明该子代理 worktree 属于当前 root session / root worktree',
    )
  }

  const childStatus = await runGitFn(['status', '--short'], candidate.worktreePath)
  if (childStatus.code !== 0) {
    return buildSkippedOutcome(
      candidate,
      'child_worktree_status_unreadable',
      '无法读取子代理 worktree 状态',
      {
        stdout: childStatus.stdout,
        stderr: childStatus.stderr,
        source: childStatus.source,
      },
    )
  }
  if (childStatus.stdout) {
    return buildSkippedOutcome(candidate, 'child_worktree_dirty', '子代理 worktree 有未提交改动', {
      status: childStatus.stdout,
    })
  }

  const childBranch = await runGitFn(['branch', '--show-current'], candidate.worktreePath)
  if (childBranch.code !== 0 || !childBranch.stdout) {
    return buildSkippedOutcome(candidate, 'child_branch_unreadable', '无法读取子代理当前分支', {
      stdout: childBranch.stdout,
      stderr: childBranch.stderr,
      source: childBranch.source,
    })
  }
  if (!candidate.branch || childBranch.stdout !== candidate.branch) {
    return buildSkippedOutcome(
      candidate,
      'child_branch_mismatch',
      '子代理当前分支与账本记录不匹配',
      {
        ledgerBranch: candidate.branch,
        actualBranch: childBranch.stdout,
      },
    )
  }

  const mergedIntoRoot = await runGitFn(
    ['merge-base', '--is-ancestor', childBranch.stdout, rootCurrentBranch],
    rootRepoPath,
  )
  if (mergedIntoRoot.code !== 0) {
    return buildSkippedOutcome(
      candidate,
      'child_branch_not_absorbed',
      '子代理分支尚未被主工作区当前分支吸收',
      {
        rootCurrentBranch,
        stdout: mergedIntoRoot.stdout,
        stderr: mergedIntoRoot.stderr,
        source: mergedIntoRoot.source,
      },
    )
  }

  const removeWorktree = await runGitFn(
    ['worktree', 'remove', '-f', candidate.worktreePath],
    rootRepoPath,
  )
  if (removeWorktree.code !== 0) {
    return buildFailedOutcome(
      candidate,
      'child_worktree_remove_failed',
      removeWorktree.stderr || '删除子代理 worktree 失败',
      {
        stdout: removeWorktree.stdout,
        stderr: removeWorktree.stderr,
        source: removeWorktree.source,
      },
    )
  }

  const deleteBranch = await runGitFn(['branch', '-D', childBranch.stdout], rootRepoPath)
  if (deleteBranch.code !== 0) {
    return buildFailedOutcome(
      candidate,
      'child_branch_delete_failed',
      deleteBranch.stderr || '删除子代理分支失败',
      {
        stdout: deleteBranch.stdout,
        stderr: deleteBranch.stderr,
        source: deleteBranch.source,
      },
    )
  }

  return buildChildCleanupOutcome(candidate, { kind: 'deleted' })
}

export async function cleanupChildWorktrees(args: {
  rootSessionId?: string
  rootWorktreePath: string
  rootRepoPath: string
  rootCurrentBranch: string
  runGit?: GitRunner
  readLedgerFn?: ReadLedgerFn
  writeLedgerFn?: WriteLedgerFn
  now?: () => Date
}) {
  const runGitFn = args.runGit ?? runGit
  const readLedgerFn = args.readLedgerFn ?? readLedger
  const writeLedgerFn = args.writeLedgerFn ?? writeLedger
  const now = args.now ?? (() => new Date())

  const ledgerRootDir = args.rootRepoPath
  const ledger = await readLedgerFn(ledgerRootDir)
  const plan = classifyChildCleanupPlan({
    rootSessionId: args.rootSessionId,
    rootWorktreePath: args.rootWorktreePath,
    records: ledger.records,
  })

  let nextLedger = ledger
  const results: ChildCleanupOutcome[] = []

  for (const candidate of plan.candidates) {
    const result = await cleanupChildCandidate({
      candidate,
      proof: plan.proofs.get(candidate.worktreePath),
      rootRepoPath: args.rootRepoPath,
      rootCurrentBranch: args.rootCurrentBranch,
      runGitFn,
    })
    results.push(result)

    nextLedger = applyCleanupLedgerOutcome(nextLedger, {
      worktreePath: candidate.worktreePath,
      cleanupReason: result.status === 'deleted' ? 'deleted_by_root_cleanup' : result.reason,
      timestamp: now().toISOString(),
      result,
    })
  }

  await writeLedgerFn(ledgerRootDir, nextLedger)

  return {
    candidates: plan.candidates,
    results,
    ledger: nextLedger,
  }
}

async function main() {
  const action = 'cleanup'
  const worktreePath = parseFlag(Deno.args, '--worktree-path')?.trim()
  const rootRepoPath = parseFlag(Deno.args, '--root-repo-path')?.trim()
  const featureBranch = parseFlag(Deno.args, '--feature-branch')?.trim()
  const rootSessionId = parseFlag(Deno.args, '--root-session-id')?.trim()

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

  if (!isManagedWorktreePath(normalizedWorktreePath)) {
    fail(
      action,
      'cleanup_requires_worktree_path',
      'cleanup 只允许处理 .claude/worktrees 下的 worktree',
      {
        worktreePath: normalizedWorktreePath,
      },
    )
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
      source: worktreeStatus.source,
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
    fail(
      action,
      'branch_not_fully_merged',
      'featureBranch 尚未完全并入主工作区当前分支，拒绝 cleanup',
      {
        rootRepoPath: normalizedRootRepoPath,
        featureBranch,
        rootCurrentBranch,
        stdout: mergedIntoRoot.stdout,
        stderr: mergedIntoRoot.stderr,
        source: mergedIntoRoot.source,
      },
    )
  }

  try {
    Deno.chdir(normalizedRootRepoPath)
  } catch (error) {
    fail(action, 'chdir_root_failed', '切换 cleanup 工作目录失败', {
      rootRepoPath: normalizedRootRepoPath,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  let childCleanup:
    | {
        status: 'completed'
        results: ChildCleanupOutcome[]
      }
    | {
        status: 'skipped'
        reason: string
        message: string
        results: ChildCleanupOutcome[]
      }

  try {
    const childCleanupResult = await cleanupChildWorktrees({
      rootSessionId,
      rootWorktreePath: normalizedWorktreePath,
      rootRepoPath: normalizedRootRepoPath,
      rootCurrentBranch,
    })
    childCleanup = {
      status: 'completed',
      results: childCleanupResult.results,
    }
  } catch (error) {
    childCleanup = {
      status: 'skipped',
      reason: 'ledger_unavailable',
      message: error instanceof Error ? error.message : '账本不可用，未执行子代理统一清理',
      results: [],
    }
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
      source: removeWorktree.source,
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
      source: deleteBranch.source,
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
      mainCleanup: {
        status: 'deleted',
        worktreePath: normalizedWorktreePath,
        featureBranch,
      },
      childCleanup,
    },
  } satisfies Success<Record<string, unknown>>)
}

if (import.meta.main) {
  await main()
}
