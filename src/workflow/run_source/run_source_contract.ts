import type { DeliveryBinding, RunPlan } from '../../domain/run_plan.ts'
import type { SourceDefinition } from '../../domain/source_definition.ts'
import type { ParsedSourceSnapshot } from '../../workflow/ports/source_parser.ts'
import type { FetchedSourceInput } from '../../workflow/ports/source_input_gateway.ts'

export interface RunSourceRequest {
  source: SourceDefinition
  profile: 'production' | 'preview'
  effectDomain: 'production' | 'preview'
  trigger: 'scheduled' | 'immediate' | 'manual' | 'preview'
  bindings?: DeliveryBinding[]
  scheduledAt?: string
}

export interface RunSourceResult {
  plan: RunPlan
  fetchedInput: FetchedSourceInput
  parsed: ParsedSourceSnapshot
}
