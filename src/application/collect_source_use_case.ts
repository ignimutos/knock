import type { RunSourceRequest, RunSourceResult, RunSourceUseCase } from './run_source_use_case.ts'

export interface CollectSourceUseCaseDeps {
  runSourceUseCase: Pick<RunSourceUseCase, 'collect'>
}

export class CollectSourceUseCase {
  constructor(private readonly deps: CollectSourceUseCaseDeps) {}

  async execute(input: RunSourceRequest): Promise<RunSourceResult> {
    return await this.deps.runSourceUseCase.collect(input)
  }
}
