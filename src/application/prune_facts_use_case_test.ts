import { assertEquals } from '@std/assert'
import type { PruneFactsInput } from './ports/prune_facts_repository.ts'
import { PruneFactsUseCase } from './prune_facts_use_case.ts'
import { test } from '../testing/test_api.ts'

test('[contract] pruneFactsUseCase: 应转发 retention 参数到 repository', async () => {
  const calls: PruneFactsInput[] = []
  const useCase = new PruneFactsUseCase({
    now: () => '2026-04-18T12:45:00.000Z',
    pruneFactsRepository: {
      prune: (input) => {
        calls.push(input)
        return Promise.resolve({
          deletedRuns: 2,
          deletedItems: 4,
          deletedAttempts: 4,
          deletedDeduplications: 3,
        })
      },
    },
  })

  const result = await useCase.execute({
    maxAge: '30d',
    maxEntriesPerSource: 1000,
  })

  assertEquals(result, {
    deletedRuns: 2,
    deletedItems: 4,
    deletedAttempts: 4,
    deletedDeduplications: 3,
  })
  assertEquals(calls, [
    {
      now: '2026-04-18T12:45:00.000Z',
      maxAge: '30d',
      maxEntriesPerSource: 1000,
    },
  ])
})
