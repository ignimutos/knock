import type { DeliveryDefinition } from './delivery_definition.ts'
import {
  assertRunContextAlignment,
  type EffectDomain,
  type RunProfile,
  type RunTrigger,
} from './run_profile.ts'
import type { SourceDefinition } from './source_definition.ts'

export interface DeliveryBinding {
  sourceId: string
  deliveryId: string
  definition: DeliveryDefinition
}

export interface RunPlan {
  runId: string
  source: SourceDefinition
  profile: RunProfile
  effectDomain: EffectDomain
  trigger: RunTrigger
  scheduledAt: string
  bindings: DeliveryBinding[]
}

export interface CreateRunPlanInput {
  runId: string
  source: SourceDefinition
  profile: RunProfile
  effectDomain: EffectDomain
  trigger: RunTrigger
  scheduledAt: string
  bindings: DeliveryBinding[]
}

export function createRunPlan(input: CreateRunPlanInput): RunPlan {
  assertRunContextAlignment(input)

  for (const binding of input.bindings) {
    if (binding.sourceId !== input.source.sourceId) {
      throw new Error('delivery binding 必须绑定到当前 source')
    }

    if (binding.deliveryId !== binding.definition.deliveryId) {
      throw new Error('delivery binding deliveryId 必须与 definition 一致')
    }
  }

  return {
    ...input,
  }
}
