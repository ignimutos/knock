import type { RunSourceResult, RunSourceUseCase } from './run_source_use_case.ts'
import type { SourceQueryService } from './ports/query_service.ts'

export interface RunDueSourcesUseCaseDeps {
  now: () => string
  sourceQueryService: SourceQueryService
  runSourceUseCase: Pick<RunSourceUseCase, 'execute'>
}

export class RunDueSourcesUseCase {
  constructor(private readonly deps: RunDueSourcesUseCaseDeps) {}

  async execute(): Promise<RunSourceResult[]> {
    const scheduledAt = this.deps.now()
    const dueSources = await this.deps.sourceQueryService.listDueSources(scheduledAt)
    const results: RunSourceResult[] = []

    for (const dueSource of dueSources) {
      results.push(
        await this.deps.runSourceUseCase.execute({
          source: dueSource.source,
          profile: 'production',
          effectDomain: 'production',
          trigger: 'scheduled',
          scheduledAt,
          bindings: dueSource.bindings,
        }),
      )
    }

    return results
  }
}
