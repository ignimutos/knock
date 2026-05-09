import { Cron } from 'croner'
import { RunDueSourcesUseCase } from '../application/run_due_sources_use_case.ts'
import type { SourceQueryService } from '../application/ports/query_service.ts'
import type { RunSourceUseCase } from '../application/run_source/run_source_use_case.ts'
import type { AppConfigResolved, ResolvedSourceConfig } from '../config/types.ts'
import type { DefinitionSet } from '../definitions/definition_set.ts'

export interface RuntimeKernel {
  sourceQueryService: SourceQueryService
  runDueSourcesUseCase: RunDueSourcesUseCase
  sourceConfigs: ResolvedSourceConfig[]
}

export function createRuntimeKernel(input: {
  config: AppConfigResolved
  definitions: DefinitionSet
  now: () => string
  runSourceUseCase: Pick<RunSourceUseCase, 'execute'>
}): RuntimeKernel {
  const sourceConfigs = input.config.sources
  const sourceById = new Map(
    input.definitions.sources.map((source) => [source.sourceId, source] as const),
  )
  const bindingsBySourceId = new Map<string, (typeof input.definitions.bindings)[number][]>()
  const scheduleMatcherBySourceId = new Map<string, Cron>()

  for (const binding of input.definitions.bindings) {
    const existing = bindingsBySourceId.get(binding.sourceId) ?? []
    existing.push(binding)
    bindingsBySourceId.set(binding.sourceId, existing)
  }

  for (const sourceConfig of sourceConfigs) {
    if (!sourceConfig.schedule) continue
    scheduleMatcherBySourceId.set(
      sourceConfig.id,
      new Cron(sourceConfig.schedule, {
        paused: true,
        timezone: input.config.timezone,
      }),
    )
  }

  const sourceQueryService: SourceQueryService = {
    getSource: (sourceId) => Promise.resolve(sourceById.get(sourceId)),
    getBindings: (sourceId) => Promise.resolve(bindingsBySourceId.get(sourceId) ?? []),
    listDueSources: (at, trigger) => {
      const dueSources = []

      for (const sourceConfig of sourceConfigs) {
        if (!sourceConfig.enabled) continue
        if (trigger === 'scheduled') {
          const scheduleMatcher = scheduleMatcherBySourceId.get(sourceConfig.id)
          if (!scheduleMatcher) continue
          if (!scheduleMatcher.match(at)) {
            continue
          }
        }

        const source = sourceById.get(sourceConfig.id)
        if (!source) {
          throw new Error(`source 未定义: ${sourceConfig.id}`)
        }

        dueSources.push({
          source,
          bindings: bindingsBySourceId.get(sourceConfig.id) ?? [],
        })
      }

      return Promise.resolve(dueSources)
    },
  }

  return {
    sourceQueryService,
    runDueSourcesUseCase: new RunDueSourcesUseCase({
      now: input.now,
      sourceQueryService,
      runSourceUseCase: input.runSourceUseCase,
    }),
    sourceConfigs,
  }
}
