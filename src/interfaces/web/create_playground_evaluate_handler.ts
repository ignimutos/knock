import { executeWebAction } from './web_action_executor.ts'

export interface EvaluateResult {
  warnings: string[]
  fetchMeta: {
    ok: boolean
    payloadBytes?: number
    fetchDurationMs?: number
    parseDurationMs?: number
  }
  parser: string
  rawContent: string
  feed: unknown
  entries: unknown[]
}

export interface EvaluateLogMeta {
  targetHost?: string
  parser?: string
  warningCount?: number
  entryCount?: number
  fetchDurationMs?: number
  parseDurationMs?: number
  errorCode?: string
  errorCategory?: string
  errorMessage?: string
}

export interface EvaluateHandlerDeps {
  evaluatePlayground?: (input: { request: unknown }) => Promise<EvaluateResult>
  onLogMeta?: (meta: EvaluateLogMeta) => void
}

export interface ClassifiedEvaluateError {
  status: number
  message: string
  code: string
  category: string
}

interface CreatePlaygroundEvaluateHandlerOptions {
  evaluatePlayground: (input: { request: unknown }) => Promise<EvaluateResult>
  classifyError: (error: unknown) => ClassifiedEvaluateError
}

function readTargetHost(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const url = (payload as Record<string, unknown>).url
  if (typeof url !== 'string') return undefined
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

export function createPlaygroundEvaluateHandler(options: CreatePlaygroundEvaluateHandlerOptions) {
  return async function handler(
    request: Request,
    deps: EvaluateHandlerDeps = {},
  ): Promise<Response> {
    return executeWebAction(request, {
      requireSameOrigin: false,
      run: async (payload) =>
        await (deps.evaluatePlayground ?? options.evaluatePlayground)({ request: payload }),
      classifyError: options.classifyError,
      forbidden: {
        message: 'forbidden',
        code: 'forbidden',
        category: 'forbidden',
      },
      invalidJson: {
        message: 'Playground 请求非法',
        code: 'playground_request_invalid',
        category: 'validation',
      },
      onLogMeta: deps.onLogMeta,
      onInvalidJsonMeta: () => ({
        errorCode: 'playground_request_invalid',
        errorCategory: 'validation',
        errorMessage: 'Playground 请求非法',
      }),
      onSuccessMeta: (payload, result) => ({
        targetHost: readTargetHost(payload),
        parser: result.parser,
        warningCount: result.warnings.length,
        entryCount: result.entries.length,
        fetchDurationMs: result.fetchMeta.fetchDurationMs,
        parseDurationMs: result.fetchMeta.parseDurationMs,
      }),
      onErrorMeta: (payload, error, classified) => ({
        targetHost: readTargetHost(payload),
        errorCode: classified.code,
        errorCategory: classified.category,
        errorMessage: error instanceof Error ? error.message : classified.message,
      }),
    })
  }
}
