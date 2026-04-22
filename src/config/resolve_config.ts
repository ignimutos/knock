import type {
  AppConfigResolved,
  LoggingConfigResolved,
  ResolvedSourceConfig,
  SqliteConfigResolved,
} from './types.ts'
import type { AppConfigValidated, LoggingConfigInput, SqliteConfigInput } from './schema.ts'
import { resolveRuntimePath } from './runtime_semantics.ts'
import { normalizeDeliveries, resolveSourceDeliveries } from './resolve_delivery_config.ts'
import { resolveAiConfig } from './resolve_ai_config.ts'
import { resolveLoggingConfig as resolveLoggingConfigImpl } from './resolve_logging_config.ts'
import { cloneSourceSummaryConfig, normalizeSources } from './resolve_source_config.ts'

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

export function resolveLoggingConfig(
  runtimeDir: string,
  input: LoggingConfigInput,
): LoggingConfigResolved {
  return resolveLoggingConfigImpl(runtimeDir, input)
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
  const deliveryMap = new Map(deliveries.map((delivery) => [delivery.id, delivery] as const))
  const sources = normalizeSources(input.sources ?? {})

  const resolvedSources: ResolvedSourceConfig[] = sources.map((source) => ({
    ...source,
    http: source.summary ? undefined : source.http,
    byparr: source.summary ? undefined : source.byparr,
    summary: cloneSourceSummaryConfig(source.summary),
    syndication: source.summary
      ? undefined
      : (source.syndication ?? (source.xquery ? undefined : {})),
    xquery: source.summary ? undefined : source.xquery,
    enabled: source.enabled ?? true,
    deliveries: resolveSourceDeliveries(source.id, source.deliveries ?? {}, deliveryMap),
  }))

  return {
    runtimeDir: input.runtimeDir,
    language,
    timezone,
    timestampFormat: input.timestampFormat,
    sqlite: resolveSqliteConfig(input.runtimeDir, input.sqlite),
    ai: resolveAiConfig(input.ai),
    deliveries: deliveries.filter((delivery) => delivery.enabled !== false),
    sources: resolvedSources,
    logging: resolveLoggingConfig(input.runtimeDir, input.logging),
  }
}
