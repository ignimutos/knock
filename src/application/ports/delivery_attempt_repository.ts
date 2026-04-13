import type { DeliveryAttempt } from '../../domain/delivery_attempt.ts'

export interface FinishDeliveryAttemptInput {
  status: 'delivered' | 'failed'
  reason?: string
  startedAt: string
  finishedAt: string
}

export interface DeliveryAttemptRepository {
  insertPlanned(attempt: DeliveryAttempt): Promise<void>
  finish(attemptId: string, result: FinishDeliveryAttemptInput): Promise<void>
}
