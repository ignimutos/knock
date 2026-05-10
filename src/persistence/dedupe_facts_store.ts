import type {
  DeduplicationRepository,
  DeliveryDeduplicationInput,
  ItemDeduplicationInput,
  RegisterDeliveryFingerprintInput,
  RegisterItemFingerprintInput,
} from '../workflow/ports/deduplication_repository.ts'

export interface DedupeFactsStore extends DeduplicationRepository {
  isItemDuplicate(input: ItemDeduplicationInput): Promise<boolean>
  registerItemFingerprint(input: RegisterItemFingerprintInput): Promise<void>
  isDeliveryDuplicate(input: DeliveryDeduplicationInput): Promise<boolean>
  registerDeliveryFingerprint(input: RegisterDeliveryFingerprintInput): Promise<void>
}
