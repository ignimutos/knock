import { z } from 'zod'
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
import { parseWithFirstIssue } from '../../zod_utils.ts'
import {
  DELIVERY_ATTEMPT_STATUSES,
  DELIVERY_CHANNELS,
  EFFECT_DOMAINS,
  PIPELINE_ITEM_SKIPPED_REASONS,
  PIPELINE_ITEM_STATUSES,
  RUN_PROFILES,
  RUN_TRIGGERS,
  SOURCE_RUN_STATUSES,
} from './schema.ts'

const sourceRunCountsSchema = z.object({
  fetchedCount: z.number().int().nonnegative(),
  parsedCount: z.number().int().nonnegative(),
  filteredCount: z.number().int().nonnegative(),
  duplicateItemCount: z.number().int().nonnegative(),
  deliveredCount: z.number().int().nonnegative(),
  failedAttemptCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<SourceRunCounts>

const normalizedEntrySnapshotSchema = z.object({
  id: z.string(),
  title: z.string(),
  link: z.string(),
  description: z.string(),
  content: z.string(),
  published: z.string(),
  updated: z.string(),
}) satisfies z.ZodType<NormalizedEntrySnapshot>

const renderedSnapshotSchema = z.object({
  channel: z.enum(DELIVERY_CHANNELS),
  payload: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<RenderedSnapshot>

const sourceRunRowSchema = z.object({
  runId: z.string(),
  sourceId: z.string(),
  trigger: z.enum(RUN_TRIGGERS),
  profile: z.enum(RUN_PROFILES),
  effectDomain: z.enum(EFFECT_DOMAINS),
  status: z.enum(SOURCE_RUN_STATUSES),
  scheduledAt: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  countsJson: z.string(),
})

const pipelineItemRowSchema = z.object({
  itemId: z.string(),
  sourceRunId: z.string(),
  sourceId: z.string(),
  effectDomain: z.enum(EFFECT_DOMAINS),
  normalizedJson: z.string(),
  status: z.enum(PIPELINE_ITEM_STATUSES),
  skippedReason: z.enum(PIPELINE_ITEM_SKIPPED_REASONS).nullable(),
})

const deliveryAttemptRowSchema = z.object({
  attemptId: z.string(),
  itemId: z.string(),
  sourceRunId: z.string(),
  deliveryId: z.string(),
  channel: z.enum(DELIVERY_CHANNELS),
  attemptNumber: z.number().int(),
  effectDomain: z.enum(EFFECT_DOMAINS),
  status: z.enum(DELIVERY_ATTEMPT_STATUSES),
  reason: z.string().nullable(),
  plannedAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  renderedSnapshotJson: z.string().nullable(),
})

function parseJsonRecord(value: string, fieldName: string): unknown {
  try {
    return JSON.parse(value)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`${fieldName} 不是合法 JSON: ${reason}`)
  }
}

function assertSourceRunCounts(value: unknown): SourceRunCounts {
  return parseWithFirstIssue(sourceRunCountsSchema, value, 'source_runs.counts_json 非法')
}

function assertNormalizedEntrySnapshot(value: unknown): NormalizedEntrySnapshot {
  return parseWithFirstIssue(
    normalizedEntrySnapshotSchema,
    value,
    'pipeline_items.normalized_json 非法',
  )
}

function assertRenderedSnapshot(value: unknown): RenderedSnapshot {
  return parseWithFirstIssue(
    renderedSnapshotSchema,
    value,
    'delivery_attempts.rendered_snapshot_json 非法',
  )
}

function toSourceRun(row: unknown): SourceRun {
  const parsed = parseWithFirstIssue(sourceRunRowSchema, row, 'source_runs 行非法')
  const run: SourceRun = {
    runId: parsed.runId,
    sourceId: parsed.sourceId,
    trigger: parsed.trigger satisfies RunTrigger,
    profile: parsed.profile satisfies RunProfile,
    effectDomain: parsed.effectDomain satisfies EffectDomain,
    status: parsed.status satisfies SourceRunStatus,
    scheduledAt: parsed.scheduledAt,
    startedAt: parsed.startedAt,
    finishedAt: parsed.finishedAt ?? undefined,
    counts: assertSourceRunCounts(parseJsonRecord(parsed.countsJson, 'source_runs.counts_json')),
  }

  assertSourceRunInvariant(run)
  return run
}

function toPipelineItem(row: unknown): PipelineItem {
  const parsed = parseWithFirstIssue(pipelineItemRowSchema, row, 'pipeline_items 行非法')
  const status = parsed.status satisfies PipelineItemStatus
  const skippedReason = parsed.skippedReason ?? undefined

  if (skippedReason !== undefined && status !== 'skipped') {
    throw new Error('只有 skipped item 才能携带 skipped_reason')
  }

  return {
    itemId: parsed.itemId,
    sourceRunId: parsed.sourceRunId,
    sourceId: parsed.sourceId,
    effectDomain: parsed.effectDomain satisfies EffectDomain,
    normalized: assertNormalizedEntrySnapshot(
      parseJsonRecord(parsed.normalizedJson, 'pipeline_items.normalized_json'),
    ),
    status,
    skippedReason: skippedReason satisfies PipelineItemSkippedReason | undefined,
  }
}

function toDeliveryAttempt(row: unknown): DeliveryAttempt {
  const parsed = parseWithFirstIssue(deliveryAttemptRowSchema, row, 'delivery_attempts 行非法')
  const attempt: DeliveryAttempt = {
    attemptId: parsed.attemptId,
    itemId: parsed.itemId,
    sourceRunId: parsed.sourceRunId,
    deliveryId: parsed.deliveryId,
    channel: parsed.channel,
    attemptNumber: parsed.attemptNumber,
    effectDomain: parsed.effectDomain satisfies EffectDomain,
    status: parsed.status satisfies DeliveryAttemptStatus,
    reason: parsed.reason ?? undefined,
    plannedAt: parsed.plannedAt,
    startedAt: parsed.startedAt ?? undefined,
    finishedAt: parsed.finishedAt ?? undefined,
    renderedSnapshot: parsed.renderedSnapshotJson
      ? assertRenderedSnapshot(
          parseJsonRecord(parsed.renderedSnapshotJson, 'delivery_attempts.rendered_snapshot_json'),
        )
      : undefined,
  }

  assertDeliveryAttemptInvariant(attempt)
  return attempt
}

export function createSourceRunQueryService(db: FactsDbClient): SourceRunQueryService {
  return {
    getRun(runId: string): Promise<SourceRunView | undefined> {
      try {
        const runRow = db.$client
          .prepare(
            `
              SELECT
                run_id AS runId,
                source_id AS sourceId,
                trigger,
                profile,
                effect_domain AS effectDomain,
                status,
                scheduled_at AS scheduledAt,
                started_at AS startedAt,
                finished_at AS finishedAt,
                counts_json AS countsJson
              FROM source_runs
              WHERE run_id = ?
            `,
          )
          .get(runId)
        if (!runRow) return Promise.resolve(undefined)

        const itemRows = db.$client
          .prepare(
            `
              SELECT
                item_id AS itemId,
                source_run_id AS sourceRunId,
                source_id AS sourceId,
                effect_domain AS effectDomain,
                normalized_json AS normalizedJson,
                status,
                skipped_reason AS skippedReason
              FROM pipeline_items
              WHERE source_run_id = ?
              ORDER BY item_id ASC
            `,
          )
          .all(runId)
        const attemptRows = db.$client
          .prepare(
            `
              SELECT
                attempt_id AS attemptId,
                item_id AS itemId,
                source_run_id AS sourceRunId,
                delivery_id AS deliveryId,
                channel,
                attempt_number AS attemptNumber,
                effect_domain AS effectDomain,
                status,
                reason,
                planned_at AS plannedAt,
                started_at AS startedAt,
                finished_at AS finishedAt,
                rendered_snapshot_json AS renderedSnapshotJson
              FROM delivery_attempts
              WHERE source_run_id = ?
              ORDER BY planned_at ASC, attempt_id ASC
            `,
          )
          .all(runId)

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
