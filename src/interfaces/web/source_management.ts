import { dirname, join, resolve } from '@std/path'
import { stringify } from '@std/yaml'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createProductionRuntime } from '../../composition/create_production_runtime.ts'
import {
  findConfigFile,
  loadCompiledConfig,
  parseRawConfigDocument,
} from '../../config/load_compiled_config.ts'
import { validateConfig } from '../../config/validate_config.ts'
import { createFactsDbClient, runInTransaction } from '../../db/client.ts'
import { deliveryAttempts, pipelineItems, sourceRuns } from '../../infrastructure/sqlite/schema.ts'
import type { ReaderOverview } from '../../web/reader_overview.ts'
import { loadReaderOverview } from '../../web/reader_overview.ts'

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

const sourceConfigUpdateSchema = z
  .object({
    sourceId: requiredStringSchema,
    name: z.string().default(''),
    enabled: z.boolean(),
    schedule: z.string().default(''),
    filter: z.string().default(''),
    deliveryIds: z.array(z.string()).default([]),
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

function updateDeliveryOverrides(source: Record<string, unknown>, nextDeliveryIds: string[]): void {
  const existing = isPlainObject(source.deliveries) ? source.deliveries : {}
  const next: Record<string, unknown> = {}

  for (const deliveryId of nextDeliveryIds) {
    next[deliveryId] = isPlainObject(existing[deliveryId])
      ? structuredClone(existing[deliveryId])
      : {}
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
  updateDeliveryOverrides(source, input.deliveryIds)

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
}): Promise<void> {
  validateConfig({
    ...input.document,
    runtimeDir: input.runtimeDir,
  })
  await Deno.writeTextFile(input.configPath, stringify(input.document))
}

async function loadFreshOverview(): Promise<ReaderOverview> {
  return await loadReaderOverview()
}

export async function updateSourceConfig(input: unknown): Promise<{
  message: string
  overview: ReaderOverview
}> {
  const request = parseSourceConfigUpdate(input)
  const loaded = await loadRawConfigDocument()
  applySourceConfigUpdate(loaded.document, request)
  await writeValidatedConfigDocument(loaded)

  return {
    message: `source ${request.sourceId} 配置已保存`,
    overview: await loadFreshOverview(),
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
      overview: await loadFreshOverview(),
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
    const running = factsDb
      .select({ runId: sourceRuns.runId })
      .from(sourceRuns)
      .where(
        and(
          eq(sourceRuns.sourceId, request.sourceId),
          eq(sourceRuns.effectDomain, 'production'),
          eq(sourceRuns.status, 'running'),
        ),
      )
      .get()
    if (running) {
      throwConflict(`source ${request.sourceId} 正在运行，不能清空历史`)
    }

    const result = runInTransaction(factsDb, () => {
      const runIds = factsDb
        .select({ runId: sourceRuns.runId })
        .from(sourceRuns)
        .where(
          and(eq(sourceRuns.sourceId, request.sourceId), eq(sourceRuns.effectDomain, 'production')),
        )
        .all()
        .map((row) => row.runId)

      if (runIds.length === 0) {
        return {
          deletedRuns: 0,
          deletedItems: 0,
          deletedAttempts: 0,
        }
      }

      let deletedAttempts = 0
      let deletedItems = 0
      for (const runId of runIds) {
        deletedAttempts += Number(
          factsDb
            .delete(deliveryAttempts)
            .where(
              and(
                eq(deliveryAttempts.sourceRunId, runId),
                eq(deliveryAttempts.effectDomain, 'production'),
              ),
            )
            .run().changes,
        )
        deletedItems += Number(
          factsDb
            .delete(pipelineItems)
            .where(
              and(
                eq(pipelineItems.sourceRunId, runId),
                eq(pipelineItems.effectDomain, 'production'),
              ),
            )
            .run().changes,
        )
      }

      const deletedRuns = factsDb
        .delete(sourceRuns)
        .where(
          and(eq(sourceRuns.sourceId, request.sourceId), eq(sourceRuns.effectDomain, 'production')),
        )
        .run().changes

      return {
        deletedRuns: Number(deletedRuns),
        deletedItems: Number(deletedItems),
        deletedAttempts: Number(deletedAttempts),
      }
    })

    return {
      ...result,
      message: `source ${request.sourceId} 历史已清空`,
      overview: await loadFreshOverview(),
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
