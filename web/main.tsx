/** @jsxImportSource preact */

import { join } from 'node:path'
import type { ComponentChildren } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { createLogger, type Logger } from '../src/core/logger.ts'
import { cwd, isNotFoundError, readTextFile } from '../src/platform/fs.ts'
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

const WEB_CLIENT_ASSET_PATH = '/assets/client.js'

type LoggedRequest = Request | { req: Request }

export interface WebApp {
  listen: () => void
  handler: () => (request: Request) => Promise<Response>
}

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

function renderDocument(content: ComponentChildren, title: string = 'Knock Web'): Response {
  const html =
    '<!DOCTYPE html>' + renderToString(<AppDocument title={title}>{content}</AppDocument>)
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  })
}

async function serveClientAsset(): Promise<Response> {
  try {
    const source = await readTextFile(join(cwd(), '.web-dist', 'assets', 'client.js'))
    return new Response(source, {
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
      },
    })
  } catch (error) {
    if (isNotFoundError(error)) {
      return new Response('Not Found', { status: 404 })
    }
    throw error
  }
}

const readerOverviewHandler = withApiRequestLogging(
  '/api/reader/overview',
  'web.api.reader.overview',
  async (request) => {
    const { handler } = await import('./routes/api/reader/overview.ts')
    return await handler(request)
  },
)

const xqueryEvaluateHandler = withApiRequestLogging(
  '/api/xquery/evaluate',
  'web.api.xquery.evaluate',
  async (request, onLogMeta) => {
    const { handler } = await import('./routes/api/xquery/evaluate.ts')
    return await handler(request, { onLogMeta })
  },
)

const syndicationEvaluateHandler = withApiRequestLogging(
  '/api/syndication/evaluate',
  'web.api.syndication.evaluate',
  async (request, onLogMeta) => {
    const { handler } = await import('./routes/api/syndication/evaluate.ts')
    return await handler(request, { onLogMeta })
  },
)

const configGlobalHandler = withApiRequestLogging(
  '/api/config/global',
  'web.api.config.global',
  async (request) => {
    const { handler } = await import('./routes/api/config/global.ts')
    return await handler(request)
  },
)

const configDeliveriesHandler = withApiRequestLogging(
  '/api/config/deliveries',
  'web.api.config.deliveries',
  async (request) => {
    const { handler } = await import('./routes/api/config/deliveries.ts')
    return await handler(request)
  },
)

const configDeliveriesDeleteHandler = withApiRequestLogging(
  '/api/config/deliveries/delete',
  'web.api.config.deliveries.delete',
  async (request) => {
    const { handler } = await import('./routes/api/config/deliveries_delete.ts')
    return await handler(request)
  },
)

const sourcesUpdateHandler = withApiRequestLogging(
  '/api/sources/update',
  'web.api.sources.update',
  async (request, onLogMeta) => {
    const { handler } = await import('./routes/api/sources/update.ts')
    return await handler(request, { onLogMeta })
  },
)

const sourcesRunHandler = withApiRequestLogging(
  '/api/sources/run',
  'web.api.sources.run',
  async (request, onLogMeta) => {
    const { handler } = await import('./routes/api/sources/run.ts')
    return await handler(request, { onLogMeta })
  },
)

const sourcesClearHandler = withApiRequestLogging(
  '/api/sources/clear',
  'web.api.sources.clear',
  async (request, onLogMeta) => {
    const { handler } = await import('./routes/api/sources/clear.ts')
    return await handler(request, { onLogMeta })
  },
)

export async function handleWebRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const routeKey = `${request.method} ${url.pathname}`

  switch (routeKey) {
    case `GET ${WEB_CLIENT_ASSET_PATH}`:
      return await serveClientAsset()
    case 'GET /':
      return renderDocument(<IndexPage />)
    case 'GET /reader': {
      const overview = await loadReaderOverview()
      return renderDocument(<ReaderPage overview={overview} />)
    }
    case 'GET /config': {
      const workbench = await loadConfigWorkbenchOverview()
      return renderDocument(<ConfigPage workbench={workbench} />)
    }
    case 'GET /xquery':
      return renderDocument(<XqueryPage />)
    case 'GET /syndication':
      return renderDocument(<SyndicationPage />)
    case 'GET /api/reader/overview':
      return await readerOverviewHandler(request)
    case 'POST /api/xquery/evaluate':
      return await xqueryEvaluateHandler(request)
    case 'POST /api/syndication/evaluate':
      return await syndicationEvaluateHandler(request)
    case 'POST /api/config/global':
      return await configGlobalHandler(request)
    case 'POST /api/config/deliveries':
      return await configDeliveriesHandler(request)
    case 'POST /api/config/deliveries/delete':
      return await configDeliveriesDeleteHandler(request)
    case 'POST /api/sources/update':
      return await sourcesUpdateHandler(request)
    case 'POST /api/sources/run':
      return await sourcesRunHandler(request)
    case 'POST /api/sources/clear':
      return await sourcesClearHandler(request)
    default:
      return new Response('Not Found', { status: 404 })
  }
}

const app: WebApp = {
  listen: () => {},
  handler: () => handleWebRequest,
}

export default app
