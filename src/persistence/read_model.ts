import type { EffectDomain } from '../domain/run_profile.ts'

export interface SummaryInputWindow {
  after: string
  atOrBefore: string
}

export interface SummarySourceInput {
  name: string
  feed: Record<string, unknown>
  entries: Record<string, unknown>[]
}

export interface FactsReadModel {
  getSummaryCheckpoint(sourceId: string, effectDomain: EffectDomain): Promise<string | undefined>
  getSummaryInputs(
    sourceIds: string[],
    window: SummaryInputWindow,
    effectDomain: EffectDomain,
  ): Promise<Record<string, SummarySourceInput>>
}
