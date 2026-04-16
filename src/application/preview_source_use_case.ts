import type { DeliveryBinding } from '../domain/run_plan.ts'
import type { SourceDefinition } from '../domain/source_definition.ts'
import type { RunSourceResult, RunSourceUseCase } from './run_source_use_case.ts'

export interface PreviewSourceRequest {
  source: SourceDefinition
  bindings?: DeliveryBinding[]
  scheduledAt?: string
}

export interface PreviewSourceUseCaseDeps {
  runSourceUseCase: Pick<RunSourceUseCase, 'plan' | 'collect' | 'execute'>
}

export class PreviewSourceUseCase {
  constructor(private readonly deps: PreviewSourceUseCaseDeps) {}

  async plan(input: PreviewSourceRequest) {
    return await this.deps.runSourceUseCase.plan({
      source: input.source,
      profile: 'preview',
      effectDomain: 'preview',
      trigger: 'preview',
      bindings: input.bindings,
      scheduledAt: input.scheduledAt,
    })
  }

  async collect(input: PreviewSourceRequest): Promise<RunSourceResult> {
    return await this.deps.runSourceUseCase.collect({
      source: input.source,
      profile: 'preview',
      effectDomain: 'preview',
      trigger: 'preview',
      bindings: input.bindings,
      scheduledAt: input.scheduledAt,
    })
  }

  async execute(input: PreviewSourceRequest): Promise<RunSourceResult> {
    return await this.deps.runSourceUseCase.execute({
      source: input.source,
      profile: 'preview',
      effectDomain: 'preview',
      trigger: 'preview',
      bindings: input.bindings,
      scheduledAt: input.scheduledAt,
    })
  }
}
