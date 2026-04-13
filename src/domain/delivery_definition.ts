import type { FileDeliveryConfig } from '../config/schema.ts'
import type { EmailMessageConfig, HttpPayload, ResolvedDeliveryConfig } from '../config/types.ts'

export type DeliveryDefinition =
  | FileDeliveryDefinition
  | HttpPushDeliveryDefinition
  | EmailDeliveryDefinition

export interface FileDeliveryDefinition {
  kind: 'file'
  deliveryId: string
  path: string
  contentTemplate: string
  rotation?: FileDeliveryConfig['rotation']
}

export interface HttpPushDeliveryDefinition {
  kind: 'push'
  deliveryId: string
  http: NonNullable<ResolvedDeliveryConfig['push']>['http']
  requestType: 'body' | 'query' | 'form'
  payloadTemplate: HttpPayload
  response?: NonNullable<ResolvedDeliveryConfig['push']>['response']
}

export interface EmailDeliveryDefinition {
  kind: 'email'
  deliveryId: string
  smtp: NonNullable<ResolvedDeliveryConfig['email']>['smtp']
  messageTemplate: EmailMessageConfig
}

export function isFileDeliveryDefinition(
  definition: DeliveryDefinition,
): definition is FileDeliveryDefinition {
  return definition.kind === 'file'
}

export function isPushDeliveryDefinition(
  definition: DeliveryDefinition,
): definition is HttpPushDeliveryDefinition {
  return definition.kind === 'push'
}

export function isEmailDeliveryDefinition(
  definition: DeliveryDefinition,
): definition is EmailDeliveryDefinition {
  return definition.kind === 'email'
}
