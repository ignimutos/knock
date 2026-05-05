import { assertEquals } from '../src/testing/assert.ts'
import { test } from '../src/testing/test_api.ts'
import { createWebRequestHandler } from './create_web_request_handler.tsx'
import { createWebRoutes } from './route_manifest.ts'

function createHandler() {
  const calls: string[] = []

  const handler = createWebRequestHandler(
    createWebRoutes({
      webClientAssetPath: '/assets/client.js',
      serveClientAsset: async () => {
        calls.push('asset')
        return new Response('asset')
      },
      renderIndexPage: () => {
        calls.push('index')
        return new Response('index')
      },
      renderReaderPage: async () => {
        calls.push('reader')
        return new Response('reader')
      },
      renderConfigPage: async () => {
        calls.push('config')
        return new Response('config')
      },
      renderXqueryPage: () => {
        calls.push('xquery')
        return new Response('xquery')
      },
      renderSyndicationPage: () => {
        calls.push('syndication')
        return new Response('syndication')
      },
      readerOverviewRoute: {
        module: 'web.api.reader.overview',
        handle: async () => {
          calls.push('reader-overview')
          return new Response('reader-overview')
        },
      },
      xqueryEvaluateRoute: {
        module: 'web.api.xquery.evaluate',
        handle: async () => {
          calls.push('xquery-evaluate')
          return new Response('xquery-evaluate')
        },
      },
      syndicationEvaluateRoute: {
        module: 'web.api.syndication.evaluate',
        handle: async () => {
          calls.push('syndication-evaluate')
          return new Response('syndication-evaluate')
        },
      },
      configGlobalRoute: {
        module: 'web.api.config.global',
        handle: async () => {
          calls.push('config-global')
          return new Response('config-global')
        },
      },
      configDeliveriesRoute: {
        module: 'web.api.config.deliveries',
        handle: async () => {
          calls.push('config-deliveries')
          return new Response('config-deliveries')
        },
      },
      configDeliveriesDeleteRoute: {
        module: 'web.api.config.deliveries.delete',
        handle: async () => {
          calls.push('config-deliveries-delete')
          return new Response('config-deliveries-delete')
        },
      },
      sourcesUpdateRoute: {
        module: 'web.api.sources.update',
        handle: async () => {
          calls.push('sources-update')
          return new Response('sources-update')
        },
      },
      sourcesRunRoute: {
        module: 'web.api.sources.run',
        handle: async () => {
          calls.push('sources-run')
          return new Response('sources-run')
        },
      },
      sourcesClearRoute: {
        module: 'web.api.sources.clear',
        handle: async () => {
          calls.push('sources-clear')
          return new Response('sources-clear')
        },
      },
    }),
  )

  return { calls, handler }
}

test('[contract] createWebRequestHandler: 应按 method+pathname 分发到匹配处理器', async () => {
  const { calls, handler } = createHandler()

  await handler(new Request('http://localhost/assets/client.js'))
  await handler(new Request('http://localhost/'))
  await handler(new Request('http://localhost/reader'))
  await handler(new Request('http://localhost/config'))
  await handler(new Request('http://localhost/xquery'))
  await handler(new Request('http://localhost/syndication'))
  await handler(new Request('http://localhost/api/reader/overview'))
  await handler(new Request('http://localhost/api/xquery/evaluate', { method: 'POST' }))
  await handler(new Request('http://localhost/api/syndication/evaluate', { method: 'POST' }))
  await handler(new Request('http://localhost/api/config/global', { method: 'POST' }))
  await handler(new Request('http://localhost/api/config/deliveries', { method: 'POST' }))
  await handler(new Request('http://localhost/api/config/deliveries/delete', { method: 'POST' }))
  await handler(new Request('http://localhost/api/sources/update', { method: 'POST' }))
  await handler(new Request('http://localhost/api/sources/run', { method: 'POST' }))
  await handler(new Request('http://localhost/api/sources/clear', { method: 'POST' }))

  assertEquals(calls, [
    'asset',
    'index',
    'reader',
    'config',
    'xquery',
    'syndication',
    'reader-overview',
    'xquery-evaluate',
    'syndication-evaluate',
    'config-global',
    'config-deliveries',
    'config-deliveries-delete',
    'sources-update',
    'sources-run',
    'sources-clear',
  ])
})

test('[contract] createWebRequestHandler: 未匹配路由应返回 404', async () => {
  const { calls, handler } = createHandler()

  const response = await handler(new Request('http://localhost/not-found'))

  assertEquals(response.status, 404)
  assertEquals(calls, [])
})
