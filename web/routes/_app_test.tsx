import { assertStringIncludes } from '@std/assert'
import { renderToString } from 'preact-render-to-string'
import App from './_app.tsx'
import IndexPage from './index.tsx'

Deno.test('web app: 应输出主题初始化脚本与默认主题数据属性', () => {
  const html = renderToString(App({ Component: IndexPage } as never))

  assertStringIncludes(html, 'data-theme="light"')
  assertStringIncludes(html, 'data-theme-mode="system"')
  assertStringIncludes(html, 'knock.theme.mode')
  assertStringIncludes(html, 'prefers-color-scheme: dark')
  assertStringIncludes(html, 'html[data-theme="dark"]')
})

Deno.test('web app: 应输出 details 与 rail 相关样式钩子', () => {
  const html = renderToString(App({ Component: IndexPage } as never))

  assertStringIncludes(html, '.xq-section')
  assertStringIncludes(html, '.xq-section > summary')
  assertStringIncludes(html, '.xq-section > summary::-webkit-details-marker')
  assertStringIncludes(html, '.segment-control')
  assertStringIncludes(html, '.result-pre-wrap')
  assertStringIncludes(html, '.xq-side-rail')
  assertStringIncludes(html, 'top: var(--xq-rail-top, 24px)')
  assertStringIncludes(html, 'transition: top .18s ease')
  assertStringIncludes(html, '@media (prefers-reduced-motion: reduce)')
})
