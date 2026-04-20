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
import { type EvaluateLogMeta, handler as evaluateHandler } from './routes/api/xquery/evaluate.ts'
import { handler as evaluateSyndicationHandler } from './routes/api/syndication/evaluate.ts'

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

export function withApiRequestLogging(
  route: string,
  module: string,
  handler: (request: Request, onLogMeta: (meta: EvaluateLogMeta) => void) => Promise<Response>,
  logger: Logger = webLogger,
) {
  const routeLogger = logger.child({ module, route })
  return async (ctx: { req: Request }) => {
    const startedAt = Date.now()
    const requestId = createWebRequestId(startedAt)
    let logMeta: EvaluateLogMeta = {}

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
    routeLogger[level](response.ok ? 'API 请求完成' : 'API 请求失败', {
      'web.operation': 'request',
      'web.outcome': response.ok ? 'success' : 'failure',
      method: ctx.req.method,
      'web.duration_ms': Date.now() - startedAt,
      http_status: response.ok ? undefined : response.status,
      'web.request_id': requestId,
      ...(logMeta.targetHost ? { 'web.target_host': logMeta.targetHost } : {}),
      ...(logMeta.parser ? { 'source.parser': logMeta.parser } : {}),
      ...(logMeta.warningCount !== undefined
        ? { 'pipeline.warning_count': logMeta.warningCount }
        : {}),
      ...(logMeta.entryCount !== undefined ? { 'pipeline.entry_count': logMeta.entryCount } : {}),
      ...(logMeta.fetchDurationMs !== undefined
        ? { 'source.fetch_duration_ms': logMeta.fetchDurationMs }
        : {}),
      ...(logMeta.parseDurationMs !== undefined
        ? { 'source.parse_duration_ms': logMeta.parseDurationMs }
        : {}),
      ...(logMeta.errorCode ? { 'web.error_code': logMeta.errorCode } : {}),
      ...(logMeta.errorCategory ? { 'web.error_category': logMeta.errorCategory } : {}),
      ...(logMeta.errorMessage ? { error_message: logMeta.errorMessage } : {}),
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

export default app
