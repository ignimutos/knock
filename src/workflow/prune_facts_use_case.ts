import type { PruneFactsRepository, PruneFactsResult } from './ports/prune_facts_repository.ts'

export interface PruneFactsUseCaseDeps {
  now: () => string
  pruneFactsRepository: PruneFactsRepository
}

export class PruneFactsUseCase {
  constructor(private readonly deps: PruneFactsUseCaseDeps) {}

  async execute(input: { maxAge: string; maxEntriesPerSource: number }): Promise<PruneFactsResult> {
    return await this.deps.pruneFactsRepository.prune({
      now: this.deps.now(),
      maxAge: input.maxAge,
      maxEntriesPerSource: input.maxEntriesPerSource,
    })
  }
}
