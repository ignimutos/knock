import {
  applyGlobalConfigDocumentUpdate,
  deleteDeliveryConfigDocument,
  upsertDeliveryConfigDocument,
} from './update_config_document.ts'
import { assertRuntimeRelativePath } from './runtime_semantics.ts'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cloneRecord(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? structuredClone(value) : {}
}

export function assertManagedFilesystemPaths(global: {
  sqlite?: Record<string, unknown>
  logging?: Record<string, unknown>
}): void {
  if (typeof global.sqlite?.path === 'string') {
    global.sqlite.path = assertRuntimeRelativePath(global.sqlite.path, 'sqlite.path')
  }

  const fileSink = cloneRecord(global.logging?.sinks).file
  if (isPlainObject(fileSink) && typeof fileSink.path === 'string') {
    fileSink.path = assertRuntimeRelativePath(fileSink.path, 'logging.sinks.file.path')
    const sinks = cloneRecord(global.logging?.sinks)
    sinks.file = fileSink
    if (global.logging) global.logging.sinks = sinks
  }
}

export function assertManagedDeliveryPaths(
  config: Record<string, unknown>,
  kind: 'file' | 'push' | 'email',
): void {
  if (kind === 'file' && typeof config.path === 'string') {
    config.path = assertRuntimeRelativePath(config.path, 'deliveries.*.file.path')
  }
}

export function applyGlobalDocumentMutation(
  rawDocument: Record<string, unknown>,
  input: {
    language: string
    timezone: string
    timestampFormat: string
    sqlite?: Record<string, unknown>
    logging?: Record<string, unknown>
    ai?: Record<string, unknown>
  },
): void {
  assertManagedFilesystemPaths({
    sqlite: input.sqlite,
    logging: input.logging,
  })

  applyGlobalConfigDocumentUpdate(rawDocument, input)
}

export function upsertCanonicalDeliveryDocumentMutation(
  rawDocument: Record<string, unknown>,
  input: {
    deliveryId: string
    enabled: boolean
    kind: 'file' | 'push' | 'email'
    config: Record<string, unknown>
  },
): void {
  assertManagedDeliveryPaths(input.config, input.kind)

  upsertDeliveryConfigDocument(rawDocument, {
    deliveryId: input.deliveryId,
    enabled: input.enabled,
    kind: input.kind,
    config: input.config,
  })
}

export function deleteCanonicalDeliveryDocumentMutation(
  rawDocument: Record<string, unknown>,
  input: { deliveryId: string },
): void {
  deleteDeliveryConfigDocument(rawDocument, input)
}
