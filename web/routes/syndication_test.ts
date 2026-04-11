import { assertStringIncludes } from '@std/assert'
import { renderToString } from 'preact-render-to-string'
import SyndicationPage from './syndication.tsx'

Deno.test('web pages: Syndication 页应包含 transport、填充按钮与结果面板', () => {
  const html = renderToString(SyndicationPage())
  assertStringIncludes(html, 'Syndication Playground')
  assertStringIncludes(html, 'name="runtime"')
  assertStringIncludes(html, 'value="native"')
  assertStringIncludes(html, 'value="byparr"')
  assertStringIncludes(html, '填充默认模板')
  assertStringIncludes(html, 'feed.title')
  assertStringIncludes(html, 'entry.id')
  assertStringIncludes(html, '原始响应内容')
  assertStringIncludes(html, '>运行</button>')
  assertStringIncludes(html, '预览模式')
})

Deno.test('web pages: Syndication 页应保留脚本钩子与结果面板节点', () => {
  const html = renderToString(SyndicationPage())
  assertStringIncludes(html, 'id="syn-form"')
  assertStringIncludes(html, 'id="syn-submit"')
  assertStringIncludes(html, 'id="syn-fill-defaults"')
  assertStringIncludes(html, 'id="xq-running"')
  assertStringIncludes(html, 'id="xq-error"')
  assertStringIncludes(html, 'id="xq-warnings"')
  assertStringIncludes(html, 'id="xq-debug"')
  assertStringIncludes(html, 'id="xq-raw-panel"')
  assertStringIncludes(html, 'id="xq-json-viewer"')
  assertStringIncludes(html, "fetch('/api/syndication/evaluate'")
  assertStringIncludes(html, 'runtime: getRuntime()')
  assertStringIncludes(html, 'fillDefaults()')
  assertStringIncludes(html, 'renderRawContent(payload?.rawContent)')
  assertStringIncludes(html, "sideRail.style.setProperty('--xq-rail-top', String(nextTop) + 'px')")
  assertStringIncludes(html, "submitButton.textContent = running ? '运行中…' : '运行'")
})
