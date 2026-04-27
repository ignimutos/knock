import { assertEquals } from '@std/assert'
import type { SourceRunView } from './ports/source_run_query_service.ts'
import { QueryRunsUseCase } from './query_runs_use_case.ts'
import { test } from '../testing/test_api.ts'

test('[contract] queryRunsUseCase: 应返回 run + items + attempts 的最小视图', async () => {
  const expected: SourceRunView = {
    run: {
      runId: 'run-1',
      sourceId: 'rust',
      trigger: 'scheduled',
      profile: 'production',
      effectDomain: 'production',
      status: 'success',
      scheduledAt: '2026-04-17T12:40:00.000Z',
      startedAt: '2026-04-17T12:40:01.000Z',
      finishedAt: '2026-04-17T12:40:02.000Z',
      counts: {
        fetchedCount: 1,
        parsedCount: 1,
        filteredCount: 0,
        duplicateItemCount: 0,
        deliveredCount: 1,
        failedAttemptCount: 0,
        skippedCount: 0,
      },
    },
    items: [],
    attempts: [],
  }
  const useCase = new QueryRunsUseCase({
    sourceRunQueryService: {
      getRun: () => Promise.resolve(expected),
    },
  })

  const view = await useCase.getRun('run-1')

  assertEquals(view, expected)
})

test('[contract] queryRunsUseCase: 未命中 run 时应返回 undefined', async () => {
  const useCase = new QueryRunsUseCase({
    sourceRunQueryService: {
      getRun: () => Promise.resolve(undefined),
    },
  })

  assertEquals(await useCase.getRun('run-missing'), undefined)
})
