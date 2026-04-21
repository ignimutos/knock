import { assertStringIncludes } from '@std/assert'
import { renderToString } from 'preact-render-to-string'
import type { ReaderOverview } from '../../src/web/reader_overview.ts'
import ReaderPage from './reader.tsx'

const overview: ReaderOverview = {
  sources: [
    {
      id: 'rust',
      name: 'Rust Blog',
      enabled: true,
      schedule: '*/30 * * * *',
      filter: '{{ title }}',
      parser: 'syndication',
      transport: 'http',
      sourceUrl: 'https://example.com/feed.xml',
      xqueryLocate: undefined,
      xqueryEntryId: undefined,
      deliveryCount: 1,
      deliveryIds: ['telegram'],
      deliveryKinds: ['push'],
      deliveryOverrides: {
        telegram: {
          payload: {
            text: '{{ entry.title }}',
          },
        },
      },
      lastRun: {
        runId: 'run-1',
        status: 'success',
        startedAt: '2026-04-20T09:00:01.000Z',
        finishedAt: '2026-04-20T09:00:02.000Z',
        counts: {
          fetchedCount: 3,
          parsedCount: 3,
          filteredCount: 0,
          duplicateItemCount: 0,
          deliveredCount: 3,
          failedAttemptCount: 0,
          skippedCount: 0,
        },
      },
      feed: {
        title: 'Rust Feed',
        link: 'https://example.com/',
        description: '<p>Latest posts</p>',
        generator: 'rss',
        language: 'en',
        published: '2026-04-20T09:00:00.000Z',
      },
      entries: [
        {
          itemId: 'item-1',
          status: 'delivered',
          id: 'entry-1',
          title: 'Hello',
          link: 'https://example.com/1',
          description: '<p>Summary</p>',
          content: '<p>Content</p>',
          published: '2026-04-20T09:00:00.000Z',
          updated: '',
        },
      ],
    },
  ],
  deliveries: [
    {
      id: 'telegram',
      kind: 'push',
    },
  ],
}

Deno.test(
  '[contract] web pages: Reader 页应包含 source 列表、entry 阅读面与 bootstrap 数据',
  () => {
    const html = renderToString(ReaderPage({ overview }))

    assertStringIncludes(html, 'RSS Reader')
    assertStringIncludes(html, 'id="reader-bootstrap"')
    assertStringIncludes(html, 'id="reader-source-list"')
    assertStringIncludes(html, 'id="reader-source-card"')
    assertStringIncludes(html, 'id="reader-feed-banner"')
    assertStringIncludes(html, 'id="reader-entry-list"')
    assertStringIncludes(html, 'class="reader-entry-expanded"')
    assertStringIncludes(html, 'source archive')
    assertStringIncludes(html, 'source 管理')
    assertStringIncludes(html, '保存配置')
    assertStringIncludes(html, '强制获取')
    assertStringIncludes(html, '清空历史')
    assertStringIncludes(html, 'payload override (JSON)')
    assertStringIncludes(html, '确认清空历史')
    assertStringIncludes(html, 'entry 阅读面')
    assertStringIncludes(html, '打开原文')
  },
)

Deno.test('[contract] web pages: Reader 页应保留键盘漫游与 bootstrap 脚本钩子', () => {
  const html = renderToString(ReaderPage({ overview }))

  assertStringIncludes(html, "document.addEventListener('keydown'")
  assertStringIncludes(html, 'ArrowLeft')
  assertStringIncludes(html, 'ArrowRight')
  assertStringIncludes(html, 'ArrowUp')
  assertStringIncludes(html, 'ArrowDown')
  assertStringIncludes(html, 'reader-source-button')
  assertStringIncludes(html, 'reader-entry-button')
  assertStringIncludes(html, 'reader-entry-expand-shell')
  assertStringIncludes(html, 'entryIndex = expanded ? -1 : index')
  assertStringIncludes(html, 'aria-expanded="true"')
  assertStringIncludes(html, 'JSON.parse(bootstrap.textContent')
})
