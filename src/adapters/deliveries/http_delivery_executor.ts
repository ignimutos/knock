import type {
  DeliveryExecutor,
  DeliveryAttemptPlan,
} from '../../workflow/ports/delivery_executor.ts'
import { createHttpDelivery, type HttpDelivery } from './http.ts'
import type { Logger } from '../../core/logger.ts'
import type { HttpClient } from '../../core/http_client.ts'

export interface HttpDeliveryExecutorDeps {
  httpClient: HttpClient
  logger?: Logger
  delivery?: HttpDelivery
}

export function createHttpDeliveryExecutor(deps: HttpDeliveryExecutorDeps): DeliveryExecutor {
  const delivery =
    deps.delivery ?? createHttpDelivery({ httpClient: deps.httpClient, logger: deps.logger })

  return {
    async execute(plan: DeliveryAttemptPlan): Promise<void> {
      if (plan.renderedSnapshot.channel !== 'push') {
        throw new Error(`http executor 不支持 channel=${plan.renderedSnapshot.channel}`)
      }

      const payload = plan.renderedSnapshot.payload
      await delivery.push({
        deliveryId: plan.deliveryId,
        http: payload.http,
        request: {
          type: payload.requestType,
          payload: payload.payload,
        },
        response: payload.response,
      })
    },
  }
}
