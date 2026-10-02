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

type DeliveryKind = 'file' | 'push' | 'email' | 'empty'
type ResolvedDeliveryContent = Pick<ResolvedDeliveryConfig, 'file' | 'push' | 'email'>

function createEmptyResolvedDeliveryContent(): ResolvedDeliveryContent {
  return {
    file: undefined,
    push: undefined,
    email: undefined,
  }
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

function normalizeFileConfig(
  runtimeDir: string,
  file?: FileDeliveryConfig,
): FileDeliveryConfig | undefined {
  if (file === undefined) return undefined

  if (!file.rotation) {
    return {
      ...file,
      path: resolveRuntimePath(runtimeDir, file.path),
    }
  }

  return {
    ...file,
    path: resolveRuntimePath(runtimeDir, file.path),
    rotation: {
      enabled: file.rotation.enabled ?? false,
      size: file.rotation.size,
      backups: file.rotation.backups,
      age: file.rotation.age,
    },
  }
}

function normalizeCanonicalDelivery(
  runtimeDir: string,
  [id, delivery]: [string, DeliveryConfigInput],
): DeliveryConfig {
  return {
    id,
    enabled: delivery.enabled ?? true,
    file: normalizeFileConfig(runtimeDir, delivery.file),
    push: clonePushConfig(delivery.push),
    email: cloneEmailConfig(delivery.email),
  }
}

export function normalizeDeliveries(
  runtimeDir: string,
  value: Record<string, DeliveryConfigInput>,
): DeliveryConfig[] {
  return Object.entries(value).map((entry) => normalizeCanonicalDelivery(runtimeDir, entry))
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

function getDeliveryKind(delivery: DeliveryConfig): DeliveryKind {
  if (delivery.file) return 'file'
  if (delivery.push) return 'push'
  if (delivery.email) return 'email'
  return 'empty'
}

function mergeFileDeliveryOverride(
  file: FileDeliveryConfig | undefined,
  override: SourceFileDeliveryOverride,
): ResolvedDeliveryContent {
  return {
    file:
      file === undefined
        ? undefined
        : {
            ...file,
            ...(override.content === undefined ? {} : { content: override.content }),
          },
    push: undefined,
    email: undefined,
  }
}

function mergePushDeliveryOverride(
  push: PushConfig | undefined,
  override: SourcePushDeliveryOverride,
): ResolvedDeliveryContent {
  if (push === undefined) {
    return createEmptyResolvedDeliveryContent()
  }

  const clonedPush = clonePushConfig(push)
  if (clonedPush === undefined) {
    return createEmptyResolvedDeliveryContent()
  }

  return {
    file: undefined,
    push: {
      ...clonedPush,
      request: {
        ...clonedPush.request,
        payload: deepMergeValue(
          clonedPush.request.payload,
          override.payload,
        ) as PushConfig['request']['payload'],
      },
    },
    email: undefined,
  }
}

function mergeEmailDeliveryOverride(
  email: EmailConfig | undefined,
  override: SourceEmailDeliveryOverride,
): ResolvedDeliveryContent {
  if (email === undefined) {
    return createEmptyResolvedDeliveryContent()
  }

  const clonedEmail = cloneEmailConfig(email)
  if (clonedEmail === undefined) {
    return createEmptyResolvedDeliveryContent()
  }

  return {
    file: undefined,
    push: undefined,
    email: {
      ...clonedEmail,
      message: deepMergeValue(clonedEmail.message, override.message) as EmailConfig['message'],
    },
  }
}

function mergeSourceDeliveryOverride(
  delivery: DeliveryConfig,
  override: SourceFileDeliveryOverride | SourcePushDeliveryOverride | SourceEmailDeliveryOverride,
): ResolvedDeliveryContent {
  switch (getDeliveryKind(delivery)) {
    case 'file':
      return mergeFileDeliveryOverride(delivery.file, override as SourceFileDeliveryOverride)
    case 'push':
      return mergePushDeliveryOverride(delivery.push, override as SourcePushDeliveryOverride)
    case 'email':
      return mergeEmailDeliveryOverride(delivery.email, override as SourceEmailDeliveryOverride)
    case 'empty':
      return createEmptyResolvedDeliveryContent()
  }
}

function createResolvedDeliveryBase(
  sourceId: string,
  delivery: DeliveryConfig,
): Omit<ResolvedDeliveryConfig, 'file' | 'push' | 'email'> {
  return {
    id: `${sourceId}__${delivery.id}`,
    sourceId,
    deliveryId: delivery.id,
  }
}

function materializeResolvedDelivery(
  sourceId: string,
  delivery: DeliveryConfig,
  content: ResolvedDeliveryContent,
): ResolvedDeliveryConfig {
  return {
    ...createResolvedDeliveryBase(sourceId, delivery),
    ...content,
  }
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

    const content = mergeSourceDeliveryOverride(delivery, override)
    return [materializeResolvedDelivery(sourceId, delivery, content)]
  })
}
