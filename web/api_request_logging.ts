import { createLogger, type Logger } from '../src/core/logger.ts'
import type { EvaluateLogMeta } from '../src/interfaces/web/create_playground_evaluate_handler.ts'
import type { SourceActionLogMeta } from '../src/interfaces/web/create_source_action_handler.ts'
import { getCurrentWebLoggingRuntime } from '../src/interfaces/web/start_web.ts'

type LoggedRequest = Request | { req: Request }

function createWebRequestId(now: number = Date.now()): string {
  return `web.${now.toString(36)}.${crypto.randomUUID()}`
}

function createDefaultWebLogger(): Logger {
  const loggingRuntime = getCurrentWebLoggingRuntime()
  return createLogger({
    enabled: true,
    level: loggingRuntime?.logging.level ?? 'info',
    module: 'web.api',
    component: 'web',
    timezone: loggingRuntime?.timezone ?? 'UTC',
    timestampFormat: loggingRuntime?.timestampFormat ?? 'yyyy-MM-dd HH:mm:ss',
  })
}

function isEvaluateLogMeta(meta: EvaluateLogMeta | SourceActionLogMeta): meta is EvaluateLogMeta {
  return (
    'targetHost' in meta ||
    'parser' in meta ||
    'warningCount' in meta ||
    'entryCount' in meta ||
    'fetchDurationMs' in meta ||
    'parseDurationMs' in meta
  )
}

function isSourceActionLogMeta(
  meta: EvaluateLogMeta | SourceActionLogMeta,
): meta is SourceActionLogMeta {
  return (
    'sourceId' in meta ||
    'action' in meta ||
    'started' in meta ||
    'deletedRuns' in meta ||
    'deletedItems' in meta ||
    'deletedAttempts' in meta
  )
}

function normalizeLoggedRequest(input: LoggedRequest): Request {
  return input instanceof Request ? input : input.req
}

export function withApiRequestLogging(
  route: string,
  module: string,
  handler: (
    request: Request,
    onLogMeta: (meta: EvaluateLogMeta | SourceActionLogMeta) => void,
  ) => Promise<Response>,
  logger?: Logger,
) {
  return async (input: LoggedRequest) => {
    const request = normalizeLoggedRequest(input)
    const routeLogger = (logger ?? createDefaultWebLogger()).child({ module, route })
    const startedAt = Date.now()
    const requestId = createWebRequestId(startedAt)
    let logMeta: EvaluateLogMeta | SourceActionLogMeta = {}

    routeLogger.debug('API 请求开始', {
      'web.operation': 'request',
      'web.outcome': 'start',
      method: request.method,
      'web.request_id': requestId,
    })

    const response = await handler(request, (meta) => {
      logMeta = meta
    })
    const evaluateMeta = isEvaluateLogMeta(logMeta) ? logMeta : undefined
    const sourceActionMeta = isSourceActionLogMeta(logMeta) ? logMeta : undefined
    const fields = {
      'web.operation': 'request',
      'web.outcome': response.ok ? 'success' : 'failure',
      method: request.method,
      'web.duration_ms': Date.now() - startedAt,
      http_status: response.ok ? undefined : response.status,
      'web.request_id': requestId,
      ...(evaluateMeta?.targetHost ? { 'web.target_host': evaluateMeta.targetHost } : {}),
      ...(evaluateMeta?.parser ? { 'source.parser': evaluateMeta.parser } : {}),
      ...(evaluateMeta?.warningCount !== undefined
        ? { 'pipeline.warning_count': evaluateMeta.warningCount }
        : {}),
      ...(evaluateMeta?.entryCount !== undefined
        ? { 'pipeline.entry_count': evaluateMeta.entryCount }
        : {}),
      ...(evaluateMeta?.fetchDurationMs !== undefined
        ? { 'source.fetch_duration_ms': evaluateMeta.fetchDurationMs }
        : {}),
      ...(evaluateMeta?.parseDurationMs !== undefined
        ? { 'source.parse_duration_ms': evaluateMeta.parseDurationMs }
        : {}),
      ...(sourceActionMeta?.sourceId ? { 'source.id': sourceActionMeta.sourceId } : {}),
      ...(sourceActionMeta?.action ? { 'web.action': sourceActionMeta.action } : {}),
      ...(sourceActionMeta?.started !== undefined
        ? { 'scheduler.started': sourceActionMeta.started }
        : {}),
      ...(sourceActionMeta?.deletedRuns !== undefined
        ? { 'db.deleted_runs': sourceActionMeta.deletedRuns }
        : {}),
      ...(sourceActionMeta?.deletedItems !== undefined
        ? { 'db.deleted_items': sourceActionMeta.deletedItems }
        : {}),
      ...(sourceActionMeta?.deletedAttempts !== undefined
        ? { 'db.deleted_attempts': sourceActionMeta.deletedAttempts }
        : {}),
      ...(logMeta.errorCode ? { 'web.error_code': logMeta.errorCode } : {}),
      ...(logMeta.errorCategory ? { 'web.error_category': logMeta.errorCategory } : {}),
      ...(logMeta.errorMessage ? { 'exception.message': logMeta.errorMessage } : {}),
    }

    if (response.ok) {
      routeLogger.info('API 请求完成', fields)
    } else {
      routeLogger.error('API 请求失败', fields)
    }

    return response
  }
}
