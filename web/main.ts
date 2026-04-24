import { App, staticFiles } from 'fresh'
import { createLogger, type Logger } from '../src/core/logger.ts'
import AppDocument from './routes/_app.tsx'
import IndexPage from './routes/index.tsx'
import ReaderPage from './routes/reader.tsx'
import ConfigPage from './routes/config.tsx'
import XqueryPage from './routes/xquery.tsx'
import SyndicationPage from './routes/syndication.tsx'
import { loadReaderOverview } from '../src/web/reader_overview.ts'
import { loadConfigWorkbenchOverview } from '../src/web/config_workbench_overview.ts'
import type { EvaluateLogMeta } from '../src/interfaces/web/create_playground_evaluate_handler.ts'
import type { SourceActionLogMeta } from '../src/interfaces/web/create_source_action_handler.ts'
import { getCurrentWebLoggingRuntime } from '../src/interfaces/web/start_web.ts'

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

export function withApiRequestLogging(
  route: string,
  module: string,
  handler: (
    request: Request,
    onLogMeta: (meta: EvaluateLogMeta | SourceActionLogMeta) => void,
  ) => Promise<Response>,
  logger?: Logger,
) {
  return async (ctx: { req: Request }) => {
    const routeLogger = (logger ?? createDefaultWebLogger()).child({ module, route })
    const startedAt = Date.now()
    const requestId = createWebRequestId(startedAt)
    let logMeta: EvaluateLogMeta | SourceActionLogMeta = {}

    routeLogger.debug('API 请求开始', {
      'web.operation': 'request',
      'web.outcome': 'start',
      method: ctx.req.method,
      'web.request_id': requestId,
    })

    const response = await handler(ctx.req, (meta) => {
      logMeta = meta
    })
    const level = response.ok ? 'info' : 'error'
    const evaluateMeta = isEvaluateLogMeta(logMeta) ? logMeta : undefined
    const sourceActionMeta = isSourceActionLogMeta(logMeta) ? logMeta : undefined
    routeLogger[level](response.ok ? 'API 请求完成' : 'API 请求失败', {
      'web.operation': 'request',
      'web.outcome': response.ok ? 'success' : 'failure',
      method: ctx.req.method,
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
    })
    return response
  }
}

export const app = new App()
  .use(staticFiles())
  .appWrapper(AppDocument)
  .get('/', (ctx) => ctx.render(IndexPage()))
  .get('/reader', async (ctx) => {
    const overview = await loadReaderOverview()
    return ctx.render(ReaderPage({ overview }))
  })
  .get(
    '/api/reader/overview',
    withApiRequestLogging('/api/reader/overview', 'web.api.reader.overview', async (request) => {
      const { handler } = await import('./routes/api/reader/overview.ts')
      return await handler(request)
    }),
  )
  .get('/config', async (ctx) => {
    const workbench = await loadConfigWorkbenchOverview()
    return ctx.render(ConfigPage({ workbench }))
  })
  .get('/xquery', (ctx) => ctx.render(XqueryPage()))
  .get('/syndication', (ctx) => ctx.render(SyndicationPage()))
  .post(
    '/api/xquery/evaluate',
    withApiRequestLogging(
      '/api/xquery/evaluate',
      'web.api.xquery.evaluate',
      async (request, onLogMeta) => {
        const { handler } = await import('./routes/api/xquery/evaluate.ts')
        return await handler(request, { onLogMeta })
      },
    ),
  )
  .post(
    '/api/syndication/evaluate',
    withApiRequestLogging(
      '/api/syndication/evaluate',
      'web.api.syndication.evaluate',
      async (request, onLogMeta) => {
        const { handler } = await import('./routes/api/syndication/evaluate.ts')
        return await handler(request, { onLogMeta })
      },
    ),
  )
  .post(
    '/api/config/global',
    withApiRequestLogging('/api/config/global', 'web.api.config.global', async (request) => {
      const { handler } = await import('./routes/api/config/global.ts')
      return await handler(request)
    }),
  )
  .post(
    '/api/config/deliveries',
    withApiRequestLogging(
      '/api/config/deliveries',
      'web.api.config.deliveries',
      async (request) => {
        const { handler } = await import('./routes/api/config/deliveries.ts')
        return await handler(request)
      },
    ),
  )
  .post(
    '/api/config/deliveries/delete',
    withApiRequestLogging(
      '/api/config/deliveries/delete',
      'web.api.config.deliveries.delete',
      async (request) => {
        const { handler } = await import('./routes/api/config/deliveries_delete.ts')
        return await handler(request)
      },
    ),
  )
  .post(
    '/api/sources/update',
    withApiRequestLogging(
      '/api/sources/update',
      'web.api.sources.update',
      async (request, onLogMeta) => {
        const { handler } = await import('./routes/api/sources/update.ts')
        return await handler(request, { onLogMeta })
      },
    ),
  )
  .post(
    '/api/sources/run',
    withApiRequestLogging('/api/sources/run', 'web.api.sources.run', async (request, onLogMeta) => {
      const { handler } = await import('./routes/api/sources/run.ts')
      return await handler(request, { onLogMeta })
    }),
  )
  .post(
    '/api/sources/clear',
    withApiRequestLogging(
      '/api/sources/clear',
      'web.api.sources.clear',
      async (request, onLogMeta) => {
        const { handler } = await import('./routes/api/sources/clear.ts')
        return await handler(request, { onLogMeta })
      },
    ),
  )

export default app
