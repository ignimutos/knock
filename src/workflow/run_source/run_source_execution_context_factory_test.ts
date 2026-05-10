import { assertRejects, assertEquals } from '../../testing/assert.ts'
import { test } from '../../testing/test_api.ts'
import { RunSourceExecutionContextFactory } from './run_source_execution_context_factory.ts'
import type { RunSourceUseCaseDeps } from './run_source_execution_types.ts'

// layer: unit

function createBaseDeps(): RunSourceUseCaseDeps {
  return {
    now: () => '2026-04-13T12:00:00.000Z',
    createRunId: () => 'run-1',
    sourceInputGateway: {
      fetch: () => Promise.reject(new Error('unused')),
    },
    sourceParser: {
      parse: () => Promise.reject(new Error('unused')),
    },
  }
}

test('[unit] runSourceExecutionContextFactory: 缺 execute 依赖时应 fail fast', async () => {
  const factory = new RunSourceExecutionContextFactory(createBaseDeps())

  await assertRejects(
    () => Promise.resolve(factory.create()),
    Error,
    'run source execute 缺少完整 pipeline 依赖',
  )
})

test('[unit] runSourceExecutionContextFactory: 应提供默认 createAttemptId 与基础内容渲染能力', async () => {
  const factory = new RunSourceExecutionContextFactory({
    ...createBaseDeps(),
    runRepository: {
      insert: () => Promise.resolve(),
      update: () => Promise.resolve(),
    },
    itemRepository: {
      insertMany: () => Promise.resolve(),
      updateStatus: () => Promise.resolve(),
    },
    deliveryAttemptRepository: {
      insertPlanned: () => Promise.resolve(),
      finish: () => Promise.resolve(),
    },
    deduplicationRepository: {
      isItemDuplicate: () => Promise.resolve(false),
      registerItemFingerprint: () => Promise.resolve(),
      isDeliveryDuplicate: () => Promise.resolve(false),
      registerDeliveryFingerprint: () => Promise.resolve(),
    },
    deliveryExecutors: {},
  })

  const context = factory.create()

  assertEquals(
    context.createItemId({
      id: 'entry-1',
      title: 'Hello',
      link: '',
      description: '',
      content: '',
      published: '',
      updated: '',
    }),
    'run-1:entry-1',
  )
  assertEquals(
    context.createAttemptId({
      sourceRunId: 'run-1',
      itemId: 'item-1',
      deliveryId: 'archive',
    }),
    'run-1:item-1:archive',
  )
  assertEquals(
    await context.renderContent('{{ entry.title }}', { entry: { title: 'Hello' } }),
    'Hello',
  )
  assertEquals(
    await context.renderContent('{{ entry.title | upcase }}', { entry: { title: 'Hello' } }),
    'HELLO',
  )
  assertEquals(
    await context.renderPayload({ text: '{{ entry.title }}' }, { entry: { title: 'Hello' } }),
    {
      text: 'Hello',
    },
  )
})
