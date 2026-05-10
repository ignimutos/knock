import type { DeliveryChannel, RenderedSnapshot } from '../../domain/delivery_attempt.ts'
import type { EffectDomain } from '../../domain/run_profile.ts'

export interface DeliveryAttemptPlan {
  attemptId: string
  sourceRunId: string
  itemId: string
  deliveryId: string
  effectDomain: EffectDomain
  channel: DeliveryChannel
  plannedAt: string
  renderedSnapshot: RenderedSnapshot
}

export interface DeliveryExecutor {
  execute(plan: DeliveryAttemptPlan): Promise<void>
}

export type DeliveryExecutorRegistry = Record<DeliveryChannel, DeliveryExecutor>
