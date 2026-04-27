import type { DeduplicationRepository as ApplicationDeduplicationRepository } from '../../application/ports/deduplication_repository.ts'
import type { EffectDomain } from '../../domain/run_profile.ts'
import type { FactsDbClient } from '../../db/client.ts'

export type DeduplicationScope = 'item' | 'delivery'

export interface DeduplicationFingerprint {
  deduplicationKey: string
  scope: DeduplicationScope
  scopeId: string
  effectDomain: EffectDomain
  fingerprint: string
}

export interface DeduplicationRecord extends DeduplicationFingerprint {
  recordedAt: string
}

export interface DeduplicationRepository {
  isDuplicate(input: DeduplicationFingerprint): Promise<boolean>
  register(input: DeduplicationRecord): Promise<void>
}

export function createDeduplicationRepository(db: FactsDbClient): DeduplicationRepository {
  return {
    isDuplicate(input: DeduplicationFingerprint): Promise<boolean> {
      const row = db.$client
        .prepare(
          `
            SELECT id
            FROM deduplications
            WHERE deduplication_key = ?
              AND scope = ?
              AND scope_id = ?
              AND effect_domain = ?
              AND fingerprint = ?
            LIMIT 1
          `,
        )
        .get(
          input.deduplicationKey,
          input.scope,
          input.scopeId,
          input.effectDomain,
          input.fingerprint,
        )

      return Promise.resolve(row !== undefined)
    },

    register(input: DeduplicationRecord): Promise<void> {
      return registerItemFingerprint(db, input)
    },
  }
}

export function registerItemFingerprint(
  db: FactsDbClient,
  input: DeduplicationRecord,
): Promise<void> {
  db.$client
    .prepare(
      `
        INSERT INTO deduplications (
          deduplication_key,
          scope,
          scope_id,
          effect_domain,
          fingerprint,
          recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(deduplication_key) DO NOTHING
      `,
    )
    .run(
      input.deduplicationKey,
      input.scope,
      input.scopeId,
      input.effectDomain,
      input.fingerprint,
      input.recordedAt,
    )

  return Promise.resolve()
}

export function createApplicationDeduplicationRepository(
  db: FactsDbClient,
): ApplicationDeduplicationRepository {
  const repository = createDeduplicationRepository(db)

  return {
    isItemDuplicate: ({ sourceId, effectDomain, fingerprint }) =>
      repository.isDuplicate({
        deduplicationKey: buildItemDeduplicationKey(sourceId, effectDomain, fingerprint),
        scope: 'item',
        scopeId: sourceId,
        effectDomain,
        fingerprint,
      }),
    registerItemFingerprint: ({ sourceId, effectDomain, fingerprint, recordedAt }) =>
      repository.register({
        deduplicationKey: buildItemDeduplicationKey(sourceId, effectDomain, fingerprint),
        scope: 'item',
        scopeId: sourceId,
        effectDomain,
        fingerprint,
        recordedAt,
      }),
    isDeliveryDuplicate: ({ sourceId, deliveryId, effectDomain, fingerprint }) =>
      repository.isDuplicate({
        deduplicationKey: buildDeliveryDeduplicationKey(
          sourceId,
          deliveryId,
          effectDomain,
          fingerprint,
        ),
        scope: 'delivery',
        scopeId: deliveryId,
        effectDomain,
        fingerprint,
      }),
    registerDeliveryFingerprint: ({
      sourceId,
      deliveryId,
      effectDomain,
      fingerprint,
      recordedAt,
    }) =>
      repository.register({
        deduplicationKey: buildDeliveryDeduplicationKey(
          sourceId,
          deliveryId,
          effectDomain,
          fingerprint,
        ),
        scope: 'delivery',
        scopeId: deliveryId,
        effectDomain,
        fingerprint,
        recordedAt,
      }),
  }
}

function buildItemDeduplicationKey(
  sourceId: string,
  effectDomain: EffectDomain,
  fingerprint: string,
): string {
  return `${effectDomain}:item:${sourceId}:${fingerprint}`
}

function buildDeliveryDeduplicationKey(
  sourceId: string,
  deliveryId: string,
  effectDomain: EffectDomain,
  fingerprint: string,
): string {
  return `${effectDomain}:delivery:${sourceId}:${deliveryId}:${fingerprint}`
}
