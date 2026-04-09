import { assertStringIncludes } from '@std/assert'
import { renderToString } from 'preact-render-to-string'
import IndexPage from './index.tsx'

Deno.test('web pages: 首页应包含 XQuery Playground 入口与主题切换', () => {
  const html = renderToString(IndexPage())
  assertStringIncludes(html, 'XQuery Playground')
  assertStringIncludes(html, '跟随系统')
})
