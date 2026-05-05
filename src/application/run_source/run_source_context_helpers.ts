import type { HttpPayload } from '../../config/schema.ts'
import type { UnifiedEntryFields } from '../../config/types.ts'
import {
  renderContent as renderContentFallback,
  renderPayload as renderPayloadFallback,
} from '../../core/content_runtime.ts'

export function createRunSourceItemId(input: {
  entry: UnifiedEntryFields
  createRunId: () => string
  createItemId?: (entry: UnifiedEntryFields) => string
}): string {
  return input.createItemId?.(input.entry) ?? `${input.createRunId()}:${input.entry.id}`
}

export function createRunSourceAttemptId(input: {
  sourceRunId: string
  itemId: string
  deliveryId: string
}): string {
  return `${input.sourceRunId}:${input.itemId}:${input.deliveryId}`
}

export async function renderRunSourceTemplate(
  template: string,
  context: Record<string, unknown>,
): Promise<string> {
  return await renderContentFallback(template, context)
}

export async function renderRunSourcePayloadTemplate(
  payload: unknown,
  context: Record<string, unknown>,
): Promise<unknown> {
  return await renderPayloadFallback(payload as HttpPayload | undefined, context)
}
