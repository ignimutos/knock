import type {
  AiConfigResolved,
  AiModelRefResolved,
  AiModelResolved,
  AiProviderResolved,
  AppConfigResolved,
  DeliveryConfig,
  LoggingConfigResolved,
  ResolvedDeliveryConfig,
  ResolvedSourceConfig,
  SourceDeliveriesConfig,
  SourceEmailDeliveryOverride,
  SourceFileDeliveryOverride,
  SourcePushDeliveryOverride,
  SqliteConfigResolved,
} from './types.ts'
import type {
  AiConfigInput,
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

function resolveFileDelivery(
  delivery: DeliveryConfig,
  override: SourceFileDeliveryOverride,
): ResolvedDeliveryConfig {
  return {
    id: delivery.id,
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
  delivery: DeliveryConfig,
  override: SourcePushDeliveryOverride,
): ResolvedDeliveryConfig {
  const push = clonePushConfig(delivery.push)

  return {
    id: delivery.id,
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
  delivery: DeliveryConfig,
  override: SourceEmailDeliveryOverride,
): ResolvedDeliveryConfig {
  const email = cloneEmailConfig(delivery.email)

  return {
    id: delivery.id,
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

function applySourceDeliveryOverride(
  delivery: DeliveryConfig,
  override: SourceFileDeliveryOverride | SourcePushDeliveryOverride | SourceEmailDeliveryOverride,
): ResolvedDeliveryConfig {
  if (delivery.file) {
    return resolveFileDelivery(delivery, override as SourceFileDeliveryOverride)
  }

  if (delivery.push) {
    return resolvePushDelivery(delivery, override as SourcePushDeliveryOverride)
  }

  if (delivery.email) {
    return resolveEmailDelivery(delivery, override as SourceEmailDeliveryOverride)
  }

  return {
    id: delivery.id,
    file: undefined,
    push: undefined,
    email: undefined,
  }
}

function resolveSourceDeliveries(
  sourceId: string,
  sourceDeliveries: SourceDeliveriesConfig,
  deliveries: DeliveryConfig[],
): ResolvedDeliveryConfig[] {
  const deliveryMap = new Map(deliveries.map((delivery) => [delivery.id, delivery]))

  return Object.entries(sourceDeliveries).map(([deliveryId, override], index) => {
    const delivery = deliveryMap.get(deliveryId)

    if (!delivery) {
      throw new Error(`source.${sourceId}.deliveries 引用了未定义 delivery: ${deliveryId}`)
    }

    const resolvedDelivery = applySourceDeliveryOverride(delivery, override)

    return {
      ...resolvedDelivery,
      id: `${sourceId}__${deliveryId}__${index}`,
    }
  })
}

const AI_PROVIDER_DEFAULTS = {
  openai: {
    context: 128000,
    maxOutputTokens: 16384,
  },
  anthropic: {
    context: 200000,
    maxOutputTokens: 8192,
  },
  gemini: {
    context: 1048576,
    maxOutputTokens: 8192,
  },
} as const

const AI_MODEL_DEFAULTS: Record<string, { context: number; maxOutputTokens: number }> = {
  'gpt-4o': {
    context: 128000,
    maxOutputTokens: 16384,
  },
  'gpt-4o-mini': {
    context: 128000,
    maxOutputTokens: 16384,
  },
  'claude-3-7-sonnet-latest': {
    context: 200000,
    maxOutputTokens: 8192,
  },
  'claude-3-5-haiku-latest': {
    context: 200000,
    maxOutputTokens: 8192,
  },
  'gemini-2.5-flash': {
    context: 1048576,
    maxOutputTokens: 8192,
  },
} as const

function resolveAiModelDefaults(
  providerType: keyof typeof AI_PROVIDER_DEFAULTS,
  model: string,
): { context: number; maxOutputTokens: number } {
  return AI_MODEL_DEFAULTS[model] ?? AI_PROVIDER_DEFAULTS[providerType]
}

function shallowMergeOptions(
  base: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!base && !override) return undefined
  return {
    ...(base ?? {}),
    ...(override ?? {}),
  }
}

function toModelRef(providerId: string, modelId: string): AiModelRefResolved {
  return {
    ref: `${providerId}/${modelId}`,
    providerId,
    modelId,
  }
}

function resolveAiConfig(input?: AiConfigInput): AiConfigResolved | undefined {
  if (!input) return undefined

  const providers: AiProviderResolved[] = []
  const modelRefs: Record<string, AiModelRefResolved> = {}
  const bareModelRefProviders = new Map<string, string[]>()

  for (const [providerId, provider] of Object.entries(input.providers)) {
    const resolvedProvider: AiProviderResolved = {
      id: providerId,
      type: provider.type,
      apiKey: provider.apiKey,
      baseURL: provider.baseURL,
      headers: provider.headers ? { ...provider.headers } : undefined,
      options: provider.options ? { ...provider.options } : undefined,
      models: [],
    }

    for (const [modelId, model] of Object.entries(provider.models)) {
      const defaults = resolveAiModelDefaults(provider.type, model.model)
      const resolvedModel: AiModelResolved = {
        id: modelId,
        providerId,
        providerType: provider.type,
        ref: `${providerId}/${modelId}`,
        model: model.model,
        context: model.context ?? defaults.context,
        temperature: model.temperature,
        maxOutputTokens: model.maxOutputTokens ?? defaults.maxOutputTokens,
        options: model.options ? { ...model.options } : undefined,
        variants: {},
      }

      for (const [variantId, variant] of Object.entries(model.variants ?? {})) {
        resolvedModel.variants[variantId] = {
          temperature: variant.temperature ?? model.temperature,
          maxOutputTokens: variant.maxOutputTokens ?? resolvedModel.maxOutputTokens,
          options: shallowMergeOptions(model.options, variant.options),
        }
      }

      resolvedProvider.models.push(resolvedModel)

      const ref = toModelRef(providerId, modelId)
      modelRefs[ref.ref] = ref
      bareModelRefProviders.set(modelId, [
        ...(bareModelRefProviders.get(modelId) ?? []),
        providerId,
      ])
      if ((bareModelRefProviders.get(modelId) ?? []).length === 1) {
        modelRefs[modelId] = ref
      }
    }

    providers.push(resolvedProvider)
  }

  for (const [modelId, providerIds] of bareModelRefProviders.entries()) {
    if (providerIds.length > 1) {
      delete modelRefs[modelId]
    }
  }

  const firstModel = providers.flatMap((provider) => provider.models)[0]
  const defaultModel = input.defaultModel
    ? (modelRefs[input.defaultModel] ?? modelRefs[`${input.defaultModel}`])
    : firstModel
      ? toModelRef(firstModel.providerId, firstModel.id)
      : undefined

  return {
    providers,
    defaultModel,
    modelRefs,
  }
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

function resolveLanguage(inputLanguage: string | undefined): string {
  if (inputLanguage) return inputLanguage

  const locale = Intl.DateTimeFormat().resolvedOptions().locale
  if (!locale) return 'zh-CN'

  try {
    return Intl.getCanonicalLocales(locale)[0] ?? 'zh-CN'
  } catch {
    return 'zh-CN'
  }
}

export function resolveConfig(input: AppConfigValidated): AppConfigResolved {
  const timezone = input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
  const language = resolveLanguage(input.language)
  const deliveries = normalizeDeliveries(input.runtimeDir, input.deliveries ?? {})
  const sources = normalizeSources(input.sources ?? {})

  const resolvedSources: ResolvedSourceConfig[] = sources.map((source) => ({
    ...source,
    syndication: source.syndication ?? (source.xquery ? undefined : {}),
    enabled: source.enabled ?? true,
    deliveries: resolveSourceDeliveries(source.id, source.deliveries ?? {}, deliveries),
  }))

  return {
    runtimeDir: input.runtimeDir,
    language,
    timezone,
    timestampFormat: input.timestampFormat,
    sqlite: resolveSqliteConfig(input.runtimeDir, input.sqlite),
    ai: resolveAiConfig(input.ai),
    deliveries,
    sources: resolvedSources,
    logging: resolveLoggingConfig(input.logging),
  }
}
