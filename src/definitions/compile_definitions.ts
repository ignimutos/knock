import { toPushRequestType } from '../config/delivery_semantics.ts'
import type {
  AppConfigResolved,
  DeliveryConfig,
  ResolvedDeliveryConfig,
  ResolvedSourceConfig,
} from '../config/types.ts'
import type { DeliveryDefinition } from '../domain/delivery_definition.ts'
import type { SourceDefinition } from '../domain/source_definition.ts'
import type { DefinitionSet } from './definition_set.ts'

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

function toDeliveryDefinition(
  delivery: DeliveryConfig | ResolvedDeliveryConfig,
): DeliveryDefinition {
  if (delivery.file) {
    return {
      kind: 'file',
      deliveryId: 'deliveryId' in delivery ? delivery.deliveryId : delivery.id,
      path: delivery.file.path,
      contentTemplate: delivery.file.content,
      rotation: delivery.file.rotation ? structuredClone(delivery.file.rotation) : undefined,
    }
  }

  if (delivery.push) {
    return {
      kind: 'push',
      deliveryId: 'deliveryId' in delivery ? delivery.deliveryId : delivery.id,
      http: structuredClone(delivery.push.http),
      requestType: toPushRequestType(delivery.push.request.type),
      payloadTemplate: structuredClone(delivery.push.request.payload ?? {}),
      response: delivery.push.response ? structuredClone(delivery.push.response) : undefined,
    }
  }

  if (delivery.email) {
    return {
      kind: 'email',
      deliveryId: 'deliveryId' in delivery ? delivery.deliveryId : delivery.id,
      smtp: structuredClone(delivery.email.smtp),
      messageTemplate: structuredClone(delivery.email.message),
    }
  }

  const deliveryId = 'deliveryId' in delivery ? delivery.deliveryId : delivery.id
  throw new Error(`delivery ${deliveryId} 缺少可装配的定义类型`)
}

export function compileDefinitionsFromResolvedConfig(config: AppConfigResolved): DefinitionSet {
  const deliveries = config.deliveries.map(toDeliveryDefinition)
  const sources = config.sources.map(toSourceDefinition)
  const bindings = config.sources.flatMap((source) =>
    source.deliveries.map((delivery) => ({
      sourceId: source.id,
      deliveryId: delivery.deliveryId,
      definition: toDeliveryDefinition(delivery),
    })),
  )

  return {
    sources,
    deliveries,
    bindings,
    sourceConfigsById: Object.fromEntries(config.sources.map((source) => [source.id, source])),
    policies: {
      preview: {
        persistFacts: false,
        writeDedupe: false,
        allowExternalSideEffects: false,
        exposeToRecovery: false,
        exposeToPrune: false,
      },
      production: {
        persistFacts: true,
        writeDedupe: true,
        allowExternalSideEffects: true,
        exposeToRecovery: true,
        exposeToPrune: true,
      },
    },
  }
}
