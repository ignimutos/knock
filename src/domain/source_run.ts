import {
  assertRunContextAlignment,
  type EffectDomain,
  type RunProfile,
  type RunTrigger,
} from './run_profile.ts'

export interface SourceRunCounts {
  fetchedCount: number
  parsedCount: number
  filteredCount: number
  duplicateItemCount: number
  deliveredCount: number
  failedAttemptCount: number
  skippedCount: number
}

export type SourceRunStatus =
  | 'planned'
  | 'running'
  | 'success'
  | 'partial'
  | 'failed'
  | 'skipped'
  | 'interrupted'

export interface SourceRun {
  runId: string
  sourceId: string
  trigger: RunTrigger
  profile: RunProfile
  effectDomain: EffectDomain
  scheduledAt: string
  startedAt: string
  finishedAt?: string
  status: SourceRunStatus
  counts: SourceRunCounts
}

export interface CreateSourceRunInput {
  runId: string
  sourceId: string
  trigger: RunTrigger
  profile: RunProfile
  effectDomain: EffectDomain
  scheduledAt: string
  startedAt: string
}

export interface FinalizeSourceRunInput extends SourceRunCounts {
  finishedAt: string
}

const EMPTY_COUNTS: SourceRunCounts = {
  fetchedCount: 0,
  parsedCount: 0,
  filteredCount: 0,
  duplicateItemCount: 0,
  deliveredCount: 0,
  failedAttemptCount: 0,
  skippedCount: 0,
}

const TERMINAL_SOURCE_RUN_STATUSES = [
  'success',
  'partial',
  'failed',
  'skipped',
  'interrupted',
] as const satisfies readonly SourceRunStatus[]

export function createSourceRun(input: CreateSourceRunInput): SourceRun {
  const run: SourceRun = {
    ...input,
    status: 'running',
    counts: { ...EMPTY_COUNTS },
  }

  assertSourceRunInvariant(run)
  return run
}

export function finalizeSourceRun(run: SourceRun, counts: FinalizeSourceRunInput): SourceRun {
  const normalizedCounts = normalizeSourceRunCounts(counts)
  const finalizedRun: SourceRun = {
    ...run,
    status: classifyFinalSourceRunStatus(normalizedCounts),
    counts: normalizedCounts,
    finishedAt: counts.finishedAt,
  }

  assertSourceRunInvariant(finalizedRun)
  return finalizedRun
}

export function assertSourceRunInvariant(run: SourceRun): void {
  assertRunContextAlignment(run)
  assertSourceRunCounts(run.counts)

  if (isTerminalSourceRunStatus(run.status)) {
    if (run.finishedAt === undefined) {
      throw new Error('终态 source run 必须包含 finishedAt')
    }

    return
  }

  if (run.finishedAt !== undefined) {
    throw new Error('非终态 source run 不能包含 finishedAt')
  }
}

function isTerminalSourceRunStatus(status: SourceRunStatus): boolean {
  return TERMINAL_SOURCE_RUN_STATUSES.includes(
    status as (typeof TERMINAL_SOURCE_RUN_STATUSES)[number],
  )
}

function classifyFinalSourceRunStatus(
  counts: SourceRunCounts,
): Exclude<SourceRunStatus, 'planned' | 'running' | 'interrupted'> {
  const hasSkipOutcome =
    counts.skippedCount > 0 || counts.filteredCount > 0 || counts.duplicateItemCount > 0

  if (counts.deliveredCount > 0 && counts.failedAttemptCount > 0) {
    return 'partial'
  }

  if (counts.failedAttemptCount > 0) {
    return 'failed'
  }

  if (counts.deliveredCount > 0) {
    return 'success'
  }

  if (hasSkipOutcome) {
    return 'skipped'
  }

  return 'skipped'
}

function normalizeSourceRunCounts(counts: SourceRunCounts): SourceRunCounts {
  return {
    fetchedCount: counts.fetchedCount,
    parsedCount: counts.parsedCount,
    filteredCount: counts.filteredCount,
    duplicateItemCount: counts.duplicateItemCount,
    deliveredCount: counts.deliveredCount,
    failedAttemptCount: counts.failedAttemptCount,
    skippedCount: counts.skippedCount,
  }
}

function assertSourceRunCounts(counts: SourceRunCounts): void {
  for (const value of Object.values(counts)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error('source run counts 必须是非负整数')
    }
  }

  if (counts.parsedCount > counts.fetchedCount) {
    throw new Error('parsedCount 不能大于 fetchedCount')
  }

  const terminalItemCount = counts.filteredCount + counts.duplicateItemCount + counts.skippedCount
  if (terminalItemCount > counts.parsedCount) {
    throw new Error('source run item 级汇总不能超过 parsedCount')
  }

  if (counts.failedAttemptCount > 0 && counts.parsedCount === 0) {
    throw new Error('存在失败 attempt 时 parsedCount 不能为 0')
  }
}
