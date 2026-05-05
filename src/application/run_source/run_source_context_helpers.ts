import type { UnifiedEntryFields } from '../../config/types.ts'

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

export function renderRunSourceTemplate(
  template: string,
  context: Record<string, unknown>,
): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expression: string) => {
    const value = lookupTemplateValue(context, expression.trim())
    return value === undefined || value === null ? '' : String(value)
  })
}

export function renderRunSourcePayloadTemplate(
  payload: unknown,
  context: Record<string, unknown>,
): unknown {
  if (typeof payload === 'string') {
    return renderRunSourceTemplate(payload, context)
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => {
      if (typeof item === 'string' || Array.isArray(item) || (item && typeof item === 'object')) {
        return renderRunSourcePayloadTemplate(item, context)
      }
      return item
    })
  }

  if (!payload || typeof payload !== 'object') {
    return payload
  }

  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => {
      if (
        typeof value === 'string' ||
        Array.isArray(value) ||
        (value && typeof value === 'object')
      ) {
        return [key, renderRunSourcePayloadTemplate(value, context)]
      }
      return [key, value]
    }),
  )
}

function lookupTemplateValue(context: Record<string, unknown>, expression: string): unknown {
  const segments = expression.split('.')
  let current: unknown = context

  for (const segment of segments) {
    if (!current || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[segment]
  }

  return current
}
