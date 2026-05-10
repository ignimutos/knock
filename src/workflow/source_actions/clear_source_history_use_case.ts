import type { AppConfigResolved } from '../../config/types.ts'
import type { LoadedCompiledConfig } from '../../config/load_compiled_config.ts'
import { createDbClient, runInTransaction } from '../../persistence/sqlite/client.ts'
import { buildCurrentReaderOverview } from '../../config/reader_overview.ts'
import type { ReaderOverview } from '../../contracts/workbench.ts'

export interface ClearSourceHistoryUseCaseResult {
  message: string
  deletedRuns: number
  deletedItems: number
  deletedAttempts: number
  overview: ReaderOverview
}

export class ClearSourceHistoryUseCaseError extends Error {
  constructor(
    message: string,
    readonly kind: 'validation' | 'not_found' | 'conflict',
  ) {
    super(message)
    this.name = 'ClearSourceHistoryUseCaseError'
  }
}

interface SourceActionContext {
  request: {
    sourceId: string
  }
  loaded: LoadedCompiledConfig
  source: AppConfigResolved['sources'][number]
}

type SourceActionContextErrorKind = 'validation' | 'not_found'

type LoadSourceActionContext = (input: unknown) => Promise<SourceActionContext>

function isSourceActionContextError(error: unknown): error is {
  message: string
  kind: SourceActionContextErrorKind
} {
  if (!(error instanceof Error)) {
    return false
  }
  const kind = (error as { kind?: unknown }).kind
  return kind === 'validation' || kind === 'not_found'
}

export class ClearSourceHistoryUseCase {
  constructor(private readonly loadContext: LoadSourceActionContext) {}

  async execute(input: unknown): Promise<ClearSourceHistoryUseCaseResult> {
    let context: SourceActionContext
    try {
      context = await this.loadContext(input)
    } catch (error) {
      if (isSourceActionContextError(error)) {
        throw new ClearSourceHistoryUseCaseError(error.message, error.kind)
      }
      throw error
    }

    const factsDb = createDbClient({ sqlite: context.loaded.config.sqlite })
    try {
      const effectDomain = 'production'
      const running = factsDb.$client
        .prepare(
          `
          SELECT run_id AS runId
          FROM source_runs
          WHERE source_id = ?
            AND effect_domain = ?
            AND status = 'running'
          LIMIT 1
        `,
        )
        .get(context.request.sourceId, effectDomain)
      if (running) {
        throw new ClearSourceHistoryUseCaseError(
          `source ${context.request.sourceId} 正在运行，不能清空历史`,
          'conflict',
        )
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
}
