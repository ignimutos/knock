import type { DeliveryDefinition } from '../domain/delivery_definition.ts'
import type { DeliveryBinding } from '../domain/run_plan.ts'
import type { SourceDefinition } from '../domain/source_definition.ts'

export interface DefinitionSet {
  sources: SourceDefinition[]
  deliveries: DeliveryDefinition[]
  bindings: DeliveryBinding[]
}
