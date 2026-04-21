import { App, staticFiles } from 'fresh'
import type { JSX } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { createLogger, type Logger } from '../src/core/logger.ts'
import AppDocument from './routes/_app.tsx'
import IndexPage from './routes/index.tsx'
import ReaderPage from './routes/reader.tsx'
import XqueryPage from './routes/xquery.tsx'
import SyndicationPage from './routes/syndication.tsx'
import { loadReaderOverview } from '../src/web/reader_overview.ts'
import type { EvaluateLogMeta } from '../src/interfaces/web/create_playground_evaluate_handler.ts'
import type { SourceActionLogMeta } from '../src/interfaces/web/create_source_action_handler.ts'
import { handler as evaluateHandler } from './routes/api/xquery/evaluate.ts'
import { handler as evaluateSyndicationHandler } from './routes/api/syndication/evaluate.ts'
import { handler as updateSourceHandler } from './routes/api/sources/update.ts'
import { handler as runSourceHandler } from './routes/api/sources/run.ts'
import { handler as clearSourceHandler } from './routes/api/sources/clear.ts'

function createWebRequestId(now: number = Date.now()): string {
  return `web.${now.toString(36)}.${crypto.randomUUID()}`
}

function renderPage(Component: () => JSX.Element): Response {
  const html = `<!doctype html>${renderToString(AppDocument({ Component } as never))}`
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
    },
  })
}

const webLogger = createLogger({
  enabled: true,
  level: 'info',
  module: 'web.api',
  component: 'web',
})

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
  logger: Logger = webLogger,
) {
  const routeLogger = logger.child({ module, route })
  return async (ctx: { req: Request }) => {
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
  .get('/', () => renderPage(IndexPage))
  .get('/reader', async () => {
    const overview = await loadReaderOverview()
    return renderPage(() => ReaderPage({ overview }))
  })
  .get('/xquery', () => renderPage(XqueryPage))
  .get('/syndication', () => renderPage(SyndicationPage))
  .post(
    '/api/xquery/evaluate',
    withApiRequestLogging('/api/xquery/evaluate', 'web.api.xquery.evaluate', (request, onLogMeta) =>
      evaluateHandler(request, { onLogMeta }),
    ),
  )
  .post(
    '/api/syndication/evaluate',
    withApiRequestLogging(
      '/api/syndication/evaluate',
      'web.api.syndication.evaluate',
      (request, onLogMeta) => evaluateSyndicationHandler(request, { onLogMeta }),
    ),
  )
  .post(
    '/api/sources/update',
    withApiRequestLogging('/api/sources/update', 'web.api.sources.update', (request, onLogMeta) =>
      updateSourceHandler(request, { onLogMeta }),
    ),
  )
  .post(
    '/api/sources/run',
    withApiRequestLogging('/api/sources/run', 'web.api.sources.run', (request, onLogMeta) =>
      runSourceHandler(request, { onLogMeta }),
    ),
  )
  .post(
    '/api/sources/clear',
    withApiRequestLogging('/api/sources/clear', 'web.api.sources.clear', (request, onLogMeta) =>
      clearSourceHandler(request, { onLogMeta }),
    ),
  )

export default app
