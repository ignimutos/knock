import type {
  DeliveryAttemptRepository as ApplicationDeliveryAttemptRepository,
  FinishDeliveryAttemptInput,
} from '../../workflow/ports/delivery_attempt_repository.ts'
import type { DeliveryAttempt } from '../../domain/delivery_attempt.ts'
import type { FactsDbClient } from '../../persistence/sqlite/client.ts'

export function insertDeliveryAttempt(db: FactsDbClient, attempt: DeliveryAttempt): Promise<void> {
  db.$client
    .prepare(
      `
        INSERT INTO delivery_attempts (
          attempt_id,
          item_id,
          source_run_id,
          delivery_id,
          channel,
          effect_domain,
          attempt_number,
          status,
          reason,
          rendered_snapshot_json,
          planned_at,
          started_at,
          finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      attempt.attemptId,
      attempt.itemId,
      attempt.sourceRunId,
      attempt.deliveryId,
      attempt.channel,
      attempt.effectDomain,
      attempt.attemptNumber,
      attempt.status,
      attempt.reason ?? null,
      attempt.renderedSnapshot ? JSON.stringify(attempt.renderedSnapshot) : null,
      attempt.plannedAt,
      attempt.startedAt ?? null,
      attempt.finishedAt ?? null,
    )

  return Promise.resolve()
}

export function finishDeliveryAttempt(
  db: FactsDbClient,
  attemptId: string,
  result: FinishDeliveryAttemptInput,
): Promise<void> {
  db.$client
    .prepare(
      `
        UPDATE delivery_attempts
        SET status = ?, reason = ?, started_at = ?, finished_at = ?
        WHERE attempt_id = ?
      `,
    )
    .run(
      result.status,
      result.reason ?? null,
      result.startedAt ?? null,
      result.finishedAt ?? null,
      attemptId,
    )

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
