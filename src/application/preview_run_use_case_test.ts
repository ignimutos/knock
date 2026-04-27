import { assertEquals } from '@std/assert'
import type { PreviewRunRequest } from './preview_run_use_case.ts'
import { PreviewRunUseCase } from './preview_run_use_case.ts'
import { test } from '../testing/test_api.ts'

test('[contract] previewRunUseCase: 应强制 preview 语义并暴露 plan/collect/execute', async () => {
  const calls: string[] = []
  const useCase = new PreviewRunUseCase({
    runSourceUseCase: {
      plan: (input) => {
        calls.push(`plan:${input.profile}:${input.effectDomain}:${input.trigger}`)
        return Promise.resolve({
          runId: 'run-preview-plan',
          source: input.source,
          profile: input.profile,
          effectDomain: input.effectDomain,
          trigger: input.trigger,
          scheduledAt: input.scheduledAt ?? '2026-04-17T13:20:00.000Z',
          bindings: input.bindings ?? [],
        })
      },
      collect: (input) => {
        calls.push(`collect:${input.profile}:${input.effectDomain}:${input.trigger}`)
        return Promise.resolve({
          plan: {
            runId: 'run-preview-collect',
            source: input.source,
            profile: input.profile,
            effectDomain: input.effectDomain,
            trigger: input.trigger,
            scheduledAt: input.scheduledAt ?? '2026-04-17T13:20:00.000Z',
            bindings: input.bindings ?? [],
          },
          fetchedInput: {
            kind: input.source.kind,
            collectedAt: '2026-04-17T13:20:00.000Z',
            payloadSummary: { hash: 'hash-preview-collect' },
          },
          parsed: {
            sourceKind: input.source.kind,
            parser: input.source.kind === 'summary' ? 'summary' : 'rss',
            diagnostics: [],
            feed: {
              title: 'Feed',
              link: '',
              description: '',
              generator: '',
              language: '',
              published: '',
            },
            items: [],
          },
        })
      },
      execute: (input) => {
        calls.push(`execute:${input.profile}:${input.effectDomain}:${input.trigger}`)
        return Promise.resolve({
          plan: {
            runId: 'run-preview-execute',
            source: input.source,
            profile: input.profile,
            effectDomain: input.effectDomain,
            trigger: input.trigger,
            scheduledAt: input.scheduledAt ?? '2026-04-17T13:20:00.000Z',
            bindings: input.bindings ?? [],
          },
          fetchedInput: {
            kind: input.source.kind,
            collectedAt: '2026-04-17T13:20:00.000Z',
            payloadSummary: { hash: 'hash-preview-execute' },
          },
          parsed: {
            sourceKind: input.source.kind,
            parser: input.source.kind === 'summary' ? 'summary' : 'rss',
            diagnostics: [],
            feed: {
              title: 'Feed',
              link: '',
              description: '',
              generator: '',
              language: '',
              published: '',
            },
            items: [],
          },
        })
      },
    },
  })

  const request: PreviewRunRequest = {
    source: {
      kind: 'fetch',
      sourceId: 'rust',
      fetcher: 'http',
      parser: 'syndication',
    },
  }

  const plan = await useCase.plan(request)
  const collected = await useCase.collect(request)
  const executed = await useCase.execute(request)

  assertEquals(plan.profile, 'preview')
  assertEquals(collected.plan.effectDomain, 'preview')
  assertEquals(executed.plan.trigger, 'preview')
  assertEquals(calls, [
    'plan:preview:preview:preview',
    'collect:preview:preview:preview',
    'execute:preview:preview:preview',
  ])
})
