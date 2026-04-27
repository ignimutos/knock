import { assertEquals, assertRejects } from '@std/assert'
import { createInMemoryDb } from '../db/client.ts'
import { withOwnedRuntime } from '../test_runtime.ts'
import { createPreviewComposition } from './create_preview_runtime.ts'
import { test } from '../testing/test_api.ts'

test('[contract] preview composition: 应使用 capture executors 并仅记录 attempt', async () => {
  await withOwnedRuntime(async ({ runtimeDir }) => {
    const captured: string[] = []
    const runtime = createPreviewComposition({
      config: {
        runtimeDir,
        language: 'zh-CN',
        timezone: 'UTC',
        timestampFormat: 'yyyy-MM-dd HH:mm:ss',
        sqlite: {
          path: `${runtimeDir}/facts.db`,
          busyTimeout: '5s',
          journalMode: 'WAL',
          retention: {
            maxAge: '7d',
            maxEntriesPerSource: 100,
            vacuum: 'off',
          },
        },
        deliveries: [
          {
            id: 'archive',
            file: {
              path: 'outputs/archive.md',
              content: '{{ entry.title }}',
            },
          },
        ],
        sources: [
          {
            id: 'playground',
            enabled: true,
            schedule: '*/5 * * * *',
            http: {
              url: 'https://example.com/feed.xml',
            },
            syndication: {},
            deliveries: [
              {
                id: 'archive',
                sourceId: 'playground',
                deliveryId: 'archive',
                file: {
                  path: `${runtimeDir}/outputs/archive.md`,
                  content: '{{ entry.title }}',
                },
              },
            ],
          },
        ],
        logging: { level: 'info', sinks: {} },
      },
      now: () => '2026-04-17T12:05:00.000Z',
      fetcher: () =>
        Promise.resolve(
          new Response(
            `<?xml version="1.0" encoding="UTF-8"?>
               <rss version="2.0">
                 <channel>
                   <title>Preview Feed</title>
                   <link>https://example.com</link>
                   <description>Feed description</description>
                   <item>
                     <guid>item-1</guid>
                     <title>Preview Entry</title>
                     <link>https://example.com/items/1</link>
                     <description>Entry description</description>
                   </item>
                 </channel>
               </rss>`,
          ),
        ),
      onCaptured: (plan) => captured.push(plan.deliveryId),
    })

    const result = await runtime.previewRunUseCase.execute({
      source: {
        kind: 'fetch',
        sourceId: 'playground',
        fetcher: 'http',
        parser: 'syndication',
      },
      bindings: [
        {
          sourceId: 'playground',
          deliveryId: 'archive',
          definition: {
            kind: 'file',
            deliveryId: 'archive',
            path: `${runtimeDir}/outputs/archive.md`,
            contentTemplate: '{{ entry.title }}',
          },
        },
      ],
    })

    assertEquals(result.plan.profile, 'preview')
    assertEquals(captured, ['archive'])
    assertEquals(
      await Deno.stat(`${runtimeDir}/outputs/archive.md`).then(
        () => true,
        () => false,
      ),
      false,
    )
  })
})

test('[contract] preview composition: push payload 不是 object 时应在运行期拒绝', async () => {
  await withOwnedRuntime(async ({ runtimeDir }) => {
    const runtime = createPreviewComposition({
      config: {
        runtimeDir,
        language: 'zh-CN',
        timezone: 'UTC',
        timestampFormat: 'yyyy-MM-dd HH:mm:ss',
        sqlite: {
          path: `${runtimeDir}/facts.db`,
          busyTimeout: '5s',
          journalMode: 'WAL',
          retention: {
            maxAge: '7d',
            maxEntriesPerSource: 100,
            vacuum: 'off',
          },
        },
        deliveries: [
          {
            id: 'webhook',
            push: {
              http: {
                url: 'https://example.com/hook',
                method: 'POST',
              },
              request: {
                type: 'body',
                payload: {},
              },
            },
          },
        ],
        sources: [
          {
            id: 'playground',
            enabled: true,
            schedule: '*/5 * * * *',
            http: {
              url: 'https://example.com/feed.xml',
            },
            syndication: {},
            deliveries: [
              {
                id: 'webhook',
                sourceId: 'playground',
                deliveryId: 'webhook',
                push: {
                  http: {
                    url: 'https://example.com/hook',
                    method: 'POST',
                  },
                  request: {
                    type: 'body',
                    payload: 'not-an-object',
                  },
                },
              },
            ],
          },
        ],
        logging: { level: 'info', sinks: {} },
      },
      now: () => '2026-04-17T12:05:00.000Z',
      fetcher: () =>
        Promise.resolve(
          new Response(
            `<?xml version="1.0" encoding="UTF-8"?>
               <rss version="2.0">
                 <channel>
                   <title>Preview Feed</title>
                   <link>https://example.com</link>
                   <description>Feed description</description>
                   <item>
                     <guid>item-1</guid>
                     <title>Preview Entry</title>
                     <link>https://example.com/items/1</link>
                     <description>Entry description</description>
                   </item>
                 </channel>
               </rss>`,
          ),
        ),
    })

    await assertRejects(
      () =>
        runtime.previewRunUseCase.execute({
          source: {
            kind: 'fetch',
            sourceId: 'playground',
            fetcher: 'http',
            parser: 'syndication',
          },
          bindings: [
            {
              sourceId: 'playground',
              deliveryId: 'webhook',
              definition: {
                kind: 'push',
                deliveryId: 'webhook',
                http: {
                  method: 'POST',
                  url: 'https://example.com/hook',
                },
                requestType: 'body',
                payloadTemplate: 'not-an-object',
              },
            },
          ],
        }),
      Error,
      'preview push payload 必须是 object',
    )
  })
})

test('[contract] preview composition: 注入 factsDb 时应 capture 投递且不写入 facts 表', async () => {
  await withOwnedRuntime(async ({ runtimeDir }) => {
    const factsDb = createInMemoryDb()
    const captured: string[] = []
    const runtime = createPreviewComposition({
      factsDb,
      config: {
        runtimeDir,
        language: 'zh-CN',
        timezone: 'UTC',
        timestampFormat: 'yyyy-MM-dd HH:mm:ss',
        sqlite: {
          path: `${runtimeDir}/facts.db`,
          busyTimeout: '5s',
          journalMode: 'WAL',
          retention: {
            maxAge: '7d',
            maxEntriesPerSource: 100,
            vacuum: 'off',
          },
        },
        deliveries: [
          {
            id: 'archive',
            file: {
              path: 'outputs/archive.md',
              content: '{{ entry.title }}',
            },
          },
        ],
        sources: [
          {
            id: 'playground',
            enabled: true,
            schedule: '*/5 * * * *',
            http: {
              url: 'https://example.com/feed.xml',
            },
            syndication: {},
            deliveries: [
              {
                id: 'archive',
                sourceId: 'playground',
                deliveryId: 'archive',
                file: {
                  path: `${runtimeDir}/outputs/archive.md`,
                  content: '{{ entry.title }}',
                },
              },
            ],
          },
        ],
        logging: { level: 'info', sinks: {} },
      },
      now: () => '2026-04-17T12:05:00.000Z',
      fetcher: () =>
        Promise.resolve(
          new Response(
            `<?xml version="1.0" encoding="UTF-8"?>
               <rss version="2.0">
                 <channel>
                   <title>Preview Feed</title>
                   <link>https://example.com</link>
                   <description>Feed description</description>
                   <item>
                     <guid>item-1</guid>
                     <title>Preview Entry</title>
                     <link>https://example.com/items/1</link>
                     <description>Entry description</description>
                   </item>
                 </channel>
               </rss>`,
          ),
        ),
      onCaptured: (plan) => captured.push(plan.deliveryId),
    })

    const result = await runtime.previewRunUseCase.execute({
      source: {
        kind: 'fetch',
        sourceId: 'playground',
        fetcher: 'http',
        parser: 'syndication',
      },
      bindings: [
        {
          sourceId: 'playground',
          deliveryId: 'archive',
          definition: {
            kind: 'file',
            deliveryId: 'archive',
            path: `${runtimeDir}/outputs/archive.md`,
            contentTemplate: '{{ entry.title }}',
          },
        },
      ],
    })

    assertEquals(result.plan.profile, 'preview')
    assertEquals(captured, ['archive'])

    const countRows = (tableName: string): number => {
      const row = factsDb.$client.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as {
        count: number
      }
      return row.count
    }

    assertEquals(countRows('source_runs'), 0)
    assertEquals(countRows('pipeline_items'), 0)
    assertEquals(countRows('delivery_attempts'), 0)
    assertEquals(countRows('deduplications'), 0)

    factsDb.$client.close()
  })
})
