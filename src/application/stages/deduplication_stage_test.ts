import { assertEquals } from '@std/assert'
import { DeduplicationStage } from './deduplication_stage.ts'
import { test } from '../../testing/test_api.ts'

// risk-id: R12
// layer: unit

test('[unit] deduplicationStage: item 与 delivery 应分开判定', async () => {
  const stage = new DeduplicationStage({
    repository: {
      isItemDuplicate: ({ effectDomain }) => Promise.resolve(effectDomain === 'preview'),
      registerItemFingerprint: () => Promise.resolve(),
      isDeliveryDuplicate: ({ deliveryId }) => Promise.resolve(deliveryId === 'archive'),
      registerDeliveryFingerprint: () => Promise.resolve(),
    },
  })

  const result = await stage.run({
    fingerprint: 'entry-1',
    sourceId: 'rust',
    effectDomain: 'production',
    deliveries: ['archive', 'telegram'],
    recordedAt: '2026-04-13T10:00:00.000Z',
  })

  assertEquals(result.itemStatus, 'new')
  assertEquals(result.deliveryStatuses.archive, 'duplicate')
  assertEquals(result.deliveryStatuses.telegram, 'new')
})

test('[unit] deduplicationStage: item duplicate 时应短路所有 delivery', async () => {
  const stage = new DeduplicationStage({
    repository: {
      isItemDuplicate: () => Promise.resolve(true),
      registerItemFingerprint: () => Promise.resolve(),
      isDeliveryDuplicate: () => Promise.resolve(false),
      registerDeliveryFingerprint: () => Promise.resolve(),
    },
  })

  const result = await stage.run({
    fingerprint: 'entry-2',
    sourceId: 'rust',
    effectDomain: 'production',
    deliveries: ['archive', 'telegram'],
    recordedAt: '2026-04-13T10:00:00.000Z',
  })

  assertEquals(result.itemStatus, 'duplicate')
  assertEquals(result.deliveryStatuses, {
    archive: 'duplicate',
    telegram: 'duplicate',
  })
})

test('[unit] deduplicationStage: 判定阶段不应提前注册 fingerprint', async () => {
  let itemRegisters = 0
  let deliveryRegisters = 0

  const stage = new DeduplicationStage({
    repository: {
      isItemDuplicate: () => Promise.resolve(false),
      registerItemFingerprint: () => {
        itemRegisters += 1
        return Promise.resolve()
      },
      isDeliveryDuplicate: () => Promise.resolve(false),
      registerDeliveryFingerprint: () => {
        deliveryRegisters += 1
        return Promise.resolve()
      },
    },
  })

  const result = await stage.run({
    fingerprint: 'entry-3',
    sourceId: 'rust',
    effectDomain: 'production',
    deliveries: ['archive', 'telegram'],
    recordedAt: '2026-04-13T10:00:00.000Z',
  })

  assertEquals(result.itemStatus, 'new')
  assertEquals(result.deliveryStatuses, { archive: 'new', telegram: 'new' })
  assertEquals(itemRegisters, 0)
  assertEquals(deliveryRegisters, 0)
})
