import { eq } from 'drizzle-orm'
import type {
  DeliveryAttemptRepository as ApplicationDeliveryAttemptRepository,
  FinishDeliveryAttemptInput,
} from '../../application/ports/delivery_attempt_repository.ts'
import type { DeliveryAttempt } from '../../domain/delivery_attempt.ts'
import type { FactsDbClient } from '../../db/client.ts'
import { deliveryAttempts } from './schema.ts'

export function insertDeliveryAttempt(db: FactsDbClient, attempt: DeliveryAttempt): Promise<void> {
  db.insert(deliveryAttempts)
    .values({
      attemptId: attempt.attemptId,
      itemId: attempt.itemId,
      sourceRunId: attempt.sourceRunId,
      deliveryId: attempt.deliveryId,
      channel: attempt.channel,
      effectDomain: attempt.effectDomain,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      reason: attempt.reason,
      renderedSnapshotJson: attempt.renderedSnapshot
        ? JSON.stringify(attempt.renderedSnapshot)
        : null,
      plannedAt: attempt.plannedAt,
      startedAt: attempt.startedAt,
      finishedAt: attempt.finishedAt,
    })
    .run()

  return Promise.resolve()
}

export function finishDeliveryAttempt(
  db: FactsDbClient,
  attemptId: string,
  result: FinishDeliveryAttemptInput,
): Promise<void> {
  db.update(deliveryAttempts)
    .set({
      status: result.status,
      reason: result.reason,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
    })
    .where(eq(deliveryAttempts.attemptId, attemptId))
    .run()

  return Promise.resolve()
}

export function createDeliveryAttemptRepository(
  db: FactsDbClient,
): ApplicationDeliveryAttemptRepository {
  return {
    insertPlanned: (attempt) => insertDeliveryAttempt(db, attempt),
    finish: (attemptId, result) => finishDeliveryAttempt(db, attemptId, result),
  }
}
