import type { Logger } from '../../core/logger.ts'
import type { FinishDeliveryAttemptInput } from '../../workflow/ports/delivery_attempt_repository.ts'
import type {
  DeliveryExecutor,
  DeliveryAttemptPlan,
} from '../../workflow/ports/delivery_executor.ts'

export interface DeliveryStageDeps {
  now: () => string
  executor: DeliveryExecutor
  logger?: Logger
}

export class DeliveryStage {
  constructor(private readonly deps: DeliveryStageDeps) {}

  async run(plan: DeliveryAttemptPlan): Promise<FinishDeliveryAttemptInput> {
    const startedAt = this.deps.now()
    try {
      await this.deps.executor.execute(plan)
      this.logDispatchSuccess(plan)
      return {
        status: 'delivered',
        startedAt,
        finishedAt: this.deps.now(),
      }
    } catch (error) {
      this.logDispatchFailure(plan, error)
      return {
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
        startedAt,
        finishedAt: this.deps.now(),
      }
    }
  }

  private logDispatchSuccess(plan: DeliveryAttemptPlan): void {
    this.deps.logger?.info('delivery dispatch success', {
      module: 'delivery.runtime.dispatch',
      'delivery.operation': 'dispatch',
      'delivery.outcome': 'success',
      'delivery.id': plan.deliveryId,
      'pipeline.item_id': plan.itemId,
    })
  }

  private logDispatchFailure(plan: DeliveryAttemptPlan, _error: unknown): void {
    this.deps.logger?.error('delivery dispatch failed', {
      module: 'delivery.runtime.dispatch',
      'delivery.operation': 'dispatch',
      'delivery.outcome': 'failure',
      'delivery.id': plan.deliveryId,
      'pipeline.item_id': plan.itemId,
      error_name: 'DeliveryDispatchError',
      error_message: 'delivery dispatch failed',
    })
  }
}
