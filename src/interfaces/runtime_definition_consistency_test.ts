import { assertEquals } from '@std/assert'
import { join } from '@std/path'
import { loadConfig } from '../config/load_config.ts'
import type { DeliveryBinding } from '../domain/run_plan.ts'
import type { SourceDefinition } from '../domain/source_definition.ts'
import {
  RunSourceUseCase,
  type RunSourceRequest,
  type RunSourceResult,
} from '../application/run_source_use_case.ts'
import { withOwnedRuntime } from '../test_runtime.ts'
import { createProductionRuntime } from '../composition/create_production_runtime.ts'
import { executePreviewSource } from './web/preview_runtime.ts'

type RuntimeExecution = {
  source: SourceDefinition
  bindings: DeliveryBinding[]
}

function captureExecution(input: RunSourceRequest): RuntimeExecution {
  return {
    source: structuredClone(input.source),
    bindings: structuredClone(input.bindings ?? []),
  }
}

function createStubResult(input: RunSourceRequest): RunSourceResult {
  return {
    plan: {
      runId: `run-${input.source.sourceId}`,
      source: input.source,
      profile: input.profile,
      effectDomain: input.effectDomain,
      trigger: input.trigger,
      scheduledAt: input.scheduledAt ?? '2026-04-17T10:00:00.000Z',
      bindings: input.bindings ?? [],
    },
    fetchedInput: {
      kind: input.source.kind,
      collectedAt: '2026-04-17T10:00:00.000Z',
      payloadSummary: {
        hash: `hash-${input.source.sourceId}`,
      },
    },
    parsed: {
      sourceKind: input.source.kind,
      parser: input.source.kind === 'summary' ? 'summary' : 'rss',
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
    },
  }
}

function sortExecutions(executions: RuntimeExecution[]): RuntimeExecution[] {
  return [...executions].sort((left, right) =>
    left.source.sourceId.localeCompare(right.source.sourceId),
  )
}

Deno.test(
  '[contract] runtime definitions: daemon 与 preview 应看到一致的 SourceDefinition 与 DeliveryBinding',
  async () => {
    await withOwnedRuntime(async ({ runtimeDir }) => {
      await Deno.writeTextFile(
        join(runtimeDir, 'config.yml'),
        `
language: zh-CN
timezone: UTC
timestampFormat: yyyy-MM-dd HH:mm:ss

sqlite:
  path: facts.db

deliveries:
  archive:
    file:
      path: outputs/archive.md
      content: '{{ entry.title }}'
  webhook:
    push:
      http:
        url: https://example.com/hook
      request:
        payload:
          text: '{{ entry.title }}'
  mailer:
    email:
      smtp:
        host: smtp.example.com
        port: 587
        security: starttls
      message:
        from: bot@example.com
        to:
          - ops@example.com
        subject: '[{{ source.title }}] {{ entry.title }}'
        text: '{{ entry.description }}'

sources:
  rust:
    schedule: '* * * * *'
    http:
      url: https://example.com/feed.xml
    syndication: {}
    deliveries:
      archive: {}
      webhook: {}
      mailer: {}

  digest:
    schedule: '* * * * *'
    summary:
      sources:
        - rust
    deliveries:
      archive: {}
      webhook: {}
      mailer: {}
`,
      )

      const config = await loadConfig({ runtimeDir })
      const rustSource = config.sources.find((source) => source.id === 'rust')
      const digestSource = config.sources.find((source) => source.id === 'digest')
      if (!rustSource || !digestSource) {
        throw new Error('测试配置缺少 rust 或 digest source')
      }

      const previewCalls: RuntimeExecution[] = []
      const daemonCalls: RuntimeExecution[] = []
      const originalExecute = RunSourceUseCase.prototype.execute

      try {
        let currentCollector = previewCalls
        RunSourceUseCase.prototype.execute = function (
          input: RunSourceRequest,
        ): Promise<RunSourceResult> {
          currentCollector.push(captureExecution(input))
          return Promise.resolve(createStubResult(input))
        }

        await executePreviewSource({
          config,
          source: rustSource,
        })
        await executePreviewSource({
          config,
          source: digestSource,
        })

        currentCollector = daemonCalls
        const daemon = createProductionRuntime({
          config,
          keepAlive: false,
        })
        try {
          await daemon.runImmediate()
        } finally {
          daemon.stop()
        }
      } finally {
        RunSourceUseCase.prototype.execute = originalExecute
      }

      assertEquals(sortExecutions(previewCalls), sortExecutions(daemonCalls))
      assertEquals(sortExecutions(previewCalls), [
        {
          source: {
            kind: 'summary',
            sourceId: 'digest',
            upstreamSourceIds: ['rust'],
          },
          bindings: [
            {
              sourceId: 'digest',
              deliveryId: 'archive',
              definition: {
                kind: 'file',
                deliveryId: 'archive',
                path: join(runtimeDir, 'outputs/archive.md'),
                contentTemplate: '{{ entry.title }}',
                rotation: undefined,
              },
            },
            {
              sourceId: 'digest',
              deliveryId: 'webhook',
              definition: {
                kind: 'push',
                deliveryId: 'webhook',
                http: {
                  method: 'POST',
                  url: 'https://example.com/hook',
                  headers: undefined,
                },
                requestType: 'body',
                payloadTemplate: {
                  text: '{{ entry.title }}',
                },
                response: undefined,
              },
            },
            {
              sourceId: 'digest',
              deliveryId: 'mailer',
              definition: {
                kind: 'email',
                deliveryId: 'mailer',
                smtp: {
                  host: 'smtp.example.com',
                  port: 587,
                  security: 'starttls',
                  auth: undefined,
                },
                messageTemplate: {
                  from: 'bot@example.com',
                  to: ['ops@example.com'],
                  cc: undefined,
                  bcc: undefined,
                  replyTo: undefined,
                  subject: '[{{ source.title }}] {{ entry.title }}',
                  text: '{{ entry.description }}',
                  headers: undefined,
                },
              },
            },
          ],
        },
        {
          source: {
            kind: 'fetch',
            sourceId: 'rust',
            fetcher: 'http',
            parser: 'syndication',
          },
          bindings: [
            {
              sourceId: 'rust',
              deliveryId: 'archive',
              definition: {
                kind: 'file',
                deliveryId: 'archive',
                path: join(runtimeDir, 'outputs/archive.md'),
                contentTemplate: '{{ entry.title }}',
                rotation: undefined,
              },
            },
            {
              sourceId: 'rust',
              deliveryId: 'webhook',
              definition: {
                kind: 'push',
                deliveryId: 'webhook',
                http: {
                  method: 'POST',
                  url: 'https://example.com/hook',
                  headers: undefined,
                },
                requestType: 'body',
                payloadTemplate: {
                  text: '{{ entry.title }}',
                },
                response: undefined,
              },
            },
            {
              sourceId: 'rust',
              deliveryId: 'mailer',
              definition: {
                kind: 'email',
                deliveryId: 'mailer',
                smtp: {
                  host: 'smtp.example.com',
                  port: 587,
                  security: 'starttls',
                  auth: undefined,
                },
                messageTemplate: {
                  from: 'bot@example.com',
                  to: ['ops@example.com'],
                  cc: undefined,
                  bcc: undefined,
                  replyTo: undefined,
                  subject: '[{{ source.title }}] {{ entry.title }}',
                  text: '{{ entry.description }}',
                  headers: undefined,
                },
              },
            },
          ],
        },
      ])
    })
  },
)
