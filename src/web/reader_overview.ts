import { z } from 'zod'
import type {
  AppConfigResolved,
  ResolvedDeliveryConfig,
  ResolvedSourceConfig,
  SourceDeliveryOverride,
} from '../config/types.ts'
import { redactConfigSecrets } from './config_secret_redaction.ts'
import { getRawSourceDeliveryOverrides } from '../config/source_delivery_overrides.ts'
import { createFactsDbClient, type FactsDbClient } from '../db/client.ts'
import {
  parseRawConfigDocument,
  type LoadedCompiledConfig,
} from '../config/load_compiled_config.ts'
import { readTextFile } from '../platform/fs.ts'
import { PIPELINE_ITEM_STATUSES, SOURCE_RUN_STATUSES } from '../infrastructure/sqlite/schema.ts'
import {
  buildReaderOverviewFromSession,
  loadRuntimeSession,
} from '../interfaces/web/runtime_session.ts'
import { parseWithFirstIssue } from '../zod_utils.ts'

export interface ReaderRunSummary {
  runId: string
  status: string
  startedAt: string
  finishedAt?: string
  counts: {
    fetchedCount: number
    parsedCount: number
    filteredCount: number
    duplicateItemCount: number
    deliveredCount: number
    failedAttemptCount: number
    skippedCount: number
  }
}

export interface ReaderFeedSnapshot {
  title: string
  link: string
  description: string
  generator: string
  language: string
  published: string
}

export interface ReaderEntrySnapshot {
  itemId: string
  status: string
  id: string
  title: string
  link: string
  description: string
  content: string
  published: string
  updated: string
}

export interface ReaderSourceOverview {
  id: string
  name: string
  enabled: boolean
  schedule?: string
  filter?: string
  parser: 'syndication' | 'xquery' | 'summary'
  transport: 'http' | 'byparr' | 'summary'
  sourceUrl?: string
  xqueryLocate?: string
  xqueryEntryId?: string
  deliveryCount: number
  deliveryIds: string[]
  deliveryKinds: Array<'file' | 'push' | 'email'>
  deliveryOverrides: Record<string, SourceDeliveryOverride>
  lastRun?: ReaderRunSummary
  feed?: ReaderFeedSnapshot
  entries: ReaderEntrySnapshot[]
}

export interface ReaderDeliveryCatalogItem {
  id: string
  kind: 'file' | 'push' | 'email'
}

export interface ReaderOverview {
  sources: ReaderSourceOverview[]
  deliveries: ReaderDeliveryCatalogItem[]
  issue?: string
}

const jsonObjectSchema = z.object({}).catchall(z.unknown())

const runCountsSchema = z.object({
  fetchedCount: z.number().int().nonnegative(),
  parsedCount: z.number().int().nonnegative(),
  filteredCount: z.number().int().nonnegative(),
  duplicateItemCount: z.number().int().nonnegative(),
  deliveredCount: z.number().int().nonnegative(),
  failedAttemptCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
})

const feedSnapshotSchema = z.object({
  title: z.string(),
  link: z.string(),
  description: z.string(),
  generator: z.string(),
  language: z.string(),
  published: z.string(),
})

const entrySnapshotSchema = z.object({
  id: z.string(),
  title: z.string(),
  link: z.string(),
  description: z.string(),
  content: z.string(),
  published: z.string(),
  updated: z.string(),
})

const lastRunRowSchema = z.object({
  runId: z.string(),
  status: z.enum(SOURCE_RUN_STATUSES),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  countsJson: z.string(),
  feedJson: z.string().nullable(),
})

const entryRowSchema = z.object({
  itemId: z.string(),
  status: z.enum(PIPELINE_ITEM_STATUSES),
  normalizedJson: z.string(),
})

function normalizeReaderIssue(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('配置文件不存在:')) {
    return '未找到 runtime 配置，Reader 暂时无法加载 source 列表。'
  }

  return `读取 Reader 数据失败：${message}`
}

function parseJsonRecord(value: string | null, fieldName: string): unknown {
  if (value === null) return undefined

  try {
    return JSON.parse(value) as unknown
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`${fieldName} 不是合法 JSON: ${reason}`)
  }
}

function parseJsonObject(
  value: string | null,
  fieldName: string,
): Record<string, unknown> | undefined {
  const parsed = parseJsonRecord(value, fieldName)
  if (parsed === undefined) return undefined
  return parseWithFirstIssue(jsonObjectSchema, parsed, `${fieldName} 必须是对象`)
}

function parseRunCounts(value: string): ReaderRunSummary['counts'] {
  return parseWithFirstIssue(
    runCountsSchema,
    parseJsonRecord(value, 'source_runs.counts_json'),
    'source_runs.counts_json 非法',
  )
}

function parseFeedSnapshot(value: string | null): ReaderFeedSnapshot | undefined {
  const record = parseJsonObject(value, 'source_runs.feed_json')
  if (!record) return undefined
  return parseWithFirstIssue(feedSnapshotSchema, record, 'source_runs.feed_json 非法')
}

function parseEntrySnapshot(row: {
  itemId: string
  status: string
  normalizedJson: string
}): ReaderEntrySnapshot {
  return {
    itemId: row.itemId,
    status: row.status,
    ...parseWithFirstIssue(
      entrySnapshotSchema,
      parseJsonRecord(row.normalizedJson, 'pipeline_items.normalized_json'),
      'pipeline_items.normalized_json 非法',
    ),
  }
}

function parseSortableTimestamp(value: string): number {
  if (value === '') return Number.NEGATIVE_INFINITY
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp
}

function sortEntries(entries: ReaderEntrySnapshot[]): ReaderEntrySnapshot[] {
  return [...entries].sort((left, right) => {
    const rightTime = Math.max(
      parseSortableTimestamp(right.updated),
      parseSortableTimestamp(right.published),
    )
    const leftTime = Math.max(
      parseSortableTimestamp(left.updated),
      parseSortableTimestamp(left.published),
    )

    if (rightTime !== leftTime) {
      return rightTime - leftTime
    }

    return left.title.localeCompare(right.title, 'zh-CN') || left.id.localeCompare(right.id, 'en')
  })
}

function sanitizeSourceUrl(value: string | undefined): string | undefined {
  if (!value) return undefined

  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return undefined
  }
}

function getParser(source: ResolvedSourceConfig): ReaderSourceOverview['parser'] {
  if (source.summary) return 'summary'
  if (source.xquery) return 'xquery'
  return 'syndication'
}

function getTransport(source: ResolvedSourceConfig): ReaderSourceOverview['transport'] {
  if (source.summary) return 'summary'
  if (source.byparr) return 'byparr'
  return 'http'
}

function getSourceUrl(source: ResolvedSourceConfig): string | undefined {
  return sanitizeSourceUrl(source.http?.url ?? source.byparr?.url)
}

function getXqueryLocate(source: ResolvedSourceConfig): string | undefined {
  return typeof source.xquery?.locate === 'string' && source.xquery.locate.trim() !== ''
    ? source.xquery.locate
    : undefined
}

function getXqueryEntryId(source: ResolvedSourceConfig): string | undefined {
  const entry = source.xquery?.entry
  if (typeof entry === 'string') return undefined
  return typeof entry?.id === 'string' && entry.id.trim() !== '' ? entry.id : undefined
}

function getDeliveryKind(
  delivery:
    | Pick<ResolvedDeliveryConfig, 'file' | 'push' | 'email'>
    | { file?: unknown; push?: unknown; email?: unknown },
): 'file' | 'push' | 'email' {
  if (delivery.file) return 'file'
  if (delivery.push) return 'push'
  if (delivery.email) return 'email'
  throw new Error('delivery 缺少可识别类型')
}

function getDeliveryCatalog(config: AppConfigResolved): ReaderDeliveryCatalogItem[] {
  return config.deliveries
    .filter((delivery) => delivery.enabled !== false)
    .map((delivery) => ({
      id: delivery.id,
      kind: getDeliveryKind(delivery),
    }))
}

function toLastRun(row: unknown): ReaderRunSummary {
  const parsed = parseWithFirstIssue(lastRunRowSchema, row, 'source_runs 行非法')
  return {
    runId: parsed.runId,
    status: parsed.status,
    startedAt: parsed.startedAt,
    finishedAt: parsed.finishedAt ?? undefined,
    counts: parseRunCounts(parsed.countsJson),
  }
}

function toLastRunFeedJson(row: unknown): string | null {
  const parsed = parseWithFirstIssue(lastRunRowSchema, row, 'source_runs 行非法')
  return parsed.feedJson
}

function toEntryRow(row: unknown): { itemId: string; status: string; normalizedJson: string } {
  const parsed = parseWithFirstIssue(entryRowSchema, row, 'pipeline_items 行非法')
  return {
    itemId: parsed.itemId,
    status: parsed.status,
    normalizedJson: parsed.normalizedJson,
  }
}

export function buildReaderOverview(input: {
  config: AppConfigResolved
  rawDocument: Record<string, unknown>
  factsDb: FactsDbClient
}): ReaderOverview {
  const lastRunQuery = input.factsDb.$client.prepare(`
    SELECT
      run_id AS runId,
      status,
      started_at AS startedAt,
      finished_at AS finishedAt,
      counts_json AS countsJson,
      feed_json AS feedJson
    FROM source_runs
    WHERE source_id = ?
      AND effect_domain = ?
    ORDER BY finished_at DESC, started_at DESC
    LIMIT 1
  `)

  const entryRowsQuery = input.factsDb.$client.prepare(`
    SELECT
      item_id AS itemId,
      status,
      normalized_json AS normalizedJson
    FROM pipeline_items
    WHERE source_run_id = ?
      AND effect_domain = ?
  `)

  const sources = input.config.sources.map((source) => {
    const lastRunRow = lastRunQuery.get(source.id, 'production')
    const entryRows = lastRunRow
      ? (entryRowsQuery.all(toLastRun(lastRunRow).runId, 'production') as unknown[]).map(toEntryRow)
      : []

    return {
      id: source.id,
      name: source.name?.trim() || source.id,
      enabled: source.enabled,
      schedule: source.schedule,
      filter: source.filter,
      parser: getParser(source),
      transport: getTransport(source),
      sourceUrl: getSourceUrl(source),
      xqueryLocate: getXqueryLocate(source),
      xqueryEntryId: getXqueryEntryId(source),
      deliveryCount: source.deliveries.length,
      deliveryIds: source.deliveries.map((delivery) => delivery.deliveryId),
      deliveryKinds: Array.from(new Set(source.deliveries.map(getDeliveryKind))),
      deliveryOverrides: redactConfigSecrets(
        getRawSourceDeliveryOverrides(input.rawDocument, source.id),
      ),
      lastRun: lastRunRow ? toLastRun(lastRunRow) : undefined,
      feed: lastRunRow ? parseFeedSnapshot(toLastRunFeedJson(lastRunRow)) : undefined,
      entries: sortEntries(entryRows.map(parseEntrySnapshot)).slice(0, 80),
    } satisfies ReaderSourceOverview
  })

  return {
    sources,
    deliveries: getDeliveryCatalog(input.config),
  }
}

export async function buildCurrentReaderOverview(input: {
  loaded: Pick<LoadedCompiledConfig, 'config' | 'configPath'>
  factsDb?: FactsDbClient
  rawDocument?: Record<string, unknown>
}): Promise<ReaderOverview> {
  const rawDocument =
    input.rawDocument ?? parseRawConfigDocument(await readTextFile(input.loaded.configPath))
  if (input.factsDb) {
    return buildReaderOverview({
      config: input.loaded.config,
      rawDocument,
      factsDb: input.factsDb,
    })
  }

  const factsDb = createFactsDbClient({ sqlite: input.loaded.config.sqlite })
  try {
    return buildReaderOverview({
      config: input.loaded.config,
      rawDocument,
      factsDb,
    })
  } finally {
    factsDb.$client.close()
  }
}

export async function loadReaderOverview(): Promise<ReaderOverview> {
  try {
    return await buildReaderOverviewFromSession(await loadRuntimeSession())
  } catch (error) {
    return {
      sources: [],
      deliveries: [],
      issue: normalizeReaderIssue(error),
    }
  }
}
