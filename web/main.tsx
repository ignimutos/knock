/** @jsxImportSource preact */

import { join } from 'node:path'
import type { ComponentChildren } from 'preact'
import renderToString from 'preact-render-to-string'
import { cwd, isNotFoundError, readTextFile } from '../src/platform/fs.ts'
import AppDocument from './routes/_app.tsx'
import IndexPage from './routes/index.tsx'
import ReaderPage from './routes/reader.tsx'
import ConfigPage from './routes/config.tsx'
import XqueryPage from './routes/xquery.tsx'
import SyndicationPage from './routes/syndication.tsx'
import { loadReaderOverview } from '../src/config/reader_overview.ts'
import { loadConfigWorkbenchOverview } from '../src/config/runtime_session.ts'
import { createWebRequestHandler } from './create_web_request_handler.tsx'
import { createWebRoutes, type LoggedApiRouteDefinition } from './route_manifest.ts'
import { withApiRequestLogging } from './api_request_logging.ts'
export { withApiRequestLogging } from './api_request_logging.ts'

const WEB_CLIENT_ASSET_PATH = '/assets/client.js'

export interface WebApp {
  listen: () => void
  handler: () => (request: Request) => Promise<Response>
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

const readerOverviewRoute: LoggedApiRouteDefinition = {
  module: 'web.api.reader.overview',
  handle: async (request: Request) => {
    const { handler } = await import('./routes/api/reader/overview.ts')
    return await handler(request)
  },
}

const xqueryEvaluateRoute: LoggedApiRouteDefinition = {
  module: 'web.api.xquery.evaluate',
  handle: async (request, onLogMeta) => {
    const { handler } = await import('./routes/api/xquery/evaluate.ts')
    return await handler(request, { onLogMeta })
  },
}

const syndicationEvaluateRoute: LoggedApiRouteDefinition = {
  module: 'web.api.syndication.evaluate',
  handle: async (request, onLogMeta) => {
    const { handler } = await import('./routes/api/syndication/evaluate.ts')
    return await handler(request, { onLogMeta })
  },
}

const configGlobalRoute: LoggedApiRouteDefinition = {
  module: 'web.api.config.global',
  handle: async (request: Request) => {
    const { handler } = await import('./routes/api/config/global.ts')
    return await handler(request)
  },
}

const configDeliveriesRoute: LoggedApiRouteDefinition = {
  module: 'web.api.config.deliveries',
  handle: async (request: Request) => {
    const { handler } = await import('./routes/api/config/deliveries.ts')
    return await handler(request)
  },
}

const configDeliveriesDeleteRoute: LoggedApiRouteDefinition = {
  module: 'web.api.config.deliveries.delete',
  handle: async (request: Request) => {
    const { handler } = await import('./routes/api/config/deliveries_delete.ts')
    return await handler(request)
  },
}

const sourcesUpdateRoute: LoggedApiRouteDefinition = {
  module: 'web.api.sources.update',
  handle: async (request, onLogMeta) => {
    const { handler } = await import('./routes/api/sources/update.ts')
    return await handler(request, { onLogMeta })
  },
}

const sourcesRunRoute: LoggedApiRouteDefinition = {
  module: 'web.api.sources.run',
  handle: async (request, onLogMeta) => {
    const { handler } = await import('./routes/api/sources/run.ts')
    return await handler(request, { onLogMeta })
  },
}

const sourcesClearRoute: LoggedApiRouteDefinition = {
  module: 'web.api.sources.clear',
  handle: async (request, onLogMeta) => {
    const { handler } = await import('./routes/api/sources/clear.ts')
    return await handler(request, { onLogMeta })
  },
}

const routes = createWebRoutes({
  webClientAssetPath: WEB_CLIENT_ASSET_PATH,
  serveClientAsset,
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

export const handleWebRequest = createWebRequestHandler(routes)

const app: WebApp = {
  listen: () => {},
  handler: () => handleWebRequest,
}

export default app
