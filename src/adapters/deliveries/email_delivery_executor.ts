import type {
  DeliveryExecutor,
  DeliveryAttemptPlan,
} from '../../workflow/ports/delivery_executor.ts'
import { createEmailDelivery, type EmailDelivery } from './email.ts'
import type { Logger } from '../../core/logger.ts'

export interface EmailDeliveryExecutorDeps {
  logger?: Logger
  delivery?: EmailDelivery
}

export function createEmailDeliveryExecutor(deps: EmailDeliveryExecutorDeps): DeliveryExecutor {
  const delivery = deps.delivery ?? createEmailDelivery({ logger: deps.logger })

  return {
    async execute(plan: DeliveryAttemptPlan): Promise<void> {
      if (plan.renderedSnapshot.channel !== 'email') {
        throw new Error(`email executor 不支持 channel=${plan.renderedSnapshot.channel}`)
      }

      const payload = plan.renderedSnapshot.payload
      await delivery.push({
        deliveryId: plan.deliveryId,
        smtp: payload.smtp,
        message: payload.message,
      })
    },
  }
}
