export interface PruneFactsInput {
  now: string
  maxAge: string
  maxEntriesPerSource: number
}

export interface PruneFactsResult {
  deletedRuns: number
  deletedItems: number
  deletedAttempts: number
  deletedDeduplications: number
}

export interface PruneFactsRepository {
  prune(input: PruneFactsInput): Promise<PruneFactsResult>
}
