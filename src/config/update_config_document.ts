export interface GlobalConfigDocumentUpdate {
  language: string
  timezone: string
  timestampFormat: string
  sqlite?: Record<string, unknown>
  logging?: Record<string, unknown>
  ai?: Record<string, unknown>
}

export interface DeliveryConfigDocumentUpsert {
  deliveryId: string
  enabled: boolean
  kind: 'file' | 'push' | 'email'
  config: Record<string, unknown>
}

export interface DeliveryConfigDocumentDelete {
  deliveryId: string
}

export class ConfigDocumentUpdateError extends Error {
  constructor(
    message: string,
    readonly kind: 'validation' | 'not_found',
  ) {
    super(message)
    this.name = 'ConfigDocumentUpdateError'
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function throwValidation(message: string): never {
  throw new ConfigDocumentUpdateError(message, 'validation')
}

function setOptionalTrimmedString(
  target: Record<string, unknown>,
  key: string,
  value: string,
): void {
  const trimmed = value.trim()
  if (trimmed === '') {
    delete target[key]
    return
  }
  target[key] = trimmed
}

function setOptionalObject(
  target: Record<string, unknown>,
  key: string,
  value: Record<string, unknown> | undefined,
): void {
  if (value === undefined) {
    delete target[key]
    return
  }
  target[key] = structuredClone(value)
}

function getMutableDeliveriesDocument(document: Record<string, unknown>): Record<string, unknown> {
  if (document.deliveries === undefined) {
    document.deliveries = {}
  }

  if (!isPlainObject(document.deliveries)) {
    throwValidation('deliveries 配置非法')
  }

  return document.deliveries
}

export function applyGlobalConfigDocumentUpdate(
  document: Record<string, unknown>,
  input: GlobalConfigDocumentUpdate,
): void {
  setOptionalTrimmedString(document, 'language', input.language)
  setOptionalTrimmedString(document, 'timezone', input.timezone)
  setOptionalTrimmedString(document, 'timestampFormat', input.timestampFormat)
  setOptionalObject(document, 'sqlite', input.sqlite)
  setOptionalObject(document, 'logging', input.logging)
  setOptionalObject(document, 'ai', input.ai)
}

export function upsertDeliveryConfigDocument(
  document: Record<string, unknown>,
  input: DeliveryConfigDocumentUpsert,
): void {
  const deliveries = getMutableDeliveriesDocument(document)
  const next: Record<string, unknown> = {}

  if (!input.enabled) {
    next.enabled = false
  }

  next[input.kind] = structuredClone(input.config)
  deliveries[input.deliveryId] = next
}

export function deleteDeliveryConfigDocument(
  document: Record<string, unknown>,
  input: DeliveryConfigDocumentDelete,
): void {
  const deliveries = getMutableDeliveriesDocument(document)
  if (!(input.deliveryId in deliveries)) {
    throw new ConfigDocumentUpdateError(`delivery 未定义: ${input.deliveryId}`, 'not_found')
  }

  delete deliveries[input.deliveryId]
  if (Object.keys(deliveries).length === 0) {
    delete document.deliveries
  }
}
