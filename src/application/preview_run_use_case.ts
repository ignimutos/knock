import type { DeliveryBinding } from '../domain/run_plan.ts'
import type { SourceDefinition } from '../domain/source_definition.ts'
import type { RunSourceResult, RunSourceUseCase } from './run_source/run_source_use_case.ts'

export interface PreviewRunRequest {
  source: SourceDefinition
  bindings?: DeliveryBinding[]
  scheduledAt?: string
}

export interface PreviewRunUseCaseDeps {
  runSourceUseCase: Pick<RunSourceUseCase, 'plan' | 'collect' | 'execute'>
}

export class PreviewRunUseCase {
  constructor(private readonly deps: PreviewRunUseCaseDeps) {}

  async plan(input: PreviewRunRequest) {
    return await this.deps.runSourceUseCase.plan(this.toPreviewRunInput(input))
  }

  async collect(input: PreviewRunRequest): Promise<RunSourceResult> {
    return await this.deps.runSourceUseCase.collect(this.toPreviewRunInput(input))
  }

  async execute(input: PreviewRunRequest): Promise<RunSourceResult> {
    return await this.deps.runSourceUseCase.execute(this.toPreviewRunInput(input))
  }

  private toPreviewRunInput(input: PreviewRunRequest) {
    return {
      source: input.source,
      profile: 'preview' as const,
      effectDomain: 'preview' as const,
      trigger: 'preview' as const,
      bindings: input.bindings,
      scheduledAt: input.scheduledAt,
    }
  }
}
