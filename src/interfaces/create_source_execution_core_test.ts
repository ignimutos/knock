import { assertEquals, assertRejects } from '@std/assert'
import { createInMemoryDb } from '../db/client.ts'
import { createLogger } from '../core/logger.ts'
import { CollectSourceUseCase } from '../application/collect_source_use_case.ts'
import {
  createRunSourceUseCaseForRuntime,
  createSourceRuntimeSharedDeps,
} from '../composition/create_runtime_kernel.ts'

Deno.test(
  '[contract] createRunSourceUseCaseForRuntime: production wiring 缺少完整 pipeline deps 时应 fail fast',
  async () => {
    await assertRejects(
      () =>
        Promise.resolve().then(() =>
          createRunSourceUseCaseForRuntime({
            requireFullPipeline: true,
            now: () => '2026-04-17T12:00:00.000Z',
            createRunId: () => 'run-prod-fail-fast',
            sourceInputGateway: {
              fetch: () =>
                Promise.resolve({
                  kind: 'fetch',
                  collectedAt: '2026-04-17T12:00:00.000Z',
                  payloadSummary: { hash: 'hash-1' },
                }),
            },
            sourceParser: {
              parse: () =>
                Promise.resolve({
                  sourceKind: 'fetch',
                  parser: 'rss',
                  diagnostics: [],
                  feed: {
                    title: '',
                    link: '',
                    description: '',
                    generator: '',
                    language: '',
                    published: '',
                  },
                  items: [],
                }),
            },
            pipeline: {
              deliveryExecutors: {
                file: { execute: () => Promise.resolve() },
                push: { execute: () => Promise.resolve() },
              } as never,
            },
          }),
        ),
      Error,
      'production run source wiring 缺少完整 pipeline 依赖',
    )
  },
)

Deno.test(
  '[contract] createRunSourceUseCaseForRuntime: preview execute 缺少 pipeline deps 时应 fail fast',
  async () => {
    const runSourceUseCase = createRunSourceUseCaseForRuntime({
      now: () => '2026-04-17T12:05:00.000Z',
      createRunId: () => 'run-preview-collect-only',
      sourceInputGateway: {
        fetch: () =>
          Promise.resolve({
            kind: 'fetch',
            collectedAt: '2026-04-17T12:05:00.000Z',
            payloadSummary: { hash: 'hash-preview' },
          }),
      },
      sourceParser: {
        parse: () =>
          Promise.resolve({
            sourceKind: 'fetch',
            parser: 'rss',
            diagnostics: [],
            feed: {
              title: '',
              link: '',
              description: '',
              generator: '',
              language: '',
              published: '',
            },
            items: [],
          }),
      },
    })
    const collectUseCase = new CollectSourceUseCase({
      runSourceUseCase,
    })

    const collected = await collectUseCase.execute({
      source: {
        kind: 'fetch',
        sourceId: 'rust',
        fetcher: 'http',
        parser: 'syndication',
      },
      profile: 'preview',
      effectDomain: 'preview',
      trigger: 'preview',
    })
    assertEquals(collected.plan.runId, 'run-preview-collect-only')

    await assertRejects(
      () =>
        runSourceUseCase.execute({
          source: {
            kind: 'fetch',
            sourceId: 'rust',
            fetcher: 'http',
            parser: 'syndication',
          },
          profile: 'preview',
          effectDomain: 'preview',
          trigger: 'preview',
        }),
      Error,
      'run source execute 缺少完整 pipeline 依赖',
    )
  },
)

Deno.test(
  '[contract] createRunSourceUseCaseForRuntime: daemon production wiring 有完整 pipeline 时不应退化为 collect-only',
  async () => {
    let insertedRuns = 0
    const useCase = createRunSourceUseCaseForRuntime({
      requireFullPipeline: true,
      now: () => '2026-04-17T12:10:00.000Z',
      createRunId: () => 'run-prod-full-pipeline',
      sourceInputGateway: {
        fetch: () =>
          Promise.resolve({
            kind: 'fetch',
            collectedAt: '2026-04-17T12:10:00.000Z',
            payloadSummary: { hash: 'hash-prod' },
          }),
      },
      sourceParser: {
        parse: () =>
          Promise.resolve({
            sourceKind: 'fetch',
            parser: 'rss',
            diagnostics: [],
            feed: {
              title: '',
              link: '',
              description: '',
              generator: '',
              language: '',
              published: '',
            },
            items: [],
          }),
      },
      pipeline: {
        runRepository: {
          insert: () => {
            insertedRuns += 1
            return Promise.resolve()
          },
          update: () => Promise.resolve(),
          setFeedSnapshot: () => Promise.resolve(),
        },
        itemRepository: {
          insertMany: () => Promise.resolve(),
          updateStatus: () => Promise.resolve(),
        },
        deliveryAttemptRepository: {
          insertPlanned: () => Promise.resolve(),
          finish: () => Promise.resolve(),
        },
        deduplicationRepository: {
          isItemDuplicate: () => Promise.resolve(false),
          registerItemFingerprint: () => Promise.resolve(),
          isDeliveryDuplicate: () => Promise.resolve(false),
          registerDeliveryFingerprint: () => Promise.resolve(),
        },
        deliveryExecutors: {
          file: { execute: () => Promise.resolve() },
          push: { execute: () => Promise.resolve() },
          email: { execute: () => Promise.resolve() },
        },
      },
    })

    await useCase.execute({
      source: {
        kind: 'fetch',
        sourceId: 'rust',
        fetcher: 'http',
        parser: 'syndication',
      },
      profile: 'production',
      effectDomain: 'production',
      trigger: 'immediate',
    })

    assertEquals(insertedRuns, 1)
  },
)

Deno.test(
  '[contract] createSourceRuntimeSharedDeps: 应保留 ai/content logger 注入能力',
  async () => {
    const lines: string[] = []
    const shared = createSourceRuntimeSharedDeps({
      config: {
        runtimeDir: '/tmp/runtime',
        language: 'zh-CN',
        timezone: 'UTC',
        timestampFormat: 'yyyy-MM-dd HH:mm:ss',
        sqlite: {
          path: '/tmp/runtime/facts.db',
          busyTimeout: '5s',
          journalMode: 'WAL',
          retention: {
            maxAge: '1d',
            maxEntriesPerSource: 100,
            vacuum: 'off',
          },
        },
        ai: {
          providers: [
            {
              id: 'openai_main',
              type: 'openai',
              apiKey: 'test-key',
              models: [
                {
                  id: 'default',
                  providerId: 'openai_main',
                  providerType: 'openai',
                  ref: 'openai_main/default',
                  model: 'gpt-4o-mini',
                  context: 8192,
                  maxOutputTokens: 400,
                  temperature: 0.2,
                  options: {},
                  variants: {},
                },
              ],
            },
          ],
          defaultModel: {
            ref: 'openai_main/default',
            providerId: 'openai_main',
            modelId: 'default',
          },
          modelRefs: {
            'openai_main/default': {
              ref: 'openai_main/default',
              providerId: 'openai_main',
              modelId: 'default',
            },
          },
        },
        deliveries: [],
        sources: [],
        logging: {
          level: 'info',
          sinks: {
            console: {
              type: 'console',
              format: 'jsonl',
            },
          },
        },
      },
      factsDb: createInMemoryDb(),
      sourceConfigsById: {},
      contentLogger: createLogger({
        enabled: true,
        level: 'info',
        module: 'content.render',
        writeStdout: (line) => lines.push(line),
      }),
    })

    await shared.contentRuntime.renderContent('{{ entry.title | to_telegram_html }}', {
      entry: { title: '<b>Hello</b><script>alert(1)</script>' },
      source: { id: 's1' },
      feed: {},
    })

    assertEquals(
      lines.some((line) => line.includes('content.render')),
      true,
    )
  },
)
