import { dirname, join, resolve } from '@std/path'
import { and, desc, eq } from 'drizzle-orm'
import type {
  AppConfigResolved,
  ResolvedDeliveryConfig,
  ResolvedSourceConfig,
} from '../config/types.ts'
import { createFactsDbClient, type FactsDbClient } from '../db/client.ts'
import { loadCompiledConfig } from '../config/load_compiled_config.ts'
import { pipelineItems, sourceRuns } from '../infrastructure/sqlite/schema.ts'

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
  parser: 'syndication' | 'xquery' | 'summary'
  transport: 'http' | 'byparr' | 'summary'
  sourceUrl?: string
  deliveryCount: number
  deliveryKinds: Array<'file' | 'push' | 'email'>
  lastRun?: ReaderRunSummary
  feed?: ReaderFeedSnapshot
  entries: ReaderEntrySnapshot[]
}

export interface ReaderOverview {
  sources: ReaderSourceOverview[]
  issue?: string
}

function getReaderConfigLookup(): {
  runtimeDir: string
  configPath?: string
} {
  const configPath = Deno.env.get('KNOCK_CONFIG_PATH')
  if (configPath) {
    const resolvedConfigPath = resolve(configPath)
    return {
      runtimeDir: dirname(resolvedConfigPath),
      configPath: resolvedConfigPath,
    }
  }

  return {
    runtimeDir: resolve(Deno.env.get('KNOCK_RUNTIME_DIR') ?? join(Deno.cwd(), 'runtime')),
  }
}

function normalizeReaderIssue(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('配置文件不存在:')) {
    return '未找到 runtime 配置，Reader 暂时无法加载 source 列表。'
  }

  return `读取 Reader 数据失败：${message}`
}

async function loadReaderConfig(): Promise<AppConfigResolved> {
  const lookup = getReaderConfigLookup()
  const loaded = await loadCompiledConfig({
    runtimeDir: lookup.runtimeDir,
    configPath: lookup.configPath,
    envMode: 'preserve_unknown',
  })
  return loaded.config
}

function parseJsonRecord(
  value: string | null,
  fieldName: string,
): Record<string, unknown> | undefined {
  if (value === null) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`${fieldName} 不是合法 JSON: ${reason}`)
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} 必须是对象`)
  }

  return parsed as Record<string, unknown>
}

function assertString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} 必须是字符串`)
  }

  return value
}

function assertNonNegativeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} 必须是非负整数`)
  }

  return value
}

function parseRunCounts(value: string): ReaderRunSummary['counts'] {
  const record = parseJsonRecord(value, 'source_runs.counts_json')
  if (!record) {
    throw new Error('source_runs.counts_json 缺失')
  }

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

function parseFeedSnapshot(value: string | null): ReaderFeedSnapshot | undefined {
  const record = parseJsonRecord(value, 'source_runs.feed_json')
  if (!record) return undefined

  return {
    title: typeof record.title === 'string' ? record.title : '',
    link: typeof record.link === 'string' ? record.link : '',
    description: typeof record.description === 'string' ? record.description : '',
    generator: typeof record.generator === 'string' ? record.generator : '',
    language: typeof record.language === 'string' ? record.language : '',
    published: typeof record.published === 'string' ? record.published : '',
  }
}

function parseEntrySnapshot(row: {
  itemId: string
  status: string
  normalizedJson: string
}): ReaderEntrySnapshot {
  const record = parseJsonRecord(row.normalizedJson, 'pipeline_items.normalized_json')
  if (!record) {
    throw new Error('pipeline_items.normalized_json 缺失')
  }

  return {
    itemId: row.itemId,
    status: row.status,
    id: assertString(record.id, 'pipeline_items.normalized_json.id'),
    title: assertString(record.title, 'pipeline_items.normalized_json.title'),
    link: assertString(record.link, 'pipeline_items.normalized_json.link'),
    description: assertString(record.description, 'pipeline_items.normalized_json.description'),
    content: assertString(record.content, 'pipeline_items.normalized_json.content'),
    published: assertString(record.published, 'pipeline_items.normalized_json.published'),
    updated: assertString(record.updated, 'pipeline_items.normalized_json.updated'),
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

function getDeliveryKind(delivery: ResolvedDeliveryConfig): 'file' | 'push' | 'email' {
  if (delivery.file) return 'file'
  if (delivery.push) return 'push'
  if (delivery.email) return 'email'
  throw new Error(`delivery 缺少可识别类型: ${delivery.id}`)
}

function toLastRun(row: {
  runId: string
  status: string
  startedAt: string
  finishedAt: string | null
  countsJson: string
}): ReaderRunSummary {
  return {
    runId: row.runId,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? undefined,
    counts: parseRunCounts(row.countsJson),
  }
}

export function buildReaderOverview(input: {
  config: AppConfigResolved
  factsDb: FactsDbClient
}): ReaderOverview {
  const sources = input.config.sources.map((source) => {
    const lastRunRow = input.factsDb
      .select({
        runId: sourceRuns.runId,
        status: sourceRuns.status,
        startedAt: sourceRuns.startedAt,
        finishedAt: sourceRuns.finishedAt,
        countsJson: sourceRuns.countsJson,
        feedJson: sourceRuns.feedJson,
      })
      .from(sourceRuns)
      .where(and(eq(sourceRuns.sourceId, source.id), eq(sourceRuns.effectDomain, 'production')))
      .orderBy(desc(sourceRuns.finishedAt), desc(sourceRuns.startedAt))
      .get()

    const entryRows = lastRunRow
      ? input.factsDb
          .select({
            itemId: pipelineItems.itemId,
            status: pipelineItems.status,
            normalizedJson: pipelineItems.normalizedJson,
          })
          .from(pipelineItems)
          .where(
            and(
              eq(pipelineItems.sourceRunId, lastRunRow.runId),
              eq(pipelineItems.effectDomain, 'production'),
            ),
          )
          .all()
      : []

    return {
      id: source.id,
      name: source.name?.trim() || source.id,
      enabled: source.enabled,
      schedule: source.schedule,
      parser: getParser(source),
      transport: getTransport(source),
      sourceUrl: getSourceUrl(source),
      deliveryCount: source.deliveries.length,
      deliveryKinds: Array.from(new Set(source.deliveries.map(getDeliveryKind))),
      lastRun: lastRunRow ? toLastRun(lastRunRow) : undefined,
      feed: lastRunRow ? parseFeedSnapshot(lastRunRow.feedJson) : undefined,
      entries: sortEntries(entryRows.map(parseEntrySnapshot)).slice(0, 80),
    } satisfies ReaderSourceOverview
  })

  return { sources }
}

export async function loadReaderOverview(): Promise<ReaderOverview> {
  let factsDb: FactsDbClient | undefined

  try {
    const config = await loadReaderConfig()
    factsDb = createFactsDbClient({ sqlite: config.sqlite })
    return await buildReaderOverview({ config, factsDb })
  } catch (error) {
    return {
      sources: [],
      issue: normalizeReaderIssue(error),
    }
  } finally {
    factsDb?.$client.close()
  }
}
