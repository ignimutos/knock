import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertStringIncludes,
  assertThrows,
} from '@std/assert'
import { emptyDir, ensureDir } from '@std/fs'
import { dirname, fromFileUrl, join } from '@std/path'
import { loadConfig } from '../config/load_config.ts'
import type { AppConfigResolved } from '../config/types.ts'
import { buildDefinitionsConfigFixture } from '../interfaces/config/definitions_test_fixture.ts'
import { withOwnedRuntime } from '../test_runtime.ts'
import { compileDefinitionsFromResolvedConfig } from './compile_definitions.ts'

const PROJECT_ROOT = dirname(dirname(dirname(fromFileUrl(import.meta.url))))
const TEST_RUNTIME = join(PROJECT_ROOT, '.tmp', 'runtime-compile-definitions')

const registerTest = Deno.test

function test(name: string, fn: () => Promise<void> | void): void {
  registerTest(name, async () => {
    await withOwnedRuntime(TEST_RUNTIME, async () => {
      await fn()
    })
  })
}

test('[contract] compileDefinitions: 应从 resolved config 生成单一 DefinitionSet', async () => {
  await emptyDir(TEST_RUNTIME)
  await ensureDir(TEST_RUNTIME)

  await Deno.writeTextFile(join(TEST_RUNTIME, 'config.yml'), buildDefinitionsConfigFixture())

  const config = await loadConfig({ runtimeDir: TEST_RUNTIME })
  const definitionSet = compileDefinitionsFromResolvedConfig(config)

  const fetchSource = definitionSet.sources.find((item) => item.sourceId === 'rust')
  const summarySource = definitionSet.sources.find((item) => item.sourceId === 'digest')
  const fileDelivery = definitionSet.deliveries.find((item) => item.deliveryId === 'archive')
  const pushDelivery = definitionSet.deliveries.find((item) => item.deliveryId === 'webhook')
  const emailDelivery = definitionSet.deliveries.find((item) => item.deliveryId === 'mailer')
  const rustArchiveBinding = definitionSet.bindings.find(
    (item) => item.sourceId === 'rust' && item.deliveryId === 'archive',
  )
  const rustWebhookBinding = definitionSet.bindings.find(
    (item) => item.sourceId === 'rust' && item.deliveryId === 'webhook',
  )

  assertEquals(fetchSource?.kind, 'fetch')
  assertEquals(summarySource?.kind, 'summary')
  assertEquals(fileDelivery?.kind, 'file')
  assertEquals(pushDelivery?.kind, 'push')
  assertEquals(emailDelivery?.kind, 'email')

  assertExists(rustArchiveBinding)
  assertExists(rustWebhookBinding)
  assertEquals('profile' in rustArchiveBinding, false)
  assertEquals('effectDomain' in rustArchiveBinding, false)
  assertEquals('trigger' in rustArchiveBinding, false)

  if (fileDelivery?.kind !== 'file' || rustArchiveBinding.definition.kind !== 'file') {
    throw new Error('archive delivery 应为 file')
  }
  assertEquals(fileDelivery.contentTemplate, '{{ entry.title }}')
  assertEquals(rustArchiveBinding.definition.contentTemplate, 'override {{ entry.id }}')
  assertNotEquals(rustArchiveBinding.definition, fileDelivery)

  if (pushDelivery?.kind !== 'push' || rustWebhookBinding.definition.kind !== 'push') {
    throw new Error('webhook delivery 应为 push')
  }
  assertEquals(pushDelivery.requestType, 'form')
  assertEquals(pushDelivery.payloadTemplate, { text: '{{ entry.title }}' })
  assertEquals(rustWebhookBinding.definition.payloadTemplate, {
    text: 'override {{ entry.id }}',
  })

  assertEquals(definitionSet.policies.preview, {
    persistFacts: false,
    writeDedupe: false,
    allowExternalSideEffects: false,
    exposeToRecovery: false,
    exposeToPrune: false,
  })
  assertEquals(definitionSet.policies.production, {
    persistFacts: true,
    writeDedupe: true,
    allowExternalSideEffects: true,
    exposeToRecovery: true,
    exposeToPrune: true,
  })
})

test('[contract] compileDefinitions: unsupported delivery 应抛出防御性错误', () => {
  const config = {
    runtimeDir: TEST_RUNTIME,
    language: 'zh-CN',
    timezone: 'UTC',
    timestampFormat: 'yyyy-MM-dd HH:mm:ss',
    sqlite: {
      path: join(TEST_RUNTIME, 'facts.db'),
      busyTimeout: '5s',
      journalMode: 'wal',
      retention: {
        maxEntries: 100,
        maxAge: '30d',
        vacuumMode: 'auto',
      },
    },
    deliveries: [
      {
        id: 'broken',
      },
    ],
    sources: [
      {
        id: 'rust',
        enabled: true,
        schedule: '* * * * *',
        http: {
          url: 'https://example.com/feed.xml',
        },
        syndication: {},
        deliveries: [],
      },
    ],
    logging: {
      level: 'info',
      sinks: {
        console: {
          type: 'console',
          format: 'pretty',
        },
      },
    },
  } as unknown as AppConfigResolved

  const error = assertThrows(() => compileDefinitionsFromResolvedConfig(config), Error)
  assertStringIncludes(error.message, 'delivery broken 缺少可装配的定义类型')
})
