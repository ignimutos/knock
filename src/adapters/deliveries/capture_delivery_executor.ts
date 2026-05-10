import type {
  DeliveryAttemptPlan,
  DeliveryExecutor,
} from '../../workflow/ports/delivery_executor.ts'

export interface CaptureDeliveryExecutorDeps {
  onCaptured?: (plan: DeliveryAttemptPlan) => void
}

export function createCaptureDeliveryExecutor(
  deps: CaptureDeliveryExecutorDeps = {},
): DeliveryExecutor {
  return {
    execute(plan: DeliveryAttemptPlan): Promise<void> {
      deps.onCaptured?.(plan)
      return Promise.resolve()
    },
  }
}
