import { createApplicationDeduplicationRepository } from './deduplication_repository.ts'
import type { FactsDbClient } from '../../persistence/sqlite/client.ts'
import type { DedupeFactsStore } from '../dedupe_facts_store.ts'

export function createSqliteDedupeFactsStore(db: FactsDbClient): DedupeFactsStore {
  return createApplicationDeduplicationRepository(db)
}
