import { assertEquals } from '../testing/assert.ts'
import type { PreviewRunUseCaseDeps } from './preview_run_use_case.ts'
import { PreviewRunUseCase } from './preview_run_use_case.ts'
import { test } from '../testing/test_api.ts'

// risk-id: R18
// layer: contract

test('[contract] previewRunUseCase: preview profile 应生成 effectDomain=preview 的 RunPlan', async () => {
  const deps: PreviewRunUseCaseDeps = {
    runSourceUseCase: {
      plan: (input) =>
        Promise.resolve({
          runId: 'run-preview',
          source: input.source,
          profile: input.profile,
          effectDomain: input.effectDomain,
          trigger: input.trigger,
          scheduledAt: input.scheduledAt ?? '2026-04-13T09:00:00.000Z',
          bindings: input.bindings ?? [],
        }),
      collect: (input) =>
        Promise.resolve({
          plan: {
            runId: 'run-preview',
            source: input.source,
            profile: input.profile,
            effectDomain: input.effectDomain,
            trigger: input.trigger,
            scheduledAt: input.scheduledAt ?? '2026-04-13T09:00:00.000Z',
            bindings: input.bindings ?? [],
          },
          fetchedInput: {
            kind: input.source.kind,
            collectedAt: '2026-04-13T09:00:00.000Z',
            payloadSummary: { hash: 'hash-preview' },
          },
          parsed: {
            sourceKind: input.source.kind,
            parser: input.source.kind === 'summary' ? 'summary' : 'rss',
            diagnostics: [],
            feed: {
              title: 'Preview Feed',
              link: '',
              description: '',
              generator: '',
              language: '',
              published: '',
            },
            items: [],
          },
        }),
      execute: (input) =>
        Promise.resolve({
          plan: {
            runId: 'run-preview',
            source: input.source,
            profile: input.profile,
            effectDomain: input.effectDomain,
            trigger: input.trigger,
            scheduledAt: input.scheduledAt ?? '2026-04-13T09:00:00.000Z',
            bindings: input.bindings ?? [],
          },
          fetchedInput: {
            kind: input.source.kind,
            collectedAt: '2026-04-13T09:00:00.000Z',
            payloadSummary: { hash: 'hash-preview' },
          },
          parsed: {
            sourceKind: input.source.kind,
            parser: input.source.kind === 'summary' ? 'summary' : 'rss',
            diagnostics: [],
            feed: {
              title: 'Preview Feed',
              link: '',
              description: '',
              generator: '',
              language: '',
              published: '',
            },
            items: [],
          },
        }),
    },
  }

  const useCase = new PreviewRunUseCase(deps)

  const result = await useCase.execute({
    source: {
      kind: 'fetch',
      sourceId: 'rust',
      fetcher: 'http',
      parser: 'syndication',
    },
  })

  assertEquals(result.plan.profile, 'preview')
  assertEquals(result.plan.effectDomain, 'preview')
  assertEquals(result.plan.trigger, 'preview')
  assertEquals(result.plan.source.sourceId, 'rust')
  assertEquals(result.parsed.sourceKind, 'fetch')
})

test('[contract] previewRunUseCase: collect 应预留 preview collect 包装层', async () => {
  const deps: PreviewRunUseCaseDeps = {
    runSourceUseCase: {
      plan: (input) =>
        Promise.resolve({
          runId: 'run-preview',
          source: input.source,
          profile: input.profile,
          effectDomain: input.effectDomain,
          trigger: input.trigger,
          scheduledAt: input.scheduledAt ?? '2026-04-13T09:00:00.000Z',
          bindings: input.bindings ?? [],
        }),
      collect: (input) =>
        Promise.resolve({
          plan: {
            runId: 'run-preview-collect',
            source: input.source,
            profile: input.profile,
            effectDomain: input.effectDomain,
            trigger: input.trigger,
            scheduledAt: input.scheduledAt ?? '2026-04-13T09:05:00.000Z',
            bindings: input.bindings ?? [],
          },
          fetchedInput: {
            kind: input.source.kind,
            collectedAt: '2026-04-13T09:05:00.000Z',
            payloadSummary: { hash: 'hash-preview-collect' },
          },
          parsed: {
            sourceKind: input.source.kind,
            parser: input.source.kind === 'summary' ? 'summary' : 'rss',
            diagnostics: [],
            feed: {
              title: 'Preview Feed',
              link: '',
              description: '',
              generator: '',
              language: '',
              published: '',
            },
            items: [],
          },
        }),
      execute: (input) =>
        Promise.resolve({
          plan: {
            runId: 'run-preview',
            source: input.source,
            profile: input.profile,
            effectDomain: input.effectDomain,
            trigger: input.trigger,
            scheduledAt: input.scheduledAt ?? '2026-04-13T09:00:00.000Z',
            bindings: input.bindings ?? [],
          },
          fetchedInput: {
            kind: input.source.kind,
            collectedAt: '2026-04-13T09:00:00.000Z',
            payloadSummary: { hash: 'hash-preview' },
          },
          parsed: {
            sourceKind: input.source.kind,
            parser: input.source.kind === 'summary' ? 'summary' : 'rss',
            diagnostics: [],
            feed: {
              title: 'Preview Feed',
              link: '',
              description: '',
              generator: '',
              language: '',
              published: '',
            },
            items: [],
          },
        }),
    },
  }

  const useCase = new PreviewRunUseCase(deps)

  const result = await useCase.collect({
    source: {
      kind: 'fetch',
      sourceId: 'rust',
      fetcher: 'http',
      parser: 'syndication',
    },
  })

  assertEquals(result.plan.profile, 'preview')
  assertEquals(result.plan.effectDomain, 'preview')
  assertEquals(result.plan.trigger, 'preview')
  assertEquals(result.plan.runId, 'run-preview-collect')
  assertEquals(result.parsed.sourceKind, 'fetch')
})
export const testMeta = [
  {
    title: '__file__',
    layer: 'contract',
    risks: ['R18'],
  },
] as const
