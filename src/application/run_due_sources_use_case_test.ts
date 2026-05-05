import { assertEquals, assertRejects, assert } from '../testing/assert.ts'
import type { RunSourceResult } from './run_source/run_source_use_case.ts'
import { RunDueSourcesUseCase } from './run_due_sources_use_case.ts'
import { test } from '../testing/test_api.ts'

// risk-id: R15
// layer: flow

test('[flow] R15 runDueSourcesUseCase: due 判定时刻应原样传入 RunSourceUseCase.scheduledAt', async () => {
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

  await useCase.execute({ trigger: 'scheduled' })

  assertEquals(seenScheduledAt, [scheduledAt])
})

test('[contract] runDueSourcesUseCase: sourceId 模式应走 getSource/getBindings 并透传 trigger', async () => {
  const calls: string[] = []
  const useCase = new RunDueSourcesUseCase({
    now: () => '2026-04-13T11:00:00.000Z',
    sourceQueryService: {
      getSource: (sourceId) => {
        calls.push(`getSource:${sourceId}`)
        return Promise.resolve({
          kind: 'fetch',
          sourceId,
          fetcher: 'http',
          parser: 'syndication',
        })
      },
      getBindings: (sourceId) => {
        calls.push(`getBindings:${sourceId}`)
        return Promise.resolve([])
      },
      listDueSources: () => {
        calls.push('listDueSources')
        return Promise.resolve([])
      },
    },
    runSourceUseCase: {
      execute: (input) => {
        calls.push(
          `execute:${input.source.sourceId}:${input.trigger}:${input.scheduledAt ?? 'missing'}`,
        )
        return Promise.resolve({} as RunSourceResult)
      },
    },
  })

  await useCase.execute({
    trigger: 'immediate',
    sourceId: 'rust',
    scheduledAt: '2026-04-13T11:05:00.000Z',
  })

  assertEquals(calls, [
    'getSource:rust',
    'getBindings:rust',
    'execute:rust:immediate:2026-04-13T11:05:00.000Z',
  ])
})

test('[contract] runDueSourcesUseCase: sourceId 未定义时应抛错', async () => {
  const useCase = new RunDueSourcesUseCase({
    now: () => '2026-04-13T11:00:00.000Z',
    sourceQueryService: {
      getSource: () => Promise.resolve(undefined),
      getBindings: () => Promise.resolve([]),
      listDueSources: () => Promise.resolve([]),
    },
    runSourceUseCase: {
      execute: () => Promise.resolve({} as RunSourceResult),
    },
  })

  await assertRejects(
    () => useCase.execute({ trigger: 'immediate', sourceId: 'missing-source' }),
    Error,
    'source 未定义: missing-source',
  )
})

test('[contract] runDueSourcesUseCase: immediate 无 sourceId 时应通过 listDueSources 统一判定', async () => {
  const calls: string[] = []
  const useCase = new RunDueSourcesUseCase({
    now: () => '2026-04-13T12:00:00.000Z',
    sourceQueryService: {
      getSource: (sourceId) => {
        calls.push(`getSource:${sourceId}`)
        return Promise.resolve(undefined)
      },
      getBindings: (sourceId) => {
        calls.push(`getBindings:${sourceId}`)
        return Promise.resolve([])
      },
      listDueSources: (at, trigger) => {
        calls.push(`listDueSources:${trigger ?? 'missing'}:${at}`)
        return Promise.resolve([
          {
            source: {
              kind: 'fetch',
              sourceId: 'enabled',
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
        calls.push(`execute:${input.source.sourceId}:${input.trigger}`)
        return Promise.resolve({} as RunSourceResult)
      },
    },
  })

  await useCase.execute({
    trigger: 'immediate',
    scheduledAt: '2026-04-13T12:01:00.000Z',
  })

  assertEquals(calls, [
    'listDueSources:immediate:2026-04-13T12:01:00.000Z',
    'execute:enabled:immediate',
  ])
})

test('[contract] runDueSourcesUseCase: 无 sourceId 时应并发执行 due sources', async () => {
  const started: string[] = []
  let releaseFirst: (() => void) | undefined
  let secondStarted = false

  const firstDone = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })

  const useCase = new RunDueSourcesUseCase({
    now: () => '2026-04-13T12:10:00.000Z',
    sourceQueryService: {
      getSource: () => Promise.resolve(undefined),
      getBindings: () => Promise.resolve([]),
      listDueSources: () =>
        Promise.resolve([
          {
            source: {
              kind: 'fetch',
              sourceId: 'first',
              fetcher: 'http',
              parser: 'syndication',
            },
            bindings: [],
          },
          {
            source: {
              kind: 'fetch',
              sourceId: 'second',
              fetcher: 'http',
              parser: 'syndication',
            },
            bindings: [],
          },
        ]),
    },
    runSourceUseCase: {
      execute: async (input) => {
        started.push(input.source.sourceId)
        if (input.source.sourceId === 'first') {
          await firstDone
          return {} as RunSourceResult
        }
        secondStarted = true
        return {} as RunSourceResult
      },
    },
  })

  const execution = useCase.execute({
    trigger: 'immediate',
    scheduledAt: '2026-04-13T12:11:00.000Z',
  })

  await Promise.resolve()
  assert(secondStarted)
  assertEquals(started, ['first', 'second'])

  releaseFirst?.()
  await execution
})
