import { assertEquals } from '../src/testing/assert.ts'
import { test } from '../src/testing/test_api.ts'
import { createWebRequestHandler } from './create_web_request_handler.tsx'

function createHandler() {
  const calls: string[] = []

  const handler = createWebRequestHandler({
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
    readerOverviewHandler: async () => {
      calls.push('reader-overview')
      return new Response('reader-overview')
    },
    xqueryEvaluateHandler: async () => {
      calls.push('xquery-evaluate')
      return new Response('xquery-evaluate')
    },
    syndicationEvaluateHandler: async () => {
      calls.push('syndication-evaluate')
      return new Response('syndication-evaluate')
    },
    configGlobalHandler: async () => {
      calls.push('config-global')
      return new Response('config-global')
    },
    configDeliveriesHandler: async () => {
      calls.push('config-deliveries')
      return new Response('config-deliveries')
    },
    configDeliveriesDeleteHandler: async () => {
      calls.push('config-deliveries-delete')
      return new Response('config-deliveries-delete')
    },
    sourcesUpdateHandler: async () => {
      calls.push('sources-update')
      return new Response('sources-update')
    },
    sourcesRunHandler: async () => {
      calls.push('sources-run')
      return new Response('sources-run')
    },
    sourcesClearHandler: async () => {
      calls.push('sources-clear')
      return new Response('sources-clear')
    },
  })

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
