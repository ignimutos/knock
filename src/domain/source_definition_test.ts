import { assertEquals } from '@std/assert'
// 风险映射: R06 R07 R09
import {
  isFetchSourceDefinition,
  isSummarySourceDefinition,
  type SourceDefinition,
} from './source_definition.ts'
import {
  isEmailDeliveryDefinition,
  isFileDeliveryDefinition,
  isPushDeliveryDefinition,
  type DeliveryDefinition,
} from './delivery_definition.ts'
import { test } from '../testing/test_api.ts'

test('[unit] domain: SourceDefinition 判别联合应区分 fetch 与 summary', () => {
  const fetchSource: SourceDefinition = {
    kind: 'fetch',
    sourceId: 'rust',
    fetcher: 'http',
    parser: 'syndication',
  }
  const summarySource: SourceDefinition = {
    kind: 'summary',
    sourceId: 'daily',
    upstreamSourceIds: ['rust'],
  }

  assertEquals(isFetchSourceDefinition(fetchSource), true)
  assertEquals(isSummarySourceDefinition(fetchSource), false)
  assertEquals(isSummarySourceDefinition(summarySource), true)
  assertEquals(isFetchSourceDefinition(summarySource), false)
})

test('[unit] domain: DeliveryDefinition 判别联合应区分 file/push/email', () => {
  const fileDelivery: DeliveryDefinition = {
    kind: 'file',
    deliveryId: 'archive',
    path: '/tmp/archive.md',
    contentTemplate: '{{ entry.title }}',
  }
  const pushDelivery: DeliveryDefinition = {
    kind: 'push',
    deliveryId: 'telegram',
    http: {
      method: 'POST',
      url: 'https://example.com/hook',
    },
    requestType: 'form',
    payloadTemplate: { text: '{{ entry.title }}' },
  }
  const emailDelivery: DeliveryDefinition = {
    kind: 'email',
    deliveryId: 'release_email',
    smtp: {
      host: 'smtp.example.com',
      port: 587,
      security: 'starttls',
    },
    messageTemplate: {
      from: 'bot@example.com',
      to: ['ops@example.com'],
      subject: '{{ entry.title }}',
      text: '{{ entry.description }}',
    },
  }

  assertEquals(isFileDeliveryDefinition(fileDelivery), true)
  assertEquals(isPushDeliveryDefinition(fileDelivery), false)
  assertEquals(isEmailDeliveryDefinition(fileDelivery), false)

  assertEquals(isPushDeliveryDefinition(pushDelivery), true)
  assertEquals(isFileDeliveryDefinition(pushDelivery), false)
  assertEquals(isEmailDeliveryDefinition(pushDelivery), false)

  assertEquals(isEmailDeliveryDefinition(emailDelivery), true)
  assertEquals(isFileDeliveryDefinition(emailDelivery), false)
  assertEquals(isPushDeliveryDefinition(emailDelivery), false)
})
