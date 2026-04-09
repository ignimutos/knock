import { App, staticFiles } from 'fresh'
import type { JSX } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { createLogger, type Logger } from '../src/core/logger.ts'
import AppDocument from './routes/_app.tsx'
import IndexPage from './routes/index.tsx'
import XqueryPage from './routes/xquery.tsx'
import { type EvaluateLogMeta, handler as evaluateHandler } from './routes/api/xquery/evaluate.ts'

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
    let logMeta: EvaluateLogMeta = {}

    routeLogger.info('API 请求开始', {
      operation: 'request',
      outcome: 'start',
      method: ctx.req.method,
    })

    const response = await handler(ctx.req, (meta) => {
      logMeta = meta
    })
    const level = response.ok ? 'info' : 'error'
    routeLogger[level](response.ok ? 'API 请求完成' : 'API 请求失败', {
      operation: 'request',
      outcome: response.ok ? 'success' : 'failure',
      method: ctx.req.method,
      duration_ms: Date.now() - startedAt,
      http_status: response.ok ? undefined : response.status,
      ...logMeta,
    })
    return response
  }
}

export const app = new App()
  .use(staticFiles())
  .get('/', () => renderPage(IndexPage))
  .get('/xquery', () => renderPage(XqueryPage))
  .post(
    '/api/xquery/evaluate',
    withApiRequestLogging('/api/xquery/evaluate', 'web.api.xquery.evaluate', (request, onLogMeta) =>
      evaluateHandler(request, { onLogMeta }),
    ),
  )

export default app
