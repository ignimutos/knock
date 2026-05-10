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
      if (plan.channel !== 'email') {
        throw new Error(`email executor 不支持 channel=${plan.channel}`)
      }

      const payload = (plan.renderedSnapshot.payload ?? {}) as Record<string, unknown>
      const smtp = payload.smtp
      const message = payload.message
      if (!smtp || typeof smtp !== 'object' || !message || typeof message !== 'object') {
        throw new Error('email executor 缺少 smtp/message rendered payload')
      }

      await delivery.push({
        deliveryId: plan.deliveryId,
        smtp: smtp as Parameters<EmailDelivery['push']>[0]['smtp'],
        message: message as Parameters<EmailDelivery['push']>[0]['message'],
      })
    },
  }
}
