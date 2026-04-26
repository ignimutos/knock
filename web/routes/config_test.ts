import { assertEquals, assertStringIncludes } from '@std/assert'
import { renderToString } from 'preact-render-to-string'
import type { ConfigWorkbenchOverview } from '../../src/web/config_workbench_overview.ts'
import ConfigPage from './config.tsx'

const workbench: ConfigWorkbenchOverview = {
  reader: {
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
        entries: [],
      },
    ],
    deliveries: [
      {
        id: 'telegram',
        kind: 'push',
      },
    ],
  },
  global: {
    language: 'zh-CN',
    timezone: 'Asia/Shanghai',
    timestampFormat: 'yyyy-MM-dd HH:mm:ss',
    sqlite: {
      path: 'knock.db',
      busyTimeout: '5s',
      journalMode: 'WAL',
      retention: {
        maxAge: '180d',
        maxEntriesPerSource: 1000,
        vacuum: 'off',
      },
    },
    sqliteJson: '{\n  "path": "knock.db"\n}',
    logging: {
      level: 'info',
      sinks: {
        console: {
          type: 'console',
          format: 'pretty',
        },
      },
    },
    loggingJson: '{\n  "level": "info"\n}',
    ai: undefined,
    aiJson: '',
  },
  deliveries: [
    {
      id: 'telegram',
      enabled: true,
      kind: 'push',
      config: {
        http: {
          url: 'https://example.com',
          method: 'POST',
        },
        request: {
          type: 'body',
        },
      },
      configJson: '{\n  "http": {\n    "url": "https://example.com"\n  }\n}',
    },
  ],
}

Deno.test('[contract] web pages: Config 页空字段应暴露默认值 placeholder', () => {
  const html = renderToString(
    ConfigPage({
      workbench: {
        ...workbench,
        global: {
          ...workbench.global,
          sqlite: undefined,
          sqliteJson: '',
        },
        deliveries: [
          {
            ...workbench.deliveries[0],
            kind: 'file',
            config: { path: '', content: '' },
            configJson: '{\n  "path": ""\n}',
          },
        ],
      },
    }),
  )

  assertStringIncludes(html, 'placeholder="db/knock.db"')
  assertStringIncludes(html, 'placeholder="outputs/example.txt"')
  assertStringIncludes(html, 'placeholder="{{ entry.title }}"')
})

Deno.test('[contract] web pages: Config 页不应输出 raw secret', () => {
  const html = renderToString(
    ConfigPage({
      workbench: {
        ...workbench,
        global: {
          ...workbench.global,
          ai: {
            defaultModel: 'claude',
            providers: {
              anthropic: {
                type: 'anthropic',
                apiKey: '__KNOCK_SECRET_UNCHANGED__',
                models: {},
              },
            },
          },
          aiJson:
            '{\n  "providers": {\n    "anthropic": {\n      "apiKey": "__KNOCK_SECRET_UNCHANGED__"\n    }\n  }\n}',
        },
        deliveries: [
          {
            id: 'mailer',
            enabled: true,
            kind: 'email',
            config: {
              smtp: {
                host: 'smtp.example.com',
                port: 587,
                security: 'starttls',
                auth: {
                  username: 'bot',
                  password: '__KNOCK_SECRET_UNCHANGED__',
                },
              },
              message: {
                from: 'noreply@example.com',
                to: ['ops@example.com'],
                subject: 'hello',
                text: 'body',
              },
            },
            configJson:
              '{\n  "smtp": {\n    "auth": {\n      "password": "__KNOCK_SECRET_UNCHANGED__"\n    }\n  }\n}',
          },
        ],
      },
    }),
  )

  assertEquals(html.includes('real-secret'), false)
  assertStringIncludes(html, '__KNOCK_SECRET_UNCHANGED__')
})
