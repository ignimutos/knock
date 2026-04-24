import { and, eq } from 'drizzle-orm'
import type { SourceDeliveryOverride } from '../../config/types.ts'
import {
  getConfigDocumentLookupFromEnv,
  loadRawConfigDocument,
  writeValidatedConfigDocument,
} from '../../config/raw_config_document.ts'
import {
  applySourceConfigDocumentUpdate,
  SourceConfigDocumentUpdateError,
} from '../../config/update_source_document.ts'
import {
  parseSourceConfigUpdate,
  SourceManagementContractError,
} from './source_management_contract.ts'
import { loadSourceActionContext, SourceActionContextError } from './source_management_context.ts'
import { throwConflict, throwNotFound, throwValidation } from './source_management_errors.ts'
import { createFactsDbClient, runInTransaction } from '../../db/client.ts'
import { sourceRuns } from '../../infrastructure/sqlite/schema.ts'
import { buildCurrentReaderOverview, type ReaderOverview } from '../../web/reader_overview.ts'
import { restoreConfigSecrets } from '../../web/config_secret_redaction.ts'

export { classifySourceManagementError, SourceManagementError } from './source_management_errors.ts'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cloneRecord(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? structuredClone(value) : {}
}

export async function updateSourceConfig(input: unknown): Promise<{
  message: string
  overview: ReaderOverview
}> {
  let request
  try {
    request = parseSourceConfigUpdate(input)
  } catch (error) {
    if (error instanceof SourceManagementContractError) {
      throwValidation(error.message)
    }
    throw error
  }
  const loaded = await loadRawConfigDocument(getConfigDocumentLookupFromEnv())
  const currentSource = cloneRecord(cloneRecord(loaded.document.sources)[request.sourceId])
  const currentOverrides = cloneRecord(currentSource.deliveries)
  const deliveryOverrides = Object.fromEntries(
    Object.entries(request.deliveryOverrides).map(([deliveryId, override]) => [
      deliveryId,
      restoreConfigSecrets(override, currentOverrides[deliveryId]) as SourceDeliveryOverride,
    ]),
  )

  try {
    applySourceConfigDocumentUpdate(loaded.document, {
      ...request,
      deliveryOverrides,
    })
  } catch (error) {
    if (error instanceof SourceConfigDocumentUpdateError) {
      if (error.kind === 'not_found') {
        throwNotFound(error.message)
      }
      throwValidation(error.message)
    }
    throw error
  }
  let overviewLoaded
  try {
    overviewLoaded = await writeValidatedConfigDocument(loaded)
  } catch (error) {
    if (error instanceof Error) {
      throwValidation(error.message)
    }
    throw error
  }

  return {
    message: `source ${request.sourceId} 配置已保存`,
    overview: await buildCurrentReaderOverview({
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
  let context
  try {
    context = await loadSourceActionContext(input)
  } catch (error) {
    if (error instanceof SourceActionContextError) {
      if (error.kind === 'not_found') {
        throwNotFound(error.message)
      }
      throwValidation(error.message)
    }
    throw error
  }
  if (!context.source.enabled) {
    throwConflict(`source ${context.request.sourceId} 已停用，不能强制获取`)
  }

  const { createProductionRuntime } = await import('../../composition/create_production_runtime.ts')
  const runtime = createProductionRuntime({
    config: context.loaded.config,
    definitions: context.loaded.definitions,
    keepAlive: false,
  })

  try {
    const result = await runtime.runSourceNow(context.request.sourceId)
    return {
      started: result.started,
      message: result.started
        ? `source ${context.request.sourceId} 强制获取完成`
        : `source ${context.request.sourceId} 正在运行，已跳过本次强制获取`,
      overview: await buildCurrentReaderOverview({ loaded: context.loaded }),
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
  let context
  try {
    context = await loadSourceActionContext(input)
  } catch (error) {
    if (error instanceof SourceActionContextError) {
      if (error.kind === 'not_found') {
        throwNotFound(error.message)
      }
      throwValidation(error.message)
    }
    throw error
  }

  const factsDb = createFactsDbClient({ sqlite: context.loaded.config.sqlite })
  try {
    const effectDomain = 'production'
    const running = factsDb
      .select({ runId: sourceRuns.runId })
      .from(sourceRuns)
      .where(
        and(
          eq(sourceRuns.sourceId, context.request.sourceId),
          eq(sourceRuns.effectDomain, effectDomain),
          eq(sourceRuns.status, 'running'),
        ),
      )
      .get()
    if (running) {
      throwConflict(`source ${context.request.sourceId} 正在运行，不能清空历史`)
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
        deleteAttempts.run(effectDomain, context.request.sourceId, effectDomain).changes,
      )
      const deletedItems = Number(
        deleteItems.run(effectDomain, context.request.sourceId, effectDomain).changes,
      )
      const deletedRuns = Number(deleteRuns.run(context.request.sourceId, effectDomain).changes)

      return {
        deletedRuns,
        deletedItems,
        deletedAttempts,
      }
    })

    return {
      ...result,
      message: `source ${context.request.sourceId} 历史已清空`,
      overview: await buildCurrentReaderOverview({ loaded: context.loaded, factsDb }),
    }
  } finally {
    factsDb.$client.close()
  }
}
