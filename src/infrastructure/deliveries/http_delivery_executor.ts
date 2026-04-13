import type {
  DeliveryExecutor,
  DeliveryAttemptPlan,
} from '../../application/ports/delivery_executor.ts'
import { createHttpDelivery, type HttpDelivery } from '../../deliveries/http.ts'
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
      if (plan.channel !== 'push') {
        throw new Error(`http executor 不支持 channel=${plan.channel}`)
      }

      const payload = (plan.renderedSnapshot.payload ?? {}) as Record<string, unknown>
      const http = payload.http
      const requestType = payload.requestType
      if (!http || typeof http !== 'object' || typeof requestType !== 'string') {
        throw new Error('http executor 缺少 http/requestType rendered payload')
      }

      await delivery.push({
        deliveryId: plan.deliveryId,
        http: http as Parameters<HttpDelivery['push']>[0]['http'],
        request: {
          type: requestType as Parameters<HttpDelivery['push']>[0]['request']['type'],
          payload: payload.payload as Parameters<HttpDelivery['push']>[0]['request']['payload'],
        },
        response: payload.response as Parameters<HttpDelivery['push']>[0]['response'],
      })
    },
  }
}
