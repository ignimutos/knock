export interface CreateWebRequestHandlerOptions {
  webClientAssetPath?: string
  serveClientAsset: () => Promise<Response>
  renderIndexPage: () => Response
  renderReaderPage: () => Promise<Response>
  renderConfigPage: () => Promise<Response>
  renderXqueryPage: () => Response
  renderSyndicationPage: () => Response
  readerOverviewHandler: (request: Request) => Promise<Response>
  xqueryEvaluateHandler: (request: Request) => Promise<Response>
  syndicationEvaluateHandler: (request: Request) => Promise<Response>
  configGlobalHandler: (request: Request) => Promise<Response>
  configDeliveriesHandler: (request: Request) => Promise<Response>
  configDeliveriesDeleteHandler: (request: Request) => Promise<Response>
  sourcesUpdateHandler: (request: Request) => Promise<Response>
  sourcesRunHandler: (request: Request) => Promise<Response>
  sourcesClearHandler: (request: Request) => Promise<Response>
}

export function createWebRequestHandler(options: CreateWebRequestHandlerOptions) {
  const webClientAssetPath = options.webClientAssetPath ?? '/assets/client.js'

  return async function handleWebRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const routeKey = `${request.method} ${url.pathname}`

    switch (routeKey) {
      case `GET ${webClientAssetPath}`:
        return await options.serveClientAsset()
      case 'GET /':
        return options.renderIndexPage()
      case 'GET /reader':
        return await options.renderReaderPage()
      case 'GET /config':
        return await options.renderConfigPage()
      case 'GET /xquery':
        return options.renderXqueryPage()
      case 'GET /syndication':
        return options.renderSyndicationPage()
      case 'GET /api/reader/overview':
        return await options.readerOverviewHandler(request)
      case 'POST /api/xquery/evaluate':
        return await options.xqueryEvaluateHandler(request)
      case 'POST /api/syndication/evaluate':
        return await options.syndicationEvaluateHandler(request)
      case 'POST /api/config/global':
        return await options.configGlobalHandler(request)
      case 'POST /api/config/deliveries':
        return await options.configDeliveriesHandler(request)
      case 'POST /api/config/deliveries/delete':
        return await options.configDeliveriesDeleteHandler(request)
      case 'POST /api/sources/update':
        return await options.sourcesUpdateHandler(request)
      case 'POST /api/sources/run':
        return await options.sourcesRunHandler(request)
      case 'POST /api/sources/clear':
        return await options.sourcesClearHandler(request)
      default:
        return new Response('Not Found', { status: 404 })
    }
  }
}
