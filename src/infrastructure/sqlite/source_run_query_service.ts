import { asc, eq } from 'drizzle-orm'
import type {
  SourceRunQueryService,
  SourceRunView,
} from '../../application/ports/source_run_query_service.ts'
import {
  assertDeliveryAttemptInvariant,
  type DeliveryAttempt,
  type DeliveryAttemptStatus,
  type RenderedSnapshot,
} from '../../domain/delivery_attempt.ts'
import type {
  NormalizedEntrySnapshot,
  PipelineItem,
  PipelineItemSkippedReason,
  PipelineItemStatus,
} from '../../domain/pipeline_item.ts'
import {
  assertSourceRunInvariant,
  type SourceRun,
  type SourceRunCounts,
  type SourceRunStatus,
} from '../../domain/source_run.ts'
import type { EffectDomain, RunProfile, RunTrigger } from '../../domain/run_profile.ts'
import type { FactsDbClient } from '../../db/client.ts'
import { deliveryAttempts, pipelineItems, sourceRuns } from './schema.ts'

function parseJsonRecord(value: string, fieldName: string): unknown {
  try {
    return JSON.parse(value)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`${fieldName} 不是合法 JSON: ${reason}`)
  }
}

function assertString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} 必须是字符串`)
  }

  return value
}

function assertOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined
  return assertString(value, fieldName)
}

function assertRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${fieldName} 必须是对象`)
  }

  return value as Record<string, unknown>
}

function assertEnumValue<T extends string>(
  value: string,
  allowed: readonly T[],
  fieldName: string,
): T {
  if (!allowed.includes(value as T)) {
    throw new Error(`${fieldName} 非法: ${value}`)
  }

  return value as T
}

function assertNonNegativeInteger(value: unknown, fieldName: string): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 0) {
    throw new Error(`${fieldName} 必须是非负整数`)
  }

  return value
}

function assertSourceRunCounts(value: unknown): SourceRunCounts {
  const record = assertRecord(value, 'source_runs.counts_json')

  return {
    fetchedCount: assertNonNegativeInteger(
      record.fetchedCount,
      'source_runs.counts_json.fetchedCount',
    ),
    parsedCount: assertNonNegativeInteger(
      record.parsedCount,
      'source_runs.counts_json.parsedCount',
    ),
    filteredCount: assertNonNegativeInteger(
      record.filteredCount,
      'source_runs.counts_json.filteredCount',
    ),
    duplicateItemCount: assertNonNegativeInteger(
      record.duplicateItemCount,
      'source_runs.counts_json.duplicateItemCount',
    ),
    deliveredCount: assertNonNegativeInteger(
      record.deliveredCount,
      'source_runs.counts_json.deliveredCount',
    ),
    failedAttemptCount: assertNonNegativeInteger(
      record.failedAttemptCount,
      'source_runs.counts_json.failedAttemptCount',
    ),
    skippedCount: assertNonNegativeInteger(
      record.skippedCount,
      'source_runs.counts_json.skippedCount',
    ),
  }
}

function assertNormalizedEntrySnapshot(value: unknown): NormalizedEntrySnapshot {
  const record = assertRecord(value, 'pipeline_items.normalized_json')

  return {
    id: assertString(record.id, 'pipeline_items.normalized_json.id'),
    title: assertString(record.title, 'pipeline_items.normalized_json.title'),
    link: assertString(record.link, 'pipeline_items.normalized_json.link'),
    description: assertString(record.description, 'pipeline_items.normalized_json.description'),
    content: assertString(record.content, 'pipeline_items.normalized_json.content'),
    published: assertString(record.published, 'pipeline_items.normalized_json.published'),
    updated: assertString(record.updated, 'pipeline_items.normalized_json.updated'),
  }
}

function assertRenderedSnapshot(value: unknown): RenderedSnapshot {
  const record = assertRecord(value, 'delivery_attempts.rendered_snapshot_json')
  const channel = assertEnumValue(
    assertString(record.channel, 'delivery_attempts.rendered_snapshot_json.channel'),
    ['file', 'push', 'email'] as const,
    'delivery_attempts.rendered_snapshot_json.channel',
  )

  const payload = record.payload
  if (payload !== undefined) {
    assertRecord(payload, 'delivery_attempts.rendered_snapshot_json.payload')
  }

  return {
    channel,
    payload: payload as Record<string, unknown> | undefined,
  }
}

function toSourceRun(row: typeof sourceRuns.$inferSelect): SourceRun {
  const run: SourceRun = {
    runId: row.runId,
    sourceId: row.sourceId,
    trigger: assertEnumValue(
      row.trigger,
      ['scheduled', 'immediate', 'manual', 'preview'] as const,
      'source_runs.trigger',
    ) satisfies RunTrigger,
    profile: assertEnumValue(
      row.profile,
      ['production', 'preview'] as const,
      'source_runs.profile',
    ) satisfies RunProfile,
    effectDomain: assertEnumValue(
      row.effectDomain,
      ['production', 'preview'] as const,
      'source_runs.effect_domain',
    ) satisfies EffectDomain,
    status: assertEnumValue(
      row.status,
      ['planned', 'running', 'success', 'partial', 'failed', 'skipped', 'interrupted'] as const,
      'source_runs.status',
    ) satisfies SourceRunStatus,
    scheduledAt: row.scheduledAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? undefined,
    counts: assertSourceRunCounts(parseJsonRecord(row.countsJson, 'source_runs.counts_json')),
  }

  assertSourceRunInvariant(run)
  return run
}

function assertPipelineItemSkippedReason(
  value: string | null,
  status: PipelineItemStatus,
): PipelineItemSkippedReason | undefined {
  if (value === null) return undefined
  const skippedReason = assertEnumValue(
    value,
    ['all_deliveries_duplicate', 'no_deliveries'] as const,
    'pipeline_items.skipped_reason',
  ) satisfies PipelineItemSkippedReason

  if (status !== 'skipped') {
    throw new Error('只有 skipped item 才能携带 skipped_reason')
  }

  return skippedReason
}

function toPipelineItem(row: typeof pipelineItems.$inferSelect): PipelineItem {
  const status = assertEnumValue(
    row.status,
    ['ready', 'filtered', 'duplicate', 'skipped', 'delivered', 'failed'] as const,
    'pipeline_items.status',
  ) satisfies PipelineItemStatus

  return {
    itemId: row.itemId,
    sourceRunId: row.sourceRunId,
    sourceId: row.sourceId,
    effectDomain: assertEnumValue(
      row.effectDomain,
      ['production', 'preview'] as const,
      'pipeline_items.effect_domain',
    ) satisfies EffectDomain,
    normalized: assertNormalizedEntrySnapshot(
      parseJsonRecord(row.normalizedJson, 'pipeline_items.normalized_json'),
    ),
    status,
    skippedReason: assertPipelineItemSkippedReason(row.skippedReason, status),
  }
}

function toDeliveryAttempt(row: typeof deliveryAttempts.$inferSelect): DeliveryAttempt {
  const attempt: DeliveryAttempt = {
    attemptId: row.attemptId,
    itemId: row.itemId,
    sourceRunId: row.sourceRunId,
    deliveryId: row.deliveryId,
    channel: assertEnumValue(
      row.channel,
      ['file', 'push', 'email'] as const,
      'delivery_attempts.channel',
    ),
    attemptNumber: row.attemptNumber,
    effectDomain: assertEnumValue(
      row.effectDomain,
      ['production', 'preview'] as const,
      'delivery_attempts.effect_domain',
    ) satisfies EffectDomain,
    status: assertEnumValue(
      row.status,
      ['planned', 'running', 'delivered', 'failed', 'skipped', 'interrupted'] as const,
      'delivery_attempts.status',
    ) satisfies DeliveryAttemptStatus,
    reason: row.reason ?? undefined,
    plannedAt: row.plannedAt,
    startedAt: row.startedAt ?? undefined,
    finishedAt: row.finishedAt ?? undefined,
    renderedSnapshot: row.renderedSnapshotJson
      ? assertRenderedSnapshot(
          parseJsonRecord(row.renderedSnapshotJson, 'delivery_attempts.rendered_snapshot_json'),
        )
      : undefined,
  }

  assertOptionalString(attempt.reason, 'delivery_attempts.reason')
  assertDeliveryAttemptInvariant(attempt)
  return attempt
}

export function createSourceRunQueryService(db: FactsDbClient): SourceRunQueryService {
  return {
    getRun(runId: string): Promise<SourceRunView | undefined> {
      try {
        const runRow = db.select().from(sourceRuns).where(eq(sourceRuns.runId, runId)).get()
        if (!runRow) return Promise.resolve(undefined)

        const itemRows = db
          .select()
          .from(pipelineItems)
          .where(eq(pipelineItems.sourceRunId, runId))
          .orderBy(asc(pipelineItems.itemId))
          .all()
        const attemptRows = db
          .select()
          .from(deliveryAttempts)
          .where(eq(deliveryAttempts.sourceRunId, runId))
          .orderBy(asc(deliveryAttempts.plannedAt), asc(deliveryAttempts.attemptId))
          .all()

        return Promise.resolve({
          run: toSourceRun(runRow),
          items: itemRows.map(toPipelineItem),
          attempts: attemptRows.map(toDeliveryAttempt),
        })
      } catch (error) {
        return Promise.reject(error)
      }
    },
  }
}
