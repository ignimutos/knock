/** @jsxImportSource preact */

import { file } from 'bun'
import type { ComponentChildren } from 'preact'
import renderToString from 'preact-render-to-string'
import { loadConfigWorkbenchOverview } from '../../src/config/runtime_session.ts'
import { loadReaderOverview } from '../../src/config/reader_overview.ts'
import { withApiRequestLogging } from '../../web/api_request_logging.ts'
import { createWebRequestHandler } from '../../web/create_web_request_handler.tsx'
import { createWebRoutes, type LoggedApiRouteDefinition } from '../../web/route_manifest.ts'
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

const readerOverviewRoute: LoggedApiRouteDefinition = {
  module: 'web.api.reader.overview',
  handle: async (request: Request) => {
    return await readerOverviewRouteHandler(request)
  },
}

const xqueryEvaluateRoute: LoggedApiRouteDefinition = {
  module: 'web.api.xquery.evaluate',
  handle: async (request, onLogMeta) => {
    return await xqueryEvaluateRouteHandler(request, { onLogMeta })
  },
}

const syndicationEvaluateRoute: LoggedApiRouteDefinition = {
  module: 'web.api.syndication.evaluate',
  handle: async (request, onLogMeta) => {
    return await syndicationEvaluateRouteHandler(request, { onLogMeta })
  },
}

const configGlobalRoute: LoggedApiRouteDefinition = {
  module: 'web.api.config.global',
  handle: async (request: Request) => {
    return await configGlobalRouteHandler(request)
  },
}

const configDeliveriesRoute: LoggedApiRouteDefinition = {
  module: 'web.api.config.deliveries',
  handle: async (request: Request) => {
    return await configDeliveriesRouteHandler(request)
  },
}

const configDeliveriesDeleteRoute: LoggedApiRouteDefinition = {
  module: 'web.api.config.deliveries.delete',
  handle: async (request: Request) => {
    return await configDeliveriesDeleteRouteHandler(request)
  },
}

const sourcesUpdateRoute: LoggedApiRouteDefinition = {
  module: 'web.api.sources.update',
  handle: async (request, onLogMeta) => {
    return await sourcesUpdateRouteHandler(request, { onLogMeta })
  },
}

const sourcesRunRoute: LoggedApiRouteDefinition = {
  module: 'web.api.sources.run',
  handle: async (request, onLogMeta) => {
    return await sourcesRunRouteHandler(request, { onLogMeta })
  },
}

const sourcesClearRoute: LoggedApiRouteDefinition = {
  module: 'web.api.sources.clear',
  handle: async (request, onLogMeta) => {
    return await sourcesClearRouteHandler(request, { onLogMeta })
  },
}

const routes = createWebRoutes({
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
  logApiRequest: withApiRequestLogging,
  readerOverviewRoute,
  xqueryEvaluateRoute,
  syndicationEvaluateRoute,
  configGlobalRoute,
  configDeliveriesRoute,
  configDeliveriesDeleteRoute,
  sourcesUpdateRoute,
  sourcesRunRoute,
  sourcesClearRoute,
})

export const handleCompiledWebRequest = createWebRequestHandler(routes)
