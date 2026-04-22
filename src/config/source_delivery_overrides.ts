import type { SourceDeliveryOverride } from './types.ts'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function getRawSourceDeliveryOverrides(
  rawDocument: Record<string, unknown>,
  sourceId: string,
): Record<string, SourceDeliveryOverride> {
  const sources = rawDocument.sources
  if (!isPlainObject(sources)) {
    return {}
  }

  const source = sources[sourceId]
  if (!isPlainObject(source)) {
    return {}
  }

  const deliveries = source.deliveries
  if (!isPlainObject(deliveries)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(deliveries).map(([deliveryId, override]) => {
      if (!isPlainObject(override)) {
        return [deliveryId, {}]
      }
      return [deliveryId, structuredClone(override) as SourceDeliveryOverride]
    }),
  )
}
