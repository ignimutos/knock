import { and, eq } from 'drizzle-orm'
import type { DeduplicationRepository as ApplicationDeduplicationRepository } from '../../application/ports/deduplication_repository.ts'
import type { EffectDomain } from '../../domain/run_profile.ts'
import type { FactsDbClient } from '../../db/client.ts'
import { deduplications } from './schema.ts'

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
      const row = db
        .select({ id: deduplications.id })
        .from(deduplications)
        .where(
          and(
            eq(deduplications.deduplicationKey, input.deduplicationKey),
            eq(deduplications.scope, input.scope),
            eq(deduplications.scopeId, input.scopeId),
            eq(deduplications.effectDomain, input.effectDomain),
            eq(deduplications.fingerprint, input.fingerprint),
          ),
        )
        .get()

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
  db.insert(deduplications)
    .values({
      deduplicationKey: input.deduplicationKey,
      scope: input.scope,
      scopeId: input.scopeId,
      effectDomain: input.effectDomain,
      fingerprint: input.fingerprint,
      recordedAt: input.recordedAt,
    })
    .onConflictDoNothing({
      target: deduplications.deduplicationKey,
    })
    .run()

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
