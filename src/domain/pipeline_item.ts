import type { EffectDomain } from './run_profile.ts'

export interface NormalizedEntrySnapshot {
  id: string
  title: string
  link: string
  description: string
  content: string
  published: string
  updated: string
}

export type PipelineItemStatus =
  | 'ready'
  | 'filtered'
  | 'duplicate'
  | 'skipped'
  | 'delivered'
  | 'failed'

export type PipelineItemSkippedReason = 'all_deliveries_duplicate' | 'no_deliveries'

export interface PipelineItem {
  itemId: string
  sourceRunId: string
  sourceId: string
  effectDomain: EffectDomain
  normalized: NormalizedEntrySnapshot
  status: PipelineItemStatus
  skippedReason?: PipelineItemSkippedReason
}

export interface CreatePipelineItemInput {
  itemId: string
  sourceRunId: string
  sourceId: string
  effectDomain: EffectDomain
  normalized: NormalizedEntrySnapshot
}

export function createPipelineItem(input: CreatePipelineItemInput): PipelineItem {
  return {
    ...input,
    status: 'ready',
  }
}
