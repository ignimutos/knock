import type { EffectDomain } from './run_profile.ts'

export type DeliveryChannel = 'file' | 'push' | 'email'

export type DeliveryAttemptStatus =
  | 'planned'
  | 'running'
  | 'delivered'
  | 'failed'
  | 'skipped'
  | 'interrupted'

export interface RenderedSnapshot {
  channel: DeliveryChannel
  payload?: Record<string, unknown>
}

export interface DeliveryAttempt {
  attemptId: string
  itemId: string
  sourceRunId: string
  deliveryId: string
  channel: DeliveryChannel
  attemptNumber: number
  effectDomain: EffectDomain
  status: DeliveryAttemptStatus
  reason?: string
  plannedAt: string
  startedAt?: string
  finishedAt?: string
  renderedSnapshot?: RenderedSnapshot
}

export interface CreateDeliveryAttemptInput {
  attemptId: string
  itemId: string
  sourceRunId: string
  deliveryId: string
  channel: DeliveryChannel
  effectDomain: EffectDomain
  plannedAt: string
  attemptNumber?: number
  renderedSnapshot?: RenderedSnapshot
}

export function createDeliveryAttempt(input: CreateDeliveryAttemptInput): DeliveryAttempt {
  const attempt: DeliveryAttempt = {
    attemptId: input.attemptId,
    itemId: input.itemId,
    sourceRunId: input.sourceRunId,
    deliveryId: input.deliveryId,
    channel: input.channel,
    attemptNumber: input.attemptNumber ?? 1,
    effectDomain: input.effectDomain,
    status: 'planned',
    plannedAt: input.plannedAt,
    renderedSnapshot: input.renderedSnapshot,
  }

  assertDeliveryAttemptInvariant(attempt)
  return attempt
}

export function assertDeliveryAttemptInvariant(attempt: DeliveryAttempt): void {
  if (!Number.isInteger(attempt.attemptNumber) || attempt.attemptNumber < 1) {
    throw new Error('delivery attemptNumber 必须是大于等于 1 的整数')
  }

  if (
    attempt.renderedSnapshot !== undefined &&
    attempt.renderedSnapshot.channel !== attempt.channel
  ) {
    throw new Error('delivery renderedSnapshot.channel 必须与 attempt.channel 一致')
  }

  if (isTerminalDeliveryAttemptStatus(attempt.status)) {
    if (attempt.finishedAt === undefined) {
      throw new Error('delivery attempt 终态必须提供 finishedAt')
    }
  } else if (attempt.finishedAt !== undefined) {
    throw new Error('delivery attempt 非终态不得提供 finishedAt')
  }
}

function isTerminalDeliveryAttemptStatus(status: DeliveryAttemptStatus): boolean {
  return (
    status === 'delivered' ||
    status === 'failed' ||
    status === 'skipped' ||
    status === 'interrupted'
  )
}
