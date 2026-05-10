import type { RunPlan } from '../../domain/run_plan.ts'

export interface SourcePayloadSummary {
  hash: string
  bytes?: number
  contentType?: string
  reference?: string
}

export interface FetchedSourceInput {
  kind: 'fetch' | 'summary'
  collectedAt: string
  payloadSummary: SourcePayloadSummary
  rawText?: string
  collectedJson?: Record<string, unknown>
}

export interface SourceInputGateway {
  fetch(plan: RunPlan): Promise<FetchedSourceInput>
}
