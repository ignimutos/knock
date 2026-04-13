import type { FinishDeliveryAttemptInput } from '../ports/delivery_attempt_repository.ts'
import type { DeliveryExecutor, DeliveryAttemptPlan } from '../ports/delivery_executor.ts'

export interface DeliveryStageDeps {
  now: () => string
  executor: DeliveryExecutor
}

export class DeliveryStage {
  constructor(private readonly deps: DeliveryStageDeps) {}

  async run(plan: DeliveryAttemptPlan): Promise<FinishDeliveryAttemptInput> {
    const startedAt = this.deps.now()
    try {
      await this.deps.executor.execute(plan)
      return {
        status: 'delivered',
        startedAt,
        finishedAt: this.deps.now(),
      }
    } catch (error) {
      return {
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
        startedAt,
        finishedAt: this.deps.now(),
      }
    }
  }
}
