import type {
  DeliveryExecutor,
  DeliveryAttemptPlan,
} from '../../application/ports/delivery_executor.ts'
import { createFileDelivery, type FileDelivery } from '../../deliveries/file.ts'
import type { Logger } from '../../core/logger.ts'

export interface FileDeliveryExecutorDeps {
  runtimeDir: string
  logger?: Logger
  delivery?: FileDelivery
}

export function createFileDeliveryExecutor(deps: FileDeliveryExecutorDeps): DeliveryExecutor {
  const delivery =
    deps.delivery ?? createFileDelivery({ runtimeDir: deps.runtimeDir, logger: deps.logger })

  return {
    async execute(plan: DeliveryAttemptPlan): Promise<void> {
      if (plan.channel !== 'file') {
        throw new Error(`file executor 不支持 channel=${plan.channel}`)
      }

      const payload = (plan.renderedSnapshot.payload ?? {}) as Record<string, unknown>
      const path = payload.path
      const content = payload.content
      if (typeof path !== 'string' || typeof content !== 'string') {
        throw new Error('file executor 缺少 path/content rendered payload')
      }

      await delivery.push({
        path,
        content,
        rotation: payload.rotation as Parameters<FileDelivery['push']>[0]['rotation'],
      })
    },
  }
}
