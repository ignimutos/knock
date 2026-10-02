import type { EffectDomain } from '../../domain/run_profile.ts'

export interface ItemDeduplicationInput {
  sourceId: string
  effectDomain: EffectDomain
  fingerprint: string
}

export interface DeliveryDeduplicationInput extends ItemDeduplicationInput {
  deliveryId: string
}

export interface RegisterItemFingerprintInput extends ItemDeduplicationInput {
  recordedAt: string
}

export interface RegisterDeliveryFingerprintInput extends DeliveryDeduplicationInput {
  recordedAt: string
}

export interface DeduplicationRepository {
  isItemDuplicate(input: ItemDeduplicationInput): Promise<boolean>
  registerItemFingerprint(input: RegisterItemFingerprintInput): Promise<void>
  isDeliveryDuplicate(input: DeliveryDeduplicationInput): Promise<boolean>
  registerDeliveryFingerprint(input: RegisterDeliveryFingerprintInput): Promise<void>
}
