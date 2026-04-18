import type { SourceRunQueryService, SourceRunView } from './ports/source_run_query_service.ts'

export interface QueryRunsUseCaseDeps {
  sourceRunQueryService: SourceRunQueryService
}

export class QueryRunsUseCase {
  constructor(private readonly deps: QueryRunsUseCaseDeps) {}

  async getRun(runId: string): Promise<SourceRunView | undefined> {
    return await this.deps.sourceRunQueryService.getRun(runId)
  }
}
