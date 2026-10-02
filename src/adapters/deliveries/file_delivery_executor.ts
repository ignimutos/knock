import type {
  DeliveryExecutor,
  DeliveryAttemptPlan,
} from '../../workflow/ports/delivery_executor.ts'
import { createFileDelivery, type FileDelivery } from './file.ts'
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
      if (plan.renderedSnapshot.channel !== 'file') {
        throw new Error(`file executor 不支持 channel=${plan.renderedSnapshot.channel}`)
      }

      const payload = plan.renderedSnapshot.payload
      await delivery.push({
        path: payload.path,
        content: payload.content,
        rotation: payload.rotation,
      })
    },
  }
}
