import { assertEquals, assertExists, assertNotEquals } from '@std/assert'
import { emptyDir, ensureDir } from '@std/fs'
import { dirname, fromFileUrl, join } from '@std/path'
import { withOwnedRuntime } from '../../test_runtime.ts'
import { buildDefinitionsConfigFixture } from './definitions_test_fixture.ts'
import { loadDefinitions } from './load_definitions.ts'

const PROJECT_ROOT = dirname(dirname(dirname(dirname(fromFileUrl(import.meta.url)))))
const TEST_RUNTIME = join(PROJECT_ROOT, '.tmp', 'runtime-load-definitions')

const registerTest = Deno.test

function test(name: string, fn: () => Promise<void> | void): void {
  registerTest(name, async () => {
    await withOwnedRuntime(TEST_RUNTIME, async () => {
      await fn()
    })
  })
}

test('[contract] loadDefinitions: 应将 resolved config 组装成判别联合 SourceDefinition 与 DeliveryBinding', async () => {
  await emptyDir(TEST_RUNTIME)
  await ensureDir(TEST_RUNTIME)

  await Deno.writeTextFile(
    join(TEST_RUNTIME, 'config.yml'),
    buildDefinitionsConfigFixture({ includePushRequestVariants: true }),
  )

  const definitions = await loadDefinitions({ runtimeDir: TEST_RUNTIME })

  const fetchSource = definitions.sources.find((item) => item.sourceId === 'rust')
  const summarySource = definitions.sources.find((item) => item.sourceId === 'digest')
  const fileDelivery = definitions.deliveries.find((item) => item.deliveryId === 'archive')
  const formPushDelivery = definitions.deliveries.find((item) => item.deliveryId === 'webhook')
  const queryPushDelivery = definitions.deliveries.find((item) => item.deliveryId === 'ping')
  const defaultBodyPushDelivery = definitions.deliveries.find(
    (item) => item.deliveryId === 'default_body',
  )
  const emailDelivery = definitions.deliveries.find((item) => item.deliveryId === 'mailer')
  const rustArchiveBinding = definitions.bindings.find(
    (item) => item.sourceId === 'rust' && item.deliveryId === 'archive',
  )
  const rustMailerBinding = definitions.bindings.find(
    (item) => item.sourceId === 'rust' && item.deliveryId === 'mailer',
  )

  assertEquals(fetchSource?.kind, 'fetch')
  assertEquals(summarySource?.kind, 'summary')
  assertEquals(fileDelivery?.kind, 'file')
  assertEquals(formPushDelivery?.kind, 'push')
  assertEquals(queryPushDelivery?.kind, 'push')
  assertEquals(defaultBodyPushDelivery?.kind, 'push')
  assertEquals(emailDelivery?.kind, 'email')

  if (
    formPushDelivery?.kind !== 'push' ||
    queryPushDelivery?.kind !== 'push' ||
    defaultBodyPushDelivery?.kind !== 'push'
  ) {
    throw new Error('push delivery 应为 push')
  }
  assertEquals(formPushDelivery.requestType, 'form')
  assertEquals(queryPushDelivery.requestType, 'query')
  assertEquals(defaultBodyPushDelivery.requestType, 'body')

  assertExists(rustArchiveBinding)
  assertExists(rustMailerBinding)
  assertEquals('profile' in rustArchiveBinding, false)
  assertEquals('effectDomain' in rustArchiveBinding, false)
  assertEquals('trigger' in rustArchiveBinding, false)
  if (fileDelivery?.kind !== 'file' || rustArchiveBinding.definition.kind !== 'file') {
    throw new Error('archive delivery 应为 file')
  }
  assertEquals(fileDelivery.contentTemplate, '{{ entry.title }}')
  assertEquals(rustArchiveBinding.definition.contentTemplate, 'override {{ entry.id }}')
  assertNotEquals(rustArchiveBinding.definition, fileDelivery)

  if (emailDelivery?.kind !== 'email' || rustMailerBinding.definition.kind !== 'email') {
    throw new Error('mailer delivery 应为 email')
  }
  assertEquals(emailDelivery.messageTemplate.subject, '[{{ source.title }}] {{ entry.title }}')
  assertEquals(rustMailerBinding.definition.messageTemplate.subject, '[override] {{ entry.title }}')
})
