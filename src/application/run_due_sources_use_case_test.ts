import { assertEquals } from '@std/assert'
import type { RunSourceResult } from './run_source_use_case.ts'
import { RunDueSourcesUseCase } from './run_due_sources_use_case.ts'

// risk-id: R15
// layer: flow

Deno.test(
  '[flow] R15 runDueSourcesUseCase: due 判定时刻应原样传入 RunSourceUseCase.scheduledAt',
  async () => {
    const scheduledAt = '2026-04-13T10:00:00.000Z'
    const seenScheduledAt: string[] = []
    const useCase = new RunDueSourcesUseCase({
      now: () => scheduledAt,
      sourceQueryService: {
        getSource: () => Promise.resolve(undefined),
        getBindings: () => Promise.resolve([]),
        listDueSources: (at) => {
          assertEquals(at, scheduledAt)
          return Promise.resolve([
            {
              source: {
                kind: 'fetch',
                sourceId: 'rust',
                fetcher: 'http',
                parser: 'syndication',
              },
              bindings: [],
            },
          ])
        },
      },
      runSourceUseCase: {
        execute: (input) => {
          seenScheduledAt.push(input.scheduledAt ?? 'missing')
          return Promise.resolve({} as RunSourceResult)
        },
      },
    })

    await useCase.execute()

    assertEquals(seenScheduledAt, [scheduledAt])
  },
)
