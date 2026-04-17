import { assertEquals, assertRejects } from '@std/assert'
import { createInMemoryDb } from '../db/client.ts'
import { createLogger } from '../core/logger.ts'
import {
  createRunSourceUseCaseForRuntime,
  createSourceRuntimeSharedDeps,
} from './create_source_execution_core.ts'

Deno.test(
  '[contract] createRunSourceUseCaseForRuntime: production wiring 缺少完整 pipeline deps 时应 fail fast',
  async () => {
    await assertRejects(
      async () =>
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
      Error,
      'production run source wiring 缺少完整 pipeline 依赖',
    )
  },
)

Deno.test(
  '[contract] createRunSourceUseCaseForRuntime: preview wiring 缺少 pipeline deps 时仍应允许 collect-only',
  async () => {
    const useCase = createRunSourceUseCaseForRuntime({
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

    const result = await useCase.execute({
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

    assertEquals(result.plan.runId, 'run-preview-collect-only')
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
