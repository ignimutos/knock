import { assertEquals } from '@std/assert'
import type { PreviewSourceUseCaseDeps } from './preview_source_use_case.ts'
import { PreviewSourceUseCase } from './preview_source_use_case.ts'

// risk-id: R18
// layer: contract

Deno.test(
  '[contract] previewSourceUseCase: preview profile 应生成 effectDomain=preview 的 RunPlan',
  async () => {
    const deps: PreviewSourceUseCaseDeps = {
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

    const useCase = new PreviewSourceUseCase(deps)

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
  },
)
