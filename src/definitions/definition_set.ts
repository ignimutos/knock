import type { ResolvedSourceConfig } from '../config/types.ts'
import type { DeliveryDefinition } from '../domain/delivery_definition.ts'
import type { DeliveryBinding } from '../domain/run_plan.ts'
import type { SourceDefinition } from '../domain/source_definition.ts'

export interface EffectPolicy {
  persistFacts: boolean
  writeDedupe: boolean
  allowExternalSideEffects: boolean
  exposeToRecovery: boolean
  exposeToPrune: boolean
}

export interface DefinitionSet {
  sources: SourceDefinition[]
  deliveries: DeliveryDefinition[]
  bindings: DeliveryBinding[]
  sourceConfigsById: Record<string, ResolvedSourceConfig>
  policies: {
    preview: EffectPolicy
    production: EffectPolicy
  }
}
