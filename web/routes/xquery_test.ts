import { assertStringIncludes } from '@std/assert'
import { renderToString } from 'preact-render-to-string'
import XqueryPage from './xquery.tsx'

Deno.test('[contract] web pages: Playground 页应包含 Task 2 表单区块与结果面板结构', () => {
  const html = renderToString(XqueryPage())
  assertStringIncludes(html, 'name="runtime"')
  assertStringIncludes(html, 'value="native"')
  assertStringIncludes(html, 'value="byparr"')
  assertStringIncludes(html, 'class="xq-section"')
  assertStringIncludes(html, '>运行</button>')
  assertStringIncludes(html, 'feed 提取')
  assertStringIncludes(html, 'entry 提取')
  assertStringIncludes(html, '结构化')
  assertStringIncludes(html, '脚本')
  assertStringIncludes(html, '命名空间')
  assertStringIncludes(html, '新增命名空间')
  assertStringIncludes(html, '警告')
  assertStringIncludes(html, '错误信息')
  assertStringIncludes(html, '调试信息')
  assertStringIncludes(html, '原始响应内容')
  assertStringIncludes(html, '全部展开')
  assertStringIncludes(html, '全部折叠')
  assertStringIncludes(html, '跟随系统')
})

Deno.test('[contract] web pages: Playground 页应保留交互脚本关键钩子并补充原始响应节点', () => {
  const html = renderToString(XqueryPage())
  assertStringIncludes(html, 'id="xq-form"')
  assertStringIncludes(html, 'id="xq-submit"')
  assertStringIncludes(html, 'id="xq-running"')
  assertStringIncludes(html, 'id="xq-add-namespace"')
  assertStringIncludes(html, 'id="xq-namespaces-rows"')
  assertStringIncludes(html, 'id="xq-error"')
  assertStringIncludes(html, 'id="xq-error-message"')
  assertStringIncludes(html, 'id="xq-warnings"')
  assertStringIncludes(html, 'id="xq-warning-list"')
  assertStringIncludes(html, 'id="xq-debug"')
  assertStringIncludes(html, 'id="xq-debug-list"')
  assertStringIncludes(html, 'id="xq-raw-panel"')
  assertStringIncludes(html, 'id="xq-raw-content"')
  assertStringIncludes(html, 'id="xq-json-viewer"')
  assertStringIncludes(html, 'name="feed-mode"')
  assertStringIncludes(html, 'name="entry-mode"')
  assertStringIncludes(html, 'data-mode-group="feed-structured"')
  assertStringIncludes(html, 'data-mode-group="feed-script"')
  assertStringIncludes(html, 'data-mode-group="entry-structured"')
  assertStringIncludes(html, 'data-mode-group="entry-script"')
  assertStringIncludes(html, "submitButton.textContent = running ? '运行中…' : '运行'")
  assertStringIncludes(
    html,
    '.xq-section > summary button, .xq-section > summary label, .xq-section > summary input',
  )
  assertStringIncludes(html, 'event.stopPropagation()')
  assertStringIncludes(html, 'event.preventDefault()')
  assertStringIncludes(html, "fetch('/api/xquery/evaluate'")
  assertStringIncludes(html, 'runtime: getRuntime()')
  assertStringIncludes(html, 'renderRawContent(payload?.rawContent)')
  assertStringIncludes(html, "sideRail.style.setProperty('--xq-rail-top', String(nextTop) + 'px')")
  assertStringIncludes(html, 'applyVisibility(!visible)\n      syncRailTop()')
  assertStringIncludes(html, "rawPanel.addEventListener('toggle', syncRailTop)")
})

Deno.test('[contract] web pages: Playground 页应为主次按钮输出不同类名', () => {
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

Deno.test('[contract] web pages: Playground 页应输出两列布局与预览模式文案', () => {
  const html = renderToString(XqueryPage())
  assertStringIncludes(html, 'class="xq-grid xq-layout"')
  assertStringIncludes(html, 'class="xq-main-column"')
  assertStringIncludes(html, 'class="xq-side-column"')
  assertStringIncludes(html, 'class="panel xq-side-rail"')
  assertStringIncludes(html, '预览模式')
  assertStringIncludes(html, '仅用于临时抓取与结果预览，不会写入正式配置')
})
