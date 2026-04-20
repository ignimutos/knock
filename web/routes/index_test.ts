import { assertStringIncludes } from '@std/assert'
import { renderToString } from 'preact-render-to-string'
import IndexPage from './index.tsx'

Deno.test('[contract] web pages: 首页应包含 Reader 与两个 Playground 入口', () => {
  const html = renderToString(IndexPage())

  assertStringIncludes(html, 'RSS Reader')
  assertStringIncludes(html, 'XQuery Playground')
  assertStringIncludes(html, 'Syndication Playground')
  assertStringIncludes(html, 'href="/reader"')
  assertStringIncludes(html, 'href="/xquery"')
  assertStringIncludes(html, 'href="/syndication"')
  assertStringIncludes(html, '跟随系统')
})
