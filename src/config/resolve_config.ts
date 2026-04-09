import type {
  AppConfigResolved,
  DeliveryConfig,
  LoggingConfigResolved,
  ResolvedDeliveryConfig,
  ResolvedSourceConfig,
  SqliteConfigResolved,
} from './types.ts'
import type {
  AppConfigValidated,
  DeliveryConfigInput,
  EmailConfig,
  FileDeliveryConfig,
  LoggingConfigInput,
  PushConfig,
  SourceByparrConfig,
  SourceConfigInput,
  SourceHttpConfig,
  SqliteConfigInput,
} from './schema.ts'
import { resolveRuntimePath } from './runtime_semantics.ts'

function normalizeObjectConfig<T extends { id: string }>(
  value: Record<string, Omit<T, 'id'>>,
): T[] {
  return Object.entries(value).map(
    ([id, item]) => ({ id, ...(item as Record<string, unknown>) }) as T,
  )
}

function cloneSourceHttpConfig(input?: SourceHttpConfig): SourceHttpConfig | undefined {
  if (!input) return undefined

  return {
    ...input,
    headers: input.headers ? { ...input.headers } : undefined,
  }
}

function cloneSourceByparrConfig(input?: SourceByparrConfig): SourceByparrConfig | undefined {
  if (!input) return undefined
  return { ...input }
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

function resolveSqliteConfig(runtimeDir: string, input: SqliteConfigInput): SqliteConfigResolved {
  return {
    path: resolveRuntimePath(runtimeDir, input.path),
    busyTimeout: input.busyTimeout,
    journalMode: input.journalMode,
    retention: {
      maxAge: input.retention.maxAge,
      maxEntriesPerSource: input.retention.maxEntriesPerSource,
      vacuum: input.retention.vacuum,
    },
  }
}

function normalizeDeliveries(
  runtimeDir: string,
  value: Record<string, DeliveryConfigInput>,
): DeliveryConfig[] {
  return normalizeObjectConfig<DeliveryConfig>(value).map((delivery) => ({
    id: delivery.id,
    file: normalizeFileConfig(runtimeDir, delivery.file),
    push: clonePushConfig(delivery.push),
    email: cloneEmailConfig(delivery.email),
  }))
}

function normalizeSources(
  value: Record<string, SourceConfigInput>,
): Array<SourceConfigInput & { id: string }> {
  return Object.entries(value).map(([id, source]) => ({
    ...source,
    id,
    http: cloneSourceHttpConfig(source.http),
    byparr: cloneSourceByparrConfig(source.byparr),
  }))
}

function resolveSourceDeliveries(
  sourceId: string,
  deliveryIds: string[],
  deliveries: DeliveryConfig[],
): ResolvedDeliveryConfig[] {
  const deliveryMap = new Map(deliveries.map((delivery) => [delivery.id, delivery]))

  return deliveryIds.map((deliveryId, index) => {
    const delivery = deliveryMap.get(deliveryId)

    return {
      id: `${sourceId}__${deliveryId}__${index}`,
      file: delivery?.file ? { ...delivery.file } : undefined,
      push: clonePushConfig(delivery?.push),
      email: cloneEmailConfig(delivery?.email),
    }
  })
}

export function resolveLoggingConfig(input: LoggingConfigInput): LoggingConfigResolved {
  return {
    level: input.level,
    format: input.format,
    sinks: {
      console: input.sinks.console,
    },
  }
}

export function resolveConfig(input: AppConfigValidated): AppConfigResolved {
  const timezone = input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
  const deliveries = normalizeDeliveries(input.runtimeDir, input.deliveries ?? {})
  const sources = normalizeSources(input.sources ?? {})

  const resolvedSources: ResolvedSourceConfig[] = sources.map((source) => ({
    ...source,
    syndication: source.syndication ?? (source.xquery ? undefined : {}),
    enabled: source.enabled ?? true,
    deliveries: resolveSourceDeliveries(source.id, source.deliveries ?? [], deliveries),
  }))

  return {
    runtimeDir: input.runtimeDir,
    timezone,
    timestampFormat: input.timestampFormat,
    sqlite: resolveSqliteConfig(input.runtimeDir, input.sqlite),
    deliveries,
    sources: resolvedSources,
    logging: resolveLoggingConfig(input.logging),
  }
}
