import type { LoadConfigOptions } from '../../config/load_config.ts'
import { loadConfig } from '../../config/load_config.ts'
import type {
  DeliveryConfig,
  ResolvedDeliveryConfig,
  ResolvedSourceConfig,
} from '../../config/types.ts'
import type { DeliveryDefinition } from '../../domain/delivery_definition.ts'
import type { DeliveryBinding } from '../../domain/run_plan.ts'
import type { SourceDefinition } from '../../domain/source_definition.ts'

export interface LoadedDefinitions {
  sources: SourceDefinition[]
  deliveries: DeliveryDefinition[]
  bindings: DeliveryBinding[]
  sourceConfigsById: Record<string, ResolvedSourceConfig>
}

function toSourceDefinition(source: ResolvedSourceConfig): SourceDefinition {
  if (source.summary) {
    return {
      kind: 'summary',
      sourceId: source.id,
      upstreamSourceIds: [...source.summary.sources],
      ...(source.filter ? { filter: source.filter } : {}),
    }
  }

  return {
    kind: 'fetch',
    sourceId: source.id,
    fetcher: source.byparr ? 'byparr' : 'http',
    parser: source.xquery ? 'xquery' : 'syndication',
    ...(source.filter ? { filter: source.filter } : {}),
  }
}

function toPushRequestType(
  delivery: Pick<ResolvedDeliveryConfig, 'push'>,
): 'body' | 'query' | 'form' {
  return delivery.push?.request.type ?? 'body'
}

function toResolvedDeliveryDefinition(delivery: ResolvedDeliveryConfig): DeliveryDefinition {
  if (delivery.file) {
    return {
      kind: 'file',
      deliveryId: delivery.deliveryId,
      path: delivery.file.path,
      contentTemplate: delivery.file.content,
      rotation: delivery.file.rotation ? structuredClone(delivery.file.rotation) : undefined,
    }
  }

  if (delivery.push) {
    return {
      kind: 'push',
      deliveryId: delivery.deliveryId,
      http: structuredClone(delivery.push.http),
      requestType: toPushRequestType(delivery),
      payloadTemplate: structuredClone(delivery.push.request.payload ?? {}),
      response: delivery.push.response ? structuredClone(delivery.push.response) : undefined,
    }
  }

  if (delivery.email) {
    return {
      kind: 'email',
      deliveryId: delivery.deliveryId,
      smtp: structuredClone(delivery.email.smtp),
      messageTemplate: structuredClone(delivery.email.message),
    }
  }

  throw new Error(`delivery ${delivery.deliveryId} 缺少可装配的定义类型`)
}

function toCanonicalDeliveryDefinition(delivery: DeliveryConfig): DeliveryDefinition {
  return toResolvedDeliveryDefinition({
    id: delivery.id,
    sourceId: delivery.id,
    deliveryId: delivery.id,
    file: delivery.file,
    push: delivery.push,
    email: delivery.email,
  })
}

export function buildLoadedDefinitionsFromResolvedConfig(
  config: Awaited<ReturnType<typeof loadConfig>>,
): LoadedDefinitions {
  const deliveries = config.deliveries.map(toCanonicalDeliveryDefinition)
  const sources = config.sources.map(toSourceDefinition)
  const bindings = config.sources.flatMap((source) =>
    source.deliveries.map((delivery) => ({
      sourceId: source.id,
      deliveryId: delivery.deliveryId,
      definition: toResolvedDeliveryDefinition(delivery),
    })),
  )

  return {
    sources,
    deliveries,
    bindings,
    sourceConfigsById: Object.fromEntries(config.sources.map((source) => [source.id, source])),
  }
}

export async function loadDefinitions(options: LoadConfigOptions = {}): Promise<LoadedDefinitions> {
  const config = await loadConfig(options)
  return buildLoadedDefinitionsFromResolvedConfig(config)
}
