import type { SourceByparrConfig, SourceConfigInput, SourceHttpConfig } from './schema.ts'
import { resolveSourceDeliveries } from './resolve_delivery_config.ts'
import type { DeliveryConfig, ResolvedSourceConfig } from './types.ts'

type NormalizedSourceConfig = SourceConfigInput & { id: string }

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

export function cloneSourceSummaryConfig(
  input?: SourceConfigInput['summary'],
): SourceConfigInput['summary'] | undefined {
  if (!input) return undefined

  return {
    sources: [...input.sources],
    feed: input.feed ? { ...input.feed } : undefined,
    entry: input.entry ? { ...input.entry } : undefined,
  }
}

export function normalizeSources(
  value: Record<string, SourceConfigInput>,
): NormalizedSourceConfig[] {
  return Object.entries(value).map(([id, source]) => ({
    ...source,
    id,
    http: cloneSourceHttpConfig(source.http),
    byparr: cloneSourceByparrConfig(source.byparr),
    summary: cloneSourceSummaryConfig(source.summary),
  }))
}

function resolveSource(
  source: NormalizedSourceConfig,
  deliveryMap: ReadonlyMap<string, DeliveryConfig>,
): ResolvedSourceConfig {
  return {
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
  }
}

export function resolveSources(
  value: Record<string, SourceConfigInput>,
  deliveries: readonly DeliveryConfig[],
): ResolvedSourceConfig[] {
  const deliveryMap = new Map(deliveries.map((delivery) => [delivery.id, delivery] as const))
  return normalizeSources(value).map((source) => resolveSource(source, deliveryMap))
}
