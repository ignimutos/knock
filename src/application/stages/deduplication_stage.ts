import type { DeduplicationRepository } from '../ports/deduplication_repository.ts'

export interface DeduplicationStageInput {
  fingerprint: string
  sourceId: string
  effectDomain: 'production' | 'preview'
  deliveries: string[]
  recordedAt: string
}

export interface DeduplicationStageResult {
  itemStatus: 'new' | 'duplicate'
  deliveryStatuses: Record<string, 'new' | 'duplicate'>
}

export interface DeduplicationStageDeps {
  repository: DeduplicationRepository
}

export class DeduplicationStage {
  constructor(private readonly deps: DeduplicationStageDeps) {}

  async run(input: DeduplicationStageInput): Promise<DeduplicationStageResult> {
    const itemDuplicate = await this.deps.repository.isItemDuplicate({
      sourceId: input.sourceId,
      effectDomain: input.effectDomain,
      fingerprint: input.fingerprint,
    })

    if (itemDuplicate) {
      return {
        itemStatus: 'duplicate',
        deliveryStatuses: Object.fromEntries(
          input.deliveries.map((deliveryId) => [deliveryId, 'duplicate']),
        ),
      }
    }

    const deliveryStatuses: Record<string, 'new' | 'duplicate'> = {}
    for (const deliveryId of input.deliveries) {
      const duplicate = await this.deps.repository.isDeliveryDuplicate({
        sourceId: input.sourceId,
        deliveryId,
        effectDomain: input.effectDomain,
        fingerprint: input.fingerprint,
      })

      if (duplicate) {
        deliveryStatuses[deliveryId] = 'duplicate'
        continue
      }

      deliveryStatuses[deliveryId] = 'new'
    }

    return {
      itemStatus: 'new',
      deliveryStatuses,
    }
  }
}
