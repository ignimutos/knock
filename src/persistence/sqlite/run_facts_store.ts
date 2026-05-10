import { createDeliveryAttemptRepository } from './delivery_attempt_repository.ts'
import { createItemRepository } from './item_repository.ts'
import { createRunRepository } from './run_repository.ts'
import type { FactsDbClient } from '../../persistence/sqlite/client.ts'
import type { RunFactsStore } from '../run_facts_store.ts'

export function createSqliteRunFactsStore(db: FactsDbClient): RunFactsStore {
  const runRepository = createRunRepository(db)
  const itemRepository = createItemRepository(db)
  const deliveryAttemptRepository = createDeliveryAttemptRepository(db)
  const setFeedSnapshot = runRepository.setFeedSnapshot
  if (!setFeedSnapshot) {
    throw new Error('sqlite run facts store 缺少 setFeedSnapshot 实现')
  }

  return {
    insertRun: (run) => runRepository.insert(run),
    updateRun: (run) => runRepository.update(run),
    setFeedSnapshot: (runId, feed) => setFeedSnapshot(runId, feed),
    insertItems: (items) => itemRepository.insertMany(items),
    updateItemStatus: (itemId, status, skippedReason) =>
      itemRepository.updateStatus(itemId, status, skippedReason),
    insertPlannedAttempt: (attempt) => deliveryAttemptRepository.insertPlanned(attempt),
    finishAttempt: (attemptId, result) => deliveryAttemptRepository.finish(attemptId, result),
  }
}
