import { assertEquals } from '@std/assert'
import type { PreviewRunRequest } from '../../application/preview_run_use_case.ts'
import type { RunSourceResult } from '../../application/run_source_use_case.ts'
import type { SourceDefinition } from '../../domain/source_definition.ts'
import { createPreviewRuntime } from './preview_runtime.ts'
import { test } from '../../testing/test_api.ts'

test('[contract] R18 previewRuntime: 应走 preview profile 并落 preview domain facts', async () => {
  const calls: PreviewRunRequest[] = []
  const runtime = createPreviewRuntime({
    previewRunUseCase: {
      execute: (input: PreviewRunRequest): Promise<RunSourceResult> => {
        calls.push(input)
        return Promise.resolve({
          plan: {
            runId: 'run-preview',
            source: input.source,
            profile: 'preview',
            effectDomain: 'preview',
            trigger: 'preview',
            scheduledAt: '2026-04-13T09:00:00.000Z',
            bindings: input.bindings ?? [],
          },
          fetchedInput: {
            kind: input.source.kind,
            collectedAt: '2026-04-13T09:00:00.000Z',
            payloadSummary: { hash: 'hash-preview' },
          },
          parsed: {
            sourceKind: input.source.kind,
            parser: input.source.kind === 'summary' ? 'summary' : 'xquery',
            diagnostics: [],
            feed: {
              title: 'Preview Feed',
              link: '',
              description: '',
              generator: '',
              language: '',
              published: '',
            },
            items: [
              {
                id: 'item-1',
                title: 'Preview Entry',
                link: '',
                description: '',
                content: '',
                published: '',
                updated: '',
              },
            ],
          },
        })
      },
    },
    parseRequest: (request: { warnings: string[] }) => ({
      source: {
        kind: 'fetch',
        sourceId: 'playground',
        fetcher: 'http',
        parser: 'xquery',
      } satisfies SourceDefinition,
      warnings: request.warnings,
    }),
    toResponse: ({ warnings, result }) => ({
      warnings,
      parser: result.parsed.parser,
      rawContent: '<html></html>',
      feed: result.parsed.feed,
      entries: result.parsed.items,
      fetchMeta: { ok: true },
    }),
  })

  const result = await runtime.evaluate({ warnings: ['script 模式下 namespaces 不生效'] })

  assertEquals(calls.length, 1)
  assertEquals(calls[0]?.source.sourceId, 'playground')
  assertEquals(result.parser, 'xquery')
  assertEquals(result.warnings, ['script 模式下 namespaces 不生效'])
  assertEquals('plan' in result, false)
})
