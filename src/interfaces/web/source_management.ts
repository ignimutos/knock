import { dirname, join, resolve } from '@std/path'
import { stringify } from '@std/yaml'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createProductionRuntime } from '../../composition/create_production_runtime.ts'
import { httpPayloadSchema } from '../../config/schema.ts'
import type { SourceDeliveryOverride } from '../../config/types.ts'
import {
  compileConfigDocument,
  findConfigFile,
  loadCompiledConfig,
  parseRawConfigDocument,
} from '../../config/load_compiled_config.ts'
import { createFactsDbClient, type FactsDbClient, runInTransaction } from '../../db/client.ts'
import { sourceRuns } from '../../infrastructure/sqlite/schema.ts'
import { buildReaderOverview, type ReaderOverview } from '../../web/reader_overview.ts'

export class SourceManagementError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code:
      | 'source_request_invalid'
      | 'source_not_found'
      | 'source_action_conflict'
      | 'source_action_failed',
    readonly category: 'validation' | 'not_found' | 'conflict' | 'internal',
  ) {
    super(message)
    this.name = 'SourceManagementError'
  }
}

const requiredStringSchema = z.string().trim().min(1)

const sourceDeliveryOverrideSchema: z.ZodType<SourceDeliveryOverride> = z.lazy(() =>
  z.union([
    z.object({ content: z.string().optional() }).strict(),
    z.object({ payload: httpPayloadSchema.optional() }).strict(),
    z.object({ message: z.record(z.string(), z.unknown()).optional() }).strict(),
  ]),
)

const sourceConfigUpdateSchema = z
  .object({
    sourceId: requiredStringSchema,
    name: z.string().default(''),
    enabled: z.boolean(),
    schedule: z.string().default(''),
    filter: z.string().default(''),
    deliveryIds: z.array(z.string()).default([]),
    deliveryOverrides: z.record(z.string(), sourceDeliveryOverrideSchema).default({}),
    transport: z.enum(['http', 'byparr', 'summary']),
    parser: z.enum(['syndication', 'xquery', 'summary']),
    targetUrl: z.string().default(''),
    xqueryLocate: z.string().default(''),
    xqueryEntryId: z.string().default(''),
  })
  .strict()

const sourceActionSchema = z
  .object({
    sourceId: requiredStringSchema,
  })
  .strict()

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function throwValidation(message: string): never {
  throw new SourceManagementError(message, 400, 'source_request_invalid', 'validation')
}

function throwNotFound(message: string): never {
  throw new SourceManagementError(message, 404, 'source_not_found', 'not_found')
}

function throwConflict(message: string): never {
  throw new SourceManagementError(message, 409, 'source_action_conflict', 'conflict')
}

function classifyValidationError(error: z.ZodError): never {
  const issue = error.issues[0]
  throwValidation(issue?.message || 'source 请求非法')
}

function parseSourceConfigUpdate(input: unknown) {
  const parsed = sourceConfigUpdateSchema.safeParse(input)
  if (!parsed.success) {
    classifyValidationError(parsed.error)
  }
  return parsed.data
}

function parseSourceAction(input: unknown) {
  const parsed = sourceActionSchema.safeParse(input)
  if (!parsed.success) {
    classifyValidationError(parsed.error)
  }
  return parsed.data
}

function getSourceManagementConfigLookup(): {
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

async function loadRawConfigDocument(): Promise<{
  runtimeDir: string
  configPath: string
  document: Record<string, unknown>
}> {
  const lookup = getSourceManagementConfigLookup()
  const configPath = lookup.configPath ?? (await findConfigFile(lookup.runtimeDir))
  const raw = await Deno.readTextFile(configPath)
  return {
    runtimeDir: lookup.runtimeDir,
    configPath,
    document: parseRawConfigDocument(raw),
  }
}

function getDocumentSources(document: Record<string, unknown>): Record<string, unknown> {
  const sources = document.sources
  if (!isPlainObject(sources)) {
    throwValidation('sources 配置非法')
  }
  return sources
}

function getMutableSourceDocument(
  document: Record<string, unknown>,
  sourceId: string,
): Record<string, unknown> {
  const sources = getDocumentSources(document)
  const source = sources[sourceId]
  if (!isPlainObject(source)) {
    throwNotFound(`source 未定义: ${sourceId}`)
  }
  return source
}

function setOptionalTrimmedString(
  target: Record<string, unknown>,
  key: string,
  value: string,
): void {
  const trimmed = value.trim()
  if (trimmed === '') {
    delete target[key]
    return
  }
  target[key] = trimmed
}

function updateDeliveryOverrides(
  source: Record<string, unknown>,
  nextDeliveryIds: string[],
  nextOverrides: Record<string, SourceDeliveryOverride>,
): void {
  const existing = isPlainObject(source.deliveries) ? source.deliveries : {}
  const next: Record<string, unknown> = {}

  for (const deliveryId of nextDeliveryIds) {
    const fallback = isPlainObject(existing[deliveryId])
      ? structuredClone(existing[deliveryId])
      : {}
    const override = nextOverrides[deliveryId]
    next[deliveryId] = override ? structuredClone(override) : fallback
  }

  if (Object.keys(next).length === 0) {
    delete source.deliveries
    return
  }

  source.deliveries = next
}

function buildByparrSourceConfig(
  source: Record<string, unknown>,
  nextTargetUrl: string,
): Record<string, unknown> {
  const current = isPlainObject(source.byparr) ? structuredClone(source.byparr) : {}
  const resolvedUrl =
    nextTargetUrl.trim() || (typeof current.url === 'string' ? current.url.trim() : '')
  if (resolvedUrl === '') {
    throwValidation('source.byparr.url 必填')
  }

  return {
    endpoint: 'http://byparr:8191/v1',
    cmd: 'request.get',
    maxTimeout: '60s',
    ...current,
    url: resolvedUrl,
  }
}

function buildHttpSourceConfig(
  source: Record<string, unknown>,
  nextTargetUrl: string,
): Record<string, unknown> {
  const current = isPlainObject(source.http) ? structuredClone(source.http) : {}
  const resolvedUrl =
    nextTargetUrl.trim() || (typeof current.url === 'string' ? current.url.trim() : '')
  if (resolvedUrl === '') {
    throwValidation('source.http.url 必填')
  }

  return {
    ...current,
    url: resolvedUrl,
  }
}

function updateFetchSourceConfig(
  source: Record<string, unknown>,
  input: z.output<typeof sourceConfigUpdateSchema>,
): void {
  if (input.transport === 'summary' || input.parser === 'summary') {
    throwValidation('fetch source 不支持 summary transport 或 parser')
  }

  if (input.transport === 'http') {
    source.http = buildHttpSourceConfig(source, input.targetUrl)
    delete source.byparr
  } else {
    source.byparr = buildByparrSourceConfig(source, input.targetUrl)
    delete source.http
  }

  if (input.parser === 'syndication') {
    source.syndication = isPlainObject(source.syndication)
      ? structuredClone(source.syndication)
      : {}
    delete source.xquery
    return
  }

  const currentXquery = isPlainObject(source.xquery) ? structuredClone(source.xquery) : {}
  const currentEntry = currentXquery.entry
  const nextEntryId = input.xqueryEntryId.trim()

  if (typeof currentEntry === 'string') {
    if (nextEntryId !== '') {
      currentXquery.entry = { id: nextEntryId }
    }
  } else {
    const nextEntry = isPlainObject(currentEntry) ? { ...currentEntry } : {}
    const resolvedEntryId =
      nextEntryId || (typeof nextEntry.id === 'string' ? nextEntry.id.trim() : '')
    if (resolvedEntryId === '') {
      throwValidation('xquery.entry.id 必填')
    }
    nextEntry.id = resolvedEntryId
    currentXquery.entry = nextEntry
  }

  const nextLocate = input.xqueryLocate.trim()
  if (nextLocate === '') {
    delete currentXquery.locate
  } else {
    currentXquery.locate = nextLocate
  }

  source.xquery = currentXquery
  delete source.syndication
}

function applySourceConfigUpdate(
  document: Record<string, unknown>,
  input: z.output<typeof sourceConfigUpdateSchema>,
): void {
  const source = getMutableSourceDocument(document, input.sourceId)

  setOptionalTrimmedString(source, 'name', input.name)
  source.enabled = input.enabled
  setOptionalTrimmedString(source, 'schedule', input.schedule)
  setOptionalTrimmedString(source, 'filter', input.filter)
  updateDeliveryOverrides(source, input.deliveryIds, input.deliveryOverrides)

  if ('summary' in source && source.summary !== undefined) {
    if (input.transport !== 'summary' || input.parser !== 'summary') {
      throwValidation('summary source 暂不支持在 Web 中修改 transport 或 parser')
    }
    if (
      input.targetUrl.trim() !== '' ||
      input.xqueryLocate.trim() !== '' ||
      input.xqueryEntryId.trim() !== ''
    ) {
      throwValidation('summary source 不支持抓取配置字段')
    }
    return
  }

  updateFetchSourceConfig(source, input)
}

async function writeValidatedConfigDocument(input: {
  document: Record<string, unknown>
  runtimeDir: string
  configPath: string
}) {
  const compiled = compileConfigDocument({
    document: input.document,
    runtimeDir: input.runtimeDir,
    configPath: input.configPath,
    envMode: 'preserve_unknown',
  })
  await Deno.writeTextFile(input.configPath, stringify(input.document))
  return compiled
}

async function buildCurrentOverview(input: {
  loaded: Awaited<ReturnType<typeof loadCompiledConfig>>
  factsDb?: FactsDbClient
  rawDocument?: Record<string, unknown>
}): Promise<ReaderOverview> {
  const rawDocument =
    input.rawDocument ?? parseRawConfigDocument(await Deno.readTextFile(input.loaded.configPath))
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

export async function updateSourceConfig(input: unknown): Promise<{
  message: string
  overview: ReaderOverview
}> {
  const request = parseSourceConfigUpdate(input)
  const loaded = await loadRawConfigDocument()
  applySourceConfigUpdate(loaded.document, request)
  const overviewLoaded = await writeValidatedConfigDocument(loaded)

  return {
    message: `source ${request.sourceId} 配置已保存`,
    overview: await buildCurrentOverview({
      loaded: overviewLoaded,
      rawDocument: loaded.document,
    }),
  }
}

export async function runSourceNow(input: unknown): Promise<{
  started: boolean
  message: string
  overview: ReaderOverview
}> {
  const request = parseSourceAction(input)
  const loaded = await loadCompiledConfig({
    ...getSourceManagementConfigLookup(),
    envMode: 'preserve_unknown',
  })
  const source = loaded.config.sources.find((item) => item.id === request.sourceId)
  if (!source) {
    throwNotFound(`source 未定义: ${request.sourceId}`)
  }
  if (!source.enabled) {
    throwConflict(`source ${request.sourceId} 已停用，不能强制获取`)
  }

  const runtime = createProductionRuntime({
    config: loaded.config,
    definitions: loaded.definitions,
    keepAlive: false,
  })

  try {
    const result = await runtime.runSourceNow(request.sourceId)
    return {
      started: result.started,
      message: result.started
        ? `source ${request.sourceId} 强制获取完成`
        : `source ${request.sourceId} 正在运行，已跳过本次强制获取`,
      overview: await buildCurrentOverview({ loaded }),
    }
  } finally {
    runtime.stop()
  }
}

export async function clearSourceHistory(input: unknown): Promise<{
  message: string
  deletedRuns: number
  deletedItems: number
  deletedAttempts: number
  overview: ReaderOverview
}> {
  const request = parseSourceAction(input)
  const loaded = await loadCompiledConfig({
    ...getSourceManagementConfigLookup(),
    envMode: 'preserve_unknown',
  })
  const source = loaded.config.sources.find((item) => item.id === request.sourceId)
  if (!source) {
    throwNotFound(`source 未定义: ${request.sourceId}`)
  }

  const factsDb = createFactsDbClient({ sqlite: loaded.config.sqlite })
  try {
    const effectDomain = 'production'
    const running = factsDb
      .select({ runId: sourceRuns.runId })
      .from(sourceRuns)
      .where(
        and(
          eq(sourceRuns.sourceId, request.sourceId),
          eq(sourceRuns.effectDomain, effectDomain),
          eq(sourceRuns.status, 'running'),
        ),
      )
      .get()
    if (running) {
      throwConflict(`source ${request.sourceId} 正在运行，不能清空历史`)
    }

    const deleteAttempts = factsDb.$client.prepare(`
      DELETE FROM delivery_attempts
      WHERE effect_domain = ?
        AND source_run_id IN (
          SELECT run_id
          FROM source_runs
          WHERE source_id = ? AND effect_domain = ?
        )
    `)
    const deleteItems = factsDb.$client.prepare(`
      DELETE FROM pipeline_items
      WHERE effect_domain = ?
        AND source_run_id IN (
          SELECT run_id
          FROM source_runs
          WHERE source_id = ? AND effect_domain = ?
        )
    `)
    const deleteRuns = factsDb.$client.prepare(`
      DELETE FROM source_runs
      WHERE source_id = ? AND effect_domain = ?
    `)

    const result = runInTransaction(factsDb, () => {
      const deletedAttempts = Number(
        deleteAttempts.run(effectDomain, request.sourceId, effectDomain).changes,
      )
      const deletedItems = Number(
        deleteItems.run(effectDomain, request.sourceId, effectDomain).changes,
      )
      const deletedRuns = Number(deleteRuns.run(request.sourceId, effectDomain).changes)

      return {
        deletedRuns,
        deletedItems,
        deletedAttempts,
      }
    })

    return {
      ...result,
      message: `source ${request.sourceId} 历史已清空`,
      overview: await buildCurrentOverview({ loaded, factsDb }),
    }
  } finally {
    factsDb.$client.close()
  }
}

export function classifySourceManagementError(error: unknown): SourceManagementError {
  if (error instanceof SourceManagementError) {
    return error
  }

  if (error instanceof Error) {
    return new SourceManagementError(error.message, 500, 'source_action_failed', 'internal')
  }

  return new SourceManagementError(String(error), 500, 'source_action_failed', 'internal')
}
