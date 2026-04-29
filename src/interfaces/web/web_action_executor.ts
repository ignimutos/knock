import { isSameOriginWriteRequest } from './same_origin_write.ts'

export interface WebActionErrorBody {
  message: string
  code: string
  category: string
}

export interface ClassifiedWebActionError extends WebActionErrorBody {
  status: number
}

export interface ExecuteWebActionOptions<TResult, TMeta = unknown> {
  requireSameOrigin: boolean
  run: (payload: unknown) => Promise<TResult>
  classifyError: (error: unknown) => ClassifiedWebActionError
  forbidden: WebActionErrorBody
  invalidJson: WebActionErrorBody
  onSuccessMeta?: (payload: unknown, result: TResult) => TMeta
  onErrorMeta?: (
    payload: unknown | undefined,
    error: unknown,
    classified: ClassifiedWebActionError,
  ) => TMeta
  onForbiddenMeta?: () => TMeta
  onInvalidJsonMeta?: () => TMeta
  onLogMeta?: (meta: TMeta) => void
}

export async function executeWebAction<TResult, TMeta = unknown>(
  request: Request,
  options: ExecuteWebActionOptions<TResult, TMeta>,
): Promise<Response> {
  if (options.requireSameOrigin && !isSameOriginWriteRequest(request)) {
    if (options.onForbiddenMeta) {
      options.onLogMeta?.(options.onForbiddenMeta())
    }
    return Response.json(options.forbidden, { status: 403 })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    if (options.onInvalidJsonMeta) {
      options.onLogMeta?.(options.onInvalidJsonMeta())
    }
    return Response.json(options.invalidJson, { status: 400 })
  }

  try {
    const result = await options.run(payload)
    if (options.onSuccessMeta) {
      options.onLogMeta?.(options.onSuccessMeta(payload, result))
    }
    return Response.json(result)
  } catch (error) {
    const classified = options.classifyError(error)
    if (options.onErrorMeta) {
      options.onLogMeta?.(options.onErrorMeta(payload, error, classified))
    }
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
