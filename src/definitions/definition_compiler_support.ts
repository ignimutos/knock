import { toPushRequestType } from '../config/delivery_semantics.ts'
import type {
  AppConfigResolved,
  DeliveryConfig,
  ResolvedDeliveryConfig,
  ResolvedSourceConfig,
} from '../config/types.ts'
import type { DeliveryDefinition } from '../domain/delivery_definition.ts'
import type { DeliveryBinding } from '../domain/run_plan.ts'
import type { SourceDefinition } from '../domain/source_definition.ts'

function getCompiledDeliveryId(delivery: DeliveryConfig | ResolvedDeliveryConfig): string {
  return 'deliveryId' in delivery ? delivery.deliveryId : delivery.id
}

export function compileSourceDefinition(source: ResolvedSourceConfig): SourceDefinition {
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

export function compileDeliveryDefinition(
  delivery: DeliveryConfig | ResolvedDeliveryConfig,
): DeliveryDefinition {
  const deliveryId = getCompiledDeliveryId(delivery)

  if (delivery.file) {
    return {
      kind: 'file',
      deliveryId,
      path: delivery.file.path,
      contentTemplate: delivery.file.content,
      rotation: delivery.file.rotation ? structuredClone(delivery.file.rotation) : undefined,
    }
  }

  if (delivery.push) {
    return {
      kind: 'push',
      deliveryId,
      http: structuredClone(delivery.push.http),
      requestType: toPushRequestType(delivery.push.request.type),
      payloadTemplate: structuredClone(delivery.push.request.payload ?? {}),
      response: delivery.push.response ? structuredClone(delivery.push.response) : undefined,
    }
  }

  if (delivery.email) {
    return {
      kind: 'email',
      deliveryId,
      smtp: structuredClone(delivery.email.smtp),
      messageTemplate: structuredClone(delivery.email.message),
    }
  }

  throw new Error(`delivery ${deliveryId} 缺少可装配的定义类型`)
}

export function compileCanonicalDeliveryDefinitions(
  config: Pick<AppConfigResolved, 'deliveries'>,
): DeliveryDefinition[] {
  return config.deliveries.map(compileDeliveryDefinition)
}

export function compileSourceDefinitions(
  config: Pick<AppConfigResolved, 'sources'>,
): SourceDefinition[] {
  return config.sources.map(compileSourceDefinition)
}

export function compileSourceBindings(
  config: Pick<AppConfigResolved, 'sources'>,
): DeliveryBinding[] {
  return config.sources.flatMap((source) =>
    source.deliveries.map((delivery) => ({
      sourceId: source.id,
      deliveryId: delivery.deliveryId,
      definition: compileDeliveryDefinition(delivery),
    })),
  )
}
