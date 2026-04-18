import type { RunSourceRequest, RunSourceResult, RunSourceUseCase } from './run_source_use_case.ts'

export interface ExecuteRunUseCaseDeps {
  runSourceUseCase: Pick<RunSourceUseCase, 'execute'>
}

export class ExecuteRunUseCase {
  constructor(private readonly deps: ExecuteRunUseCaseDeps) {}

  async execute(input: RunSourceRequest): Promise<RunSourceResult> {
    return await this.deps.runSourceUseCase.execute(input)
  }
}
