import type { ReaderOverview } from '../../web/reader_overview.ts'
import type { SourceManagementError } from './source_management.ts'
import { executeWebAction } from './web_action_executor.ts'

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
    return executeWebAction(request, {
      requireSameOrigin: true,
      run: deps.runAction ?? options.runAction,
      classifyError: (error) => {
        const classified = options.classifyError(error)
        return {
          ...classified,
          message:
            classified.category === 'internal'
              ? 'source 操作失败，请查看服务端日志。'
              : classified.message,
        }
      },
      forbidden: {
        message: 'source 写请求必须来自同源页面',
        code: 'source_action_forbidden',
        category: 'forbidden',
      },
      invalidJson: {
        message: 'source 请求非法',
        code: 'source_request_invalid',
        category: 'validation',
      },
      onLogMeta: deps.onLogMeta,
      onForbiddenMeta: () => ({
        action: options.action,
        errorCode: 'source_action_forbidden',
        errorCategory: 'forbidden',
        errorMessage: 'source 写请求必须来自同源页面',
      }),
      onInvalidJsonMeta: () => ({
        action: options.action,
        errorCode: 'source_request_invalid',
        errorCategory: 'validation',
        errorMessage: 'source 请求非法',
      }),
      onSuccessMeta: (payload, result) => ({
        sourceId: readSourceId(payload),
        action: options.action,
        started: result.started,
        deletedRuns: result.deletedRuns,
        deletedItems: result.deletedItems,
        deletedAttempts: result.deletedAttempts,
      }),
      onErrorMeta: (payload, error, classified) => {
        void error
        return {
          sourceId: readSourceId(payload),
          action: options.action,
          errorCode: classified.code,
          errorCategory: classified.category,
          errorMessage: classified.message,
        }
      },
    })
  }
}
