export interface WebRouteDefinition {
  method: 'GET' | 'POST'
  path: string
  handle: (request: Request) => Response | Promise<Response>
}

import type { EvaluateLogMeta } from '../src/interfaces/web/create_playground_evaluate_handler.ts'
import type { SourceActionLogMeta } from '../src/interfaces/web/create_source_action_handler.ts'

export type LoggedApiRouteHandler = (
  request: Request,
  onLogMeta: (meta: EvaluateLogMeta | SourceActionLogMeta) => void,
) => Promise<Response>

export interface LoggedApiRouteDefinition {
  module: string
  handle: LoggedApiRouteHandler
}

export interface CreateWebRoutesOptions {
  webClientAssetPath?: string
  serveClientAsset: () => Promise<Response>
  renderIndexPage: () => Response | Promise<Response>
  renderReaderPage: () => Promise<Response>
  renderConfigPage: () => Promise<Response>
  renderXqueryPage: () => Response | Promise<Response>
  renderSyndicationPage: () => Response | Promise<Response>
  logApiRequest?: (
    route: string,
    module: string,
    handler: LoggedApiRouteHandler,
  ) => WebRouteDefinition['handle']
  readerOverviewRoute: LoggedApiRouteDefinition
  xqueryEvaluateRoute: LoggedApiRouteDefinition
  syndicationEvaluateRoute: LoggedApiRouteDefinition
  configGlobalRoute: LoggedApiRouteDefinition
  configDeliveriesRoute: LoggedApiRouteDefinition
  configDeliveriesDeleteRoute: LoggedApiRouteDefinition
  sourcesUpdateRoute: LoggedApiRouteDefinition
  sourcesRunRoute: LoggedApiRouteDefinition
  sourcesClearRoute: LoggedApiRouteDefinition
}

function withoutLogging(handler: LoggedApiRouteHandler): WebRouteDefinition['handle'] {
  return async (request) => await handler(request, () => {})
}

export function createWebRoutes(options: CreateWebRoutesOptions): WebRouteDefinition[] {
  const webClientAssetPath = options.webClientAssetPath ?? '/assets/client.js'
  const logApiRequest = options.logApiRequest ?? ((_, __, handler) => withoutLogging(handler))

  return [
    {
      method: 'GET',
      path: webClientAssetPath,
      handle: async () => await options.serveClientAsset(),
    },
    {
      method: 'GET',
      path: '/',
      handle: async () => await options.renderIndexPage(),
    },
    {
      method: 'GET',
      path: '/reader',
      handle: async () => await options.renderReaderPage(),
    },
    {
      method: 'GET',
      path: '/config',
      handle: async () => await options.renderConfigPage(),
    },
    {
      method: 'GET',
      path: '/xquery',
      handle: async () => await options.renderXqueryPage(),
    },
    {
      method: 'GET',
      path: '/syndication',
      handle: async () => await options.renderSyndicationPage(),
    },
    {
      method: 'GET',
      path: '/api/reader/overview',
      handle: logApiRequest(
        '/api/reader/overview',
        options.readerOverviewRoute.module,
        options.readerOverviewRoute.handle,
      ),
    },
    {
      method: 'POST',
      path: '/api/xquery/evaluate',
      handle: logApiRequest(
        '/api/xquery/evaluate',
        options.xqueryEvaluateRoute.module,
        options.xqueryEvaluateRoute.handle,
      ),
    },
    {
      method: 'POST',
      path: '/api/syndication/evaluate',
      handle: logApiRequest(
        '/api/syndication/evaluate',
        options.syndicationEvaluateRoute.module,
        options.syndicationEvaluateRoute.handle,
      ),
    },
    {
      method: 'POST',
      path: '/api/config/global',
      handle: logApiRequest(
        '/api/config/global',
        options.configGlobalRoute.module,
        options.configGlobalRoute.handle,
      ),
    },
    {
      method: 'POST',
      path: '/api/config/deliveries',
      handle: logApiRequest(
        '/api/config/deliveries',
        options.configDeliveriesRoute.module,
        options.configDeliveriesRoute.handle,
      ),
    },
    {
      method: 'POST',
      path: '/api/config/deliveries/delete',
      handle: logApiRequest(
        '/api/config/deliveries/delete',
        options.configDeliveriesDeleteRoute.module,
        options.configDeliveriesDeleteRoute.handle,
      ),
    },
    {
      method: 'POST',
      path: '/api/sources/update',
      handle: logApiRequest(
        '/api/sources/update',
        options.sourcesUpdateRoute.module,
        options.sourcesUpdateRoute.handle,
      ),
    },
    {
      method: 'POST',
      path: '/api/sources/run',
      handle: logApiRequest(
        '/api/sources/run',
        options.sourcesRunRoute.module,
        options.sourcesRunRoute.handle,
      ),
    },
    {
      method: 'POST',
      path: '/api/sources/clear',
      handle: logApiRequest(
        '/api/sources/clear',
        options.sourcesClearRoute.module,
        options.sourcesClearRoute.handle,
      ),
    },
  ]
}

export function createRouteMap(
  routes: readonly WebRouteDefinition[],
): Map<string, WebRouteDefinition['handle']> {
  return new Map(routes.map((route) => [`${route.method} ${route.path}`, route.handle] as const))
}
