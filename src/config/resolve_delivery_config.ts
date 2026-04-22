import type {
  DeliveryConfig,
  ResolvedDeliveryConfig,
  SourceDeliveriesConfig,
  SourceEmailDeliveryOverride,
  SourceFileDeliveryOverride,
  SourcePushDeliveryOverride,
} from './types.ts'
import type { DeliveryConfigInput, EmailConfig, FileDeliveryConfig, PushConfig } from './schema.ts'
import { resolveRuntimePath } from './runtime_semantics.ts'

function normalizeObjectConfig<T extends { id: string }>(
  value: Record<string, Omit<T, 'id'>>,
): T[] {
  return Object.entries(value).map(
    ([id, item]) => ({ id, ...(item as Record<string, unknown>) }) as T,
  )
}

function clonePushConfig(input?: PushConfig): PushConfig | undefined {
  if (!input) return undefined

  return {
    http: {
      ...input.http,
      headers: input.http.headers ? { ...input.http.headers } : undefined,
    },
    request: {
      ...input.request,
      payload:
        input.request.payload === undefined ? undefined : structuredClone(input.request.payload),
    },
    response: input.response ? { ...input.response } : undefined,
  }
}

function cloneEmailConfig(input?: EmailConfig): EmailConfig | undefined {
  if (!input) return undefined

  return {
    smtp: {
      ...input.smtp,
      auth: input.smtp.auth ? { ...input.smtp.auth } : undefined,
    },
    message: {
      ...input.message,
      to: [...input.message.to],
      cc: input.message.cc ? [...input.message.cc] : undefined,
      bcc: input.message.bcc ? [...input.message.bcc] : undefined,
      replyTo: input.message.replyTo ? [...input.message.replyTo] : undefined,
      headers: input.message.headers ? { ...input.message.headers } : undefined,
    },
  }
}

function normalizeFileConfig(runtimeDir: string, file: unknown): FileDeliveryConfig | undefined {
  if (file === undefined) return undefined

  const asObject = file as FileDeliveryConfig
  if (!asObject.rotation) {
    return {
      ...asObject,
      path: resolveRuntimePath(runtimeDir, asObject.path),
    }
  }

  return {
    ...asObject,
    path: resolveRuntimePath(runtimeDir, asObject.path),
    rotation: {
      enabled: asObject.rotation.enabled ?? false,
      size: asObject.rotation.size,
      backups: asObject.rotation.backups,
      age: asObject.rotation.age,
    },
  }
}

export function normalizeDeliveries(
  runtimeDir: string,
  value: Record<string, DeliveryConfigInput>,
): DeliveryConfig[] {
  return normalizeObjectConfig<DeliveryConfig>(value).map((delivery) => ({
    id: delivery.id,
    enabled: delivery.enabled ?? true,
    file: normalizeFileConfig(runtimeDir, delivery.file),
    push: clonePushConfig(delivery.push),
    email: cloneEmailConfig(delivery.email),
  }))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function deepMergeValue(base: unknown, override: unknown): unknown {
  if (override === undefined) return structuredClone(base)
  if (base === undefined) return structuredClone(override)
  if (Array.isArray(override)) return structuredClone(override)
  if (Array.isArray(base)) return structuredClone(override)
  if (isPlainObject(base) && isPlainObject(override)) {
    const merged: Record<string, unknown> = { ...base }

    for (const [key, value] of Object.entries(override)) {
      merged[key] = deepMergeValue(base[key], value)
    }

    return merged
  }

  return structuredClone(override)
}

function createResolvedDeliveryShell(
  sourceId: string,
  delivery: DeliveryConfig,
): Omit<ResolvedDeliveryConfig, 'file' | 'push' | 'email'> {
  return {
    id: `${sourceId}__${delivery.id}`,
    sourceId,
    deliveryId: delivery.id,
  }
}

function resolveFileDelivery(
  sourceId: string,
  delivery: DeliveryConfig,
  override: SourceFileDeliveryOverride,
): ResolvedDeliveryConfig {
  return {
    ...createResolvedDeliveryShell(sourceId, delivery),
    file: delivery.file
      ? {
          ...delivery.file,
          ...(override.content === undefined ? {} : { content: override.content }),
        }
      : undefined,
    push: undefined,
    email: undefined,
  }
}

function resolvePushDelivery(
  sourceId: string,
  delivery: DeliveryConfig,
  override: SourcePushDeliveryOverride,
): ResolvedDeliveryConfig {
  const push = clonePushConfig(delivery.push)

  return {
    ...createResolvedDeliveryShell(sourceId, delivery),
    file: undefined,
    push: push
      ? {
          ...push,
          request: {
            ...push.request,
            payload: deepMergeValue(
              push.request.payload,
              override.payload,
            ) as PushConfig['request']['payload'],
          },
        }
      : undefined,
    email: undefined,
  }
}

function resolveEmailDelivery(
  sourceId: string,
  delivery: DeliveryConfig,
  override: SourceEmailDeliveryOverride,
): ResolvedDeliveryConfig {
  const email = cloneEmailConfig(delivery.email)

  return {
    ...createResolvedDeliveryShell(sourceId, delivery),
    file: undefined,
    push: undefined,
    email: email
      ? {
          ...email,
          message: deepMergeValue(email.message, override.message) as EmailConfig['message'],
        }
      : undefined,
  }
}

function createEmptyResolvedDelivery(
  sourceId: string,
  delivery: DeliveryConfig,
): ResolvedDeliveryConfig {
  return {
    ...createResolvedDeliveryShell(sourceId, delivery),
    file: undefined,
    push: undefined,
    email: undefined,
  }
}

function applySourceDeliveryOverride(
  sourceId: string,
  delivery: DeliveryConfig,
  override: SourceFileDeliveryOverride | SourcePushDeliveryOverride | SourceEmailDeliveryOverride,
): ResolvedDeliveryConfig {
  if (delivery.file) {
    return resolveFileDelivery(sourceId, delivery, override as SourceFileDeliveryOverride)
  }

  if (delivery.push) {
    return resolvePushDelivery(sourceId, delivery, override as SourcePushDeliveryOverride)
  }

  if (delivery.email) {
    return resolveEmailDelivery(sourceId, delivery, override as SourceEmailDeliveryOverride)
  }

  return createEmptyResolvedDelivery(sourceId, delivery)
}

export function resolveSourceDeliveries(
  sourceId: string,
  sourceDeliveries: SourceDeliveriesConfig,
  deliveryMap: ReadonlyMap<string, DeliveryConfig>,
): ResolvedDeliveryConfig[] {
  return Object.entries(sourceDeliveries).flatMap(([deliveryId, override]) => {
    const delivery = deliveryMap.get(deliveryId)

    if (!delivery) {
      throw new Error(`source.${sourceId}.deliveries 引用了未定义 delivery: ${deliveryId}`)
    }

    if (delivery.enabled === false) {
      return []
    }

    return [applySourceDeliveryOverride(sourceId, delivery, override)]
  })
}
