import { createRouteMap, type WebRouteDefinition } from './route_manifest.ts'

export function createWebRequestHandler(routes: readonly WebRouteDefinition[]) {
  const routeMap = createRouteMap(routes)

  return async function handleWebRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const handler = routeMap.get(`${request.method} ${url.pathname}`)

    if (!handler) {
      return new Response('Not Found', { status: 404 })
    }

    return await handler(request)
  }
}
