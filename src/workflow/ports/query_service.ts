import type { DeliveryBinding } from '../../domain/run_plan.ts'
import type { SourceDefinition } from '../../domain/source_definition.ts'

export interface PlannedSourceExecution {
  source: SourceDefinition
  bindings: DeliveryBinding[]
}

export interface SourceQueryService {
  getSource(sourceId: string): Promise<SourceDefinition | undefined>
  getBindings(sourceId: string): Promise<DeliveryBinding[]>
  listDueSources(
    at: string,
    trigger: 'scheduled' | 'immediate' | 'manual',
  ): Promise<PlannedSourceExecution[]>
}
