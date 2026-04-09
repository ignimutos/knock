import { assertStringIncludes } from '@std/assert'
import { renderToString } from 'preact-render-to-string'
import XqueryPage from './xquery.tsx'

Deno.test('web pages: Playground 页应包含双模式表单与结果面板基础结构', () => {
  const html = renderToString(XqueryPage())
  assertStringIncludes(html, '运行 XQuery')
  assertStringIncludes(html, 'feed 提取')
  assertStringIncludes(html, 'entry 提取')
  assertStringIncludes(html, '结构化')
  assertStringIncludes(html, '脚本')
  assertStringIncludes(html, '命名空间')
  assertStringIncludes(html, '新增命名空间')
  assertStringIncludes(html, '警告')
  assertStringIncludes(html, '错误信息')
  assertStringIncludes(html, '调试信息')
  assertStringIncludes(html, '全部展开')
  assertStringIncludes(html, '全部折叠')
  assertStringIncludes(html, '跟随系统')
})

Deno.test('web pages: Playground 页应输出交互脚本关键钩子', () => {
  const html = renderToString(XqueryPage())
  assertStringIncludes(html, 'id="xq-form"')
  assertStringIncludes(html, 'id="xq-submit"')
  assertStringIncludes(html, 'id="xq-add-namespace"')
  assertStringIncludes(html, 'id="xq-error"')
  assertStringIncludes(html, 'id="xq-warnings"')
  assertStringIncludes(html, 'id="xq-debug"')
  assertStringIncludes(html, 'event.preventDefault()')
  assertStringIncludes(html, "fetch('/api/xquery/evaluate'")
})

Deno.test('web pages: Playground 页应为主次按钮输出不同类名', () => {
  const html = renderToString(XqueryPage())
  assertStringIncludes(html, 'class="btn btn-primary" id="xq-submit"')
  assertStringIncludes(html, 'class="btn btn-secondary" id="xq-add-namespace"')
  assertStringIncludes(html, 'class="btn btn-secondary" data-ns-remove')
  assertStringIncludes(html, 'class="btn btn-secondary" id="xq-expand-all"')
  assertStringIncludes(html, 'class="btn btn-secondary" id="xq-collapse-all"')
  assertStringIncludes(
    html,
    '<button type="button" class="btn btn-secondary" data-ns-remove>删除</button>',
  )
})

Deno.test('web pages: Playground 页应输出两列布局与预览模式文案', () => {
  const html = renderToString(XqueryPage())
  assertStringIncludes(html, 'class="xq-grid xq-layout"')
  assertStringIncludes(html, 'class="xq-main-column"')
  assertStringIncludes(html, 'class="xq-side-column"')
  assertStringIncludes(html, 'class="panel xq-side-rail"')
  assertStringIncludes(html, '预览模式')
  assertStringIncludes(html, '仅用于临时抓取与结果预览，不会写入正式配置')
})
