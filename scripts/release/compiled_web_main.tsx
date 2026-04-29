/** @jsxImportSource preact */

import { file } from 'bun'
import type { ComponentChildren } from 'preact'
import renderToString from 'preact-render-to-string'
import { createLogger, type Logger } from '../../src/core/logger.ts'
import type { EvaluateLogMeta } from '../../src/interfaces/web/create_playground_evaluate_handler.ts'
import type { SourceActionLogMeta } from '../../src/interfaces/web/create_source_action_handler.ts'
import { getCurrentWebLoggingRuntime } from '../../src/interfaces/web/start_web.ts'
import { loadConfigWorkbenchOverview } from '../../src/web/config_workbench_overview.ts'
import { loadReaderOverview } from '../../src/web/reader_overview.ts'
import { createWebRequestHandler } from '../../web/create_web_request_handler.tsx'
import AppDocument from '../../web/routes/_app.tsx'
import { handler as configDeliveriesDeleteRouteHandler } from '../../web/routes/api/config/deliveries_delete.ts'
import { handler as configDeliveriesRouteHandler } from '../../web/routes/api/config/deliveries.ts'
import { handler as configGlobalRouteHandler } from '../../web/routes/api/config/global.ts'
import { handler as readerOverviewRouteHandler } from '../../web/routes/api/reader/overview.ts'
import { handler as sourcesClearRouteHandler } from '../../web/routes/api/sources/clear.ts'
import { handler as sourcesRunRouteHandler } from '../../web/routes/api/sources/run.ts'
import { handler as sourcesUpdateRouteHandler } from '../../web/routes/api/sources/update.ts'
import { handler as syndicationEvaluateRouteHandler } from '../../web/routes/api/syndication/evaluate.ts'
import { handler as xqueryEvaluateRouteHandler } from '../../web/routes/api/xquery/evaluate.ts'
import ConfigPage from '../../web/routes/config.tsx'
import IndexPage from '../../web/routes/index.tsx'
import ReaderPage from '../../web/routes/reader.tsx'
import SyndicationPage from '../../web/routes/syndication.tsx'
import XqueryPage from '../../web/routes/xquery.tsx'
import clientAssetPath from '../../.web-dist/assets/client.js' with { type: 'file' }

const WEB_CLIENT_ASSET_PATH = '/assets/client.js'

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

function withApiRequestLogging(
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

async function serveEmbeddedClientAsset(): Promise<Response> {
  return new Response(file(clientAssetPath), {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
    },
  })
}

const readerOverviewHandler = withApiRequestLogging(
  '/api/reader/overview',
  'web.api.reader.overview',
  async (request) => {
    return await readerOverviewRouteHandler(request)
  },
)

const xqueryEvaluateHandler = withApiRequestLogging(
  '/api/xquery/evaluate',
  'web.api.xquery.evaluate',
  async (request, onLogMeta) => {
    return await xqueryEvaluateRouteHandler(request, { onLogMeta })
  },
)

const syndicationEvaluateHandler = withApiRequestLogging(
  '/api/syndication/evaluate',
  'web.api.syndication.evaluate',
  async (request, onLogMeta) => {
    return await syndicationEvaluateRouteHandler(request, { onLogMeta })
  },
)

const configGlobalHandler = withApiRequestLogging(
  '/api/config/global',
  'web.api.config.global',
  async (request) => {
    return await configGlobalRouteHandler(request)
  },
)

const configDeliveriesHandler = withApiRequestLogging(
  '/api/config/deliveries',
  'web.api.config.deliveries',
  async (request) => {
    return await configDeliveriesRouteHandler(request)
  },
)

const configDeliveriesDeleteHandler = withApiRequestLogging(
  '/api/config/deliveries/delete',
  'web.api.config.deliveries.delete',
  async (request) => {
    return await configDeliveriesDeleteRouteHandler(request)
  },
)

const sourcesUpdateHandler = withApiRequestLogging(
  '/api/sources/update',
  'web.api.sources.update',
  async (request, onLogMeta) => {
    return await sourcesUpdateRouteHandler(request, { onLogMeta })
  },
)

const sourcesRunHandler = withApiRequestLogging(
  '/api/sources/run',
  'web.api.sources.run',
  async (request, onLogMeta) => {
    return await sourcesRunRouteHandler(request, { onLogMeta })
  },
)

const sourcesClearHandler = withApiRequestLogging(
  '/api/sources/clear',
  'web.api.sources.clear',
  async (request, onLogMeta) => {
    return await sourcesClearRouteHandler(request, { onLogMeta })
  },
)

export const handleCompiledWebRequest = createWebRequestHandler({
  webClientAssetPath: WEB_CLIENT_ASSET_PATH,
  serveClientAsset: serveEmbeddedClientAsset,
  renderIndexPage: () => renderDocument(<IndexPage />),
  renderReaderPage: async () => {
    const overview = await loadReaderOverview()
    return renderDocument(<ReaderPage overview={overview} />)
  },
  renderConfigPage: async () => {
    const workbench = await loadConfigWorkbenchOverview()
    return renderDocument(<ConfigPage workbench={workbench} />)
  },
  renderXqueryPage: () => renderDocument(<XqueryPage />),
  renderSyndicationPage: () => renderDocument(<SyndicationPage />),
  readerOverviewHandler,
  xqueryEvaluateHandler,
  syndicationEvaluateHandler,
  configGlobalHandler,
  configDeliveriesHandler,
  configDeliveriesDeleteHandler,
  sourcesUpdateHandler,
  sourcesRunHandler,
  sourcesClearHandler,
})
