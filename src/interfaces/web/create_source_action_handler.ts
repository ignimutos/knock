import type { ReaderOverview } from '../../web/reader_overview.ts'
import type { SourceManagementError } from './source_management.ts'

export interface SourceActionSuccessResult {
  message: string
  overview: ReaderOverview
  started?: boolean
  deletedRuns?: number
  deletedItems?: number
  deletedAttempts?: number
}

export interface SourceActionLogMeta {
  sourceId?: string
  action?: 'update_config' | 'run_now' | 'clear_history'
  started?: boolean
  deletedRuns?: number
  deletedItems?: number
  deletedAttempts?: number
  errorCode?: string
  errorCategory?: string
  errorMessage?: string
}

export interface SourceActionHandlerDeps {
  runAction?: (payload: unknown) => Promise<SourceActionSuccessResult>
  onLogMeta?: (meta: SourceActionLogMeta) => void
}

interface CreateSourceActionHandlerOptions {
  runAction: (payload: unknown) => Promise<SourceActionSuccessResult>
  classifyError: (error: unknown) => SourceManagementError
  action: 'update_config' | 'run_now' | 'clear_history'
}

function readSourceId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const sourceId = (payload as Record<string, unknown>).sourceId
  return typeof sourceId === 'string' && sourceId.trim() !== '' ? sourceId.trim() : undefined
}

export function createSourceActionHandler(options: CreateSourceActionHandlerOptions) {
  return async function handler(
    request: Request,
    deps: SourceActionHandlerDeps = {},
  ): Promise<Response> {
    const runAction = deps.runAction ?? options.runAction

    let payload: unknown
    try {
      payload = await request.json()
    } catch {
      deps.onLogMeta?.({
        action: options.action,
        errorCode: 'source_request_invalid',
        errorCategory: 'validation',
        errorMessage: 'source 请求非法',
      })
      return Response.json(
        {
          message: 'source 请求非法',
          code: 'source_request_invalid',
          category: 'validation',
        },
        { status: 400 },
      )
    }

    const sourceId = readSourceId(payload)

    try {
      const result = await runAction(payload)
      deps.onLogMeta?.({
        sourceId,
        action: options.action,
        started: result.started,
        deletedRuns: result.deletedRuns,
        deletedItems: result.deletedItems,
        deletedAttempts: result.deletedAttempts,
      })
      return Response.json(result)
    } catch (error) {
      const classified = options.classifyError(error)
      deps.onLogMeta?.({
        sourceId,
        action: options.action,
        errorCode: classified.code,
        errorCategory: classified.category,
        errorMessage: classified.message,
      })
      return Response.json(
        {
          message: classified.message,
          code: classified.code,
          category: classified.category,
        },
        { status: classified.status },
      )
    }
  }
}
