import { assertEquals, assertThrows } from '../../src/testing/assert.ts'
import type { PushConfig } from '../../src/config/schema.ts'
import type {
  ConfigWorkbenchOverview,
  ReaderSourceOverview,
} from '../../src/contracts/workbench.ts'
import { test } from '../../src/testing/test_api.ts'

import { type DeliveryDraft } from './config_workbench_state.ts'
import {
  buildDeliveryPayload,
  buildSourcePayload,
  createDeliveryFormState,
  createGlobalFormState,
  createSourceFormState,
} from '../components/config/form_state.ts'

test('[unit] config workbench state: createGlobalFormState 应保留 logging file rotation 字段', () => {
  const global: ConfigWorkbenchOverview['global'] = {
    language: 'en-US',
    timezone: 'UTC',
    timestampFormat: 'yyyy-MM-dd HH:mm:ss',
    sqlite: undefined,
    sqliteJson: '',
    logging: {
      level: 'info',
      sinks: {
        file: {
          type: 'file',
          format: 'jsonl',
          path: 'logs/app.jsonl',
          rotation: {
            type: 'size',
            maxSize: '10m',
            maxFiles: 7,
          },
        },
      },
    },
    loggingJson: '{}',
    ai: undefined,
    aiJson: '',
  }

  const state = createGlobalFormState(global)

  assertEquals(state.loggingFileEnabled, true)
  assertEquals(state.loggingFilePath, 'logs/app.jsonl')
  assertEquals(state.loggingFileRotationType, 'size')
  assertEquals(state.loggingFileRotationMaxSize, '10m')
  assertEquals(state.loggingFileRotationMaxFiles, '7')
  assertEquals(state.loggingFileRotationInterval, '')
  assertEquals(state.loggingFileRotationMaxAge, '')
})

test('[unit] config workbench state: buildDeliveryPayload 应保留 push payload 与 retry 字段', () => {
  const pushConfig: PushConfig = {
    http: {
      url: 'https://example.com/hook',
      method: 'POST',
      retry: {
        limit: 3,
        statusCodes: [429, 503],
        retryOnTimeout: false,
        backoffLimit: '30s',
      },
    },
    request: {
      type: 'body',
      payload: {
        text: '{{ entry.title }}',
        priority: 1,
      },
    },
  }
  const delivery: DeliveryDraft = {
    id: 'telegram',
    enabled: true,
    kind: 'push',
    config: pushConfig,
    configJson: JSON.stringify(pushConfig, null, 2),
  }

  const state = createDeliveryFormState(delivery)
  const payload = buildDeliveryPayload(state)

  assertEquals(payload.pushRequestPayload, {
    text: '{{ entry.title }}',
    priority: 1,
  })
  assertEquals(payload.pushRetryLimit, 3)
  assertEquals(payload.pushRetryStatusCodes, [429, 503])
  assertEquals(payload.pushRetryOnTimeout, false)
  assertEquals(payload.pushRetryBackoffLimit, '30s')
})

function createSourceOverview(
  deliveryOverrides: ReaderSourceOverview['deliveryOverrides'],
): ReaderSourceOverview {
  return {
    id: 'source-1',
    name: 'Source 1',
    enabled: true,
    schedule: '0 * * * *',
    filter: 'entry.title !== ""',
    parser: 'syndication',
    transport: 'http',
    sourceUrl: 'https://example.com/feed.xml',
    xqueryLocate: undefined,
    xqueryEntryId: undefined,
    deliveryCount: 3,
    deliveryIds: ['file-delivery', 'push-delivery', 'email-delivery'],
    deliveryKinds: ['file', 'push', 'email'],
    deliveryOverrides,
    entries: [],
  }
}

test('[unit] config workbench state: createSourceFormState 应保留 source overrides textarea 值', () => {
  const source = createSourceOverview({
    'file-delivery': { content: '{{ entry.title }}' },
    'push-delivery': { payload: { text: '{{ entry.title }}', priority: 1 } },
    'email-delivery': { message: { subject: '{{ entry.title }}', html: '<b>ok</b>' } },
  })

  const state = createSourceFormState(source)

  assertEquals(state.deliveryOverrides['file-delivery'], '{{ entry.title }}')
  assertEquals(
    state.deliveryOverrides['push-delivery'],
    '{\n  "text": "{{ entry.title }}",\n  "priority": 1\n}',
  )
  assertEquals(
    state.deliveryOverrides['email-delivery'],
    '{\n  "subject": "{{ entry.title }}",\n  "html": "<b>ok</b>"\n}',
  )
})

test('[unit] config workbench state: buildSourcePayload 应转换 file/push/email override', () => {
  const payload = buildSourcePayload(
    {
      id: 'source-1',
      name: 'Source 1',
      enabled: true,
      schedule: '',
      filter: '',
      transport: 'http',
      parser: 'syndication',
      targetUrl: 'https://example.com/feed.xml',
      xqueryLocate: '',
      xqueryEntryId: '',
      deliveryIds: ['file-delivery', 'push-delivery', 'email-delivery'],
      deliveryOverrides: {
        'file-delivery': '{{ entry.title }}',
        'push-delivery': '{\n  "text": "{{ entry.title }}"\n}',
        'email-delivery': '{\n  "subject": "{{ entry.title }}"\n}',
      },
    },
    [
      { id: 'file-delivery', kind: 'file' },
      { id: 'push-delivery', kind: 'push' },
      { id: 'email-delivery', kind: 'email' },
    ],
  )

  assertEquals(payload.deliveryOverrides['file-delivery'], { content: '{{ entry.title }}' })
  assertEquals(payload.deliveryOverrides['push-delivery'], {
    payload: { text: '{{ entry.title }}' },
  })
  assertEquals(payload.deliveryOverrides['email-delivery'], {
    message: { subject: '{{ entry.title }}' },
  })
})

test('[unit] config workbench state: buildSourcePayload 在空串 override 时应回退空对象', () => {
  const payload = buildSourcePayload(
    {
      id: 'source-1',
      name: 'Source 1',
      enabled: true,
      schedule: '',
      filter: '',
      transport: 'http',
      parser: 'syndication',
      targetUrl: 'https://example.com/feed.xml',
      xqueryLocate: '',
      xqueryEntryId: '',
      deliveryIds: ['file-delivery', 'push-delivery', 'email-delivery'],
      deliveryOverrides: {
        'file-delivery': '   ',
        'push-delivery': '',
        'email-delivery': '  ',
      },
    },
    [
      { id: 'file-delivery', kind: 'file' },
      { id: 'push-delivery', kind: 'push' },
      { id: 'email-delivery', kind: 'email' },
    ],
  )

  assertEquals(payload.deliveryOverrides['file-delivery'], {})
  assertEquals(payload.deliveryOverrides['push-delivery'], {})
  assertEquals(payload.deliveryOverrides['email-delivery'], {})
})

test('[unit] config workbench state: buildSourcePayload 遇到非法 JSON override 应抛错', () => {
  assertThrows(
    () =>
      buildSourcePayload(
        {
          id: 'source-1',
          name: 'Source 1',
          enabled: true,
          schedule: '',
          filter: '',
          transport: 'http',
          parser: 'syndication',
          targetUrl: 'https://example.com/feed.xml',
          xqueryLocate: '',
          xqueryEntryId: '',
          deliveryIds: ['push-delivery'],
          deliveryOverrides: {
            'push-delivery': '{ invalid',
          },
        },
        [{ id: 'push-delivery', kind: 'push' }],
      ),
    'push-delivery override 必须是合法 JSON',
  )
})

test('[unit] config workbench state: buildSourcePayload 遇到未知 deliveryId 应直接抛错', () => {
  assertThrows(
    () =>
      buildSourcePayload(
        {
          id: 'source-1',
          name: 'Source 1',
          enabled: true,
          schedule: '',
          filter: '',
          transport: 'http',
          parser: 'syndication',
          targetUrl: 'https://example.com/feed.xml',
          xqueryLocate: '',
          xqueryEntryId: '',
          deliveryIds: ['missing-delivery'],
          deliveryOverrides: {
            'missing-delivery': '{\n  "subject": "oops"\n}',
          },
        },
        [],
      ),
    '未知 deliveryId',
  )
})

test('[unit] config workbench state: buildDeliveryPayload 遇到非法 retry statusCodes 应抛错', () => {
  const state = createDeliveryFormState({
    id: 'telegram',
    enabled: true,
    kind: 'push',
    config: {
      http: {
        url: 'https://example.com/hook',
        method: 'POST',
      },
      request: {
        type: 'body',
      },
    },
    configJson: '{}',
  })

  state.pushRetryStatusCodes = '429, foo'

  assertThrows(
    () => buildDeliveryPayload(state),
    'push.http.retry.statusCodes 必须是逗号分隔的整数列表',
  )
})

test('[unit] config workbench state: buildDeliveryPayload 遇到非法 email.smtp.port 应抛错', () => {
  const state = createDeliveryFormState({
    id: 'mailer',
    enabled: true,
    kind: 'email',
    config: {
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        security: 'starttls',
      },
      message: {
        from: 'noreply@example.com',
        to: ['ops@example.com'],
        subject: 'hello',
        text: 'body',
      },
    },
    configJson: '{}',
  })

  state.emailSmtpPort = '587x'

  assertThrows(() => buildDeliveryPayload(state), 'email.smtp.port 必须是整数')
})
