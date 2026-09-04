import type { EffectDomain } from './run_profile.ts'
import type { UnifiedEntryFields } from '../config/types.ts'

export type PipelineItemStatus =
  'ready' | 'filtered' | 'duplicate' | 'skipped' | 'delivered' | 'failed'

export type PipelineItemSkippedReason = 'all_deliveries_duplicate' | 'no_deliveries'

export interface PipelineItem {
  itemId: string
  sourceRunId: string
  sourceId: string
  effectDomain: EffectDomain
  normalized: UnifiedEntryFields
  status: PipelineItemStatus
  skippedReason?: PipelineItemSkippedReason
}

export interface CreatePipelineItemInput {
  itemId: string
  sourceRunId: string
  sourceId: string
  effectDomain: EffectDomain
  normalized: UnifiedEntryFields
}

export function createPipelineItem(input: CreatePipelineItemInput): PipelineItem {
  return {
    ...input,
    status: 'ready',
  }
}
