import type { SourceRunView } from '../workflow/ports/source_run_query_service.ts'
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

export interface ReaderOverviewRunRow {
  runId: string
  status: string
  startedAt: string
  finishedAt: string | null
  countsJson: string
  feedJson: string | null
}

export interface ReaderOverviewEntryRow {
  itemId: string
  status: string
  normalizedJson: string
}

export interface FactsReadModel {
  getRun(runId: string): Promise<SourceRunView | undefined>
  getLatestRunForSource(
    sourceId: string,
    effectDomain: EffectDomain,
  ): Promise<ReaderOverviewRunRow | undefined>
  getEntriesForRun(runId: string, effectDomain: EffectDomain): Promise<ReaderOverviewEntryRow[]>
  getSummaryCheckpoint(sourceId: string, effectDomain: EffectDomain): Promise<string | undefined>
  getSummaryInputs(
    sourceIds: string[],
    window: SummaryInputWindow,
    effectDomain: EffectDomain,
  ): Promise<Record<string, SummarySourceInput>>
}
