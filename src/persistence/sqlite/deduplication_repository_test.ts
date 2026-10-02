import { assertEquals } from '../../testing/assert.ts'
import { createInMemoryDb } from './client.ts'
import { createApplicationDeduplicationRepository } from './deduplication_repository.ts'
import { test } from '../../testing/test_api.ts'

test('[contract] sqlite deduplication repository: 应登记并查询 item 与 delivery 指纹', async () => {
  const db = createInMemoryDb()
  const store = createApplicationDeduplicationRepository(db)

  assertEquals(
    await store.isItemDuplicate({
      sourceId: 'rust',
      effectDomain: 'production',
      fingerprint: 'item-fp',
    }),
    false,
  )

  await store.registerItemFingerprint({
    sourceId: 'rust',
    effectDomain: 'production',
    fingerprint: 'item-fp',
    recordedAt: '2026-05-10T08:00:00.000Z',
  })

  assertEquals(
    await store.isItemDuplicate({
      sourceId: 'rust',
      effectDomain: 'production',
      fingerprint: 'item-fp',
    }),
    true,
  )

  assertEquals(
    await store.isDeliveryDuplicate({
      sourceId: 'rust',
      deliveryId: 'local',
      effectDomain: 'production',
      fingerprint: 'delivery-fp',
    }),
    false,
  )

  await store.registerDeliveryFingerprint({
    sourceId: 'rust',
    deliveryId: 'local',
    effectDomain: 'production',
    fingerprint: 'delivery-fp',
    recordedAt: '2026-05-10T08:00:01.000Z',
  })

  assertEquals(
    await store.isDeliveryDuplicate({
      sourceId: 'rust',
      deliveryId: 'local',
      effectDomain: 'production',
      fingerprint: 'delivery-fp',
    }),
    true,
  )
})
