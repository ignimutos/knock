import { assertStringIncludes } from '@std/assert'
import { renderToString } from 'preact-render-to-string'
import IndexPage from './index.tsx'

Deno.test('[contract] web pages: 首页应包含 Reader、Config 与两个 Playground 入口', () => {
  const html = renderToString(IndexPage())

  assertStringIncludes(html, 'RSS Reader')
  assertStringIncludes(html, 'Config Workbench')
  assertStringIncludes(html, 'XQuery Playground')
  assertStringIncludes(html, 'Syndication Playground')
  assertStringIncludes(html, 'href="/reader"')
  assertStringIncludes(html, 'href="/config"')
  assertStringIncludes(html, 'href="/xquery"')
  assertStringIncludes(html, 'href="/syndication"')
  assertStringIncludes(html, '跟随系统')
})
