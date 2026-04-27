import { assertEquals } from '@std/assert'
import { createLogger } from '../../core/logger.ts'
import type { DeliveryAttemptPlan } from '../ports/delivery_executor.ts'
import { DeliveryStage } from './delivery_stage.ts'
import { test } from '../../testing/test_api.ts'

// risk-id: R07
// layer: unit

function createPlan(): DeliveryAttemptPlan {
  return {
    attemptId: 'attempt-1',
    sourceRunId: 'run-1',
    itemId: 'item-1',
    deliveryId: 'telegram',
    effectDomain: 'production',
    channel: 'push',
    plannedAt: '2026-04-13T10:20:00.000Z',
    renderedSnapshot: {
      channel: 'push',
      payload: {
        text: 'hello',
      },
    },
  }
}

test('[unit] deliveryStage: 成功结果应生成 attempt 终态时间', async () => {
  const seenPlans: DeliveryAttemptPlan[] = []
  const stage = new DeliveryStage({
    now: (() => {
      const values = ['2026-04-13T10:20:01.000Z', '2026-04-13T10:20:02.000Z']
      return () => values.shift() ?? '2026-04-13T10:20:02.000Z'
    })(),
    executor: {
      execute: (plan) => {
        seenPlans.push(plan)
        return Promise.resolve()
      },
    },
  })

  const result = await stage.run(createPlan())

  assertEquals(seenPlans.length, 1)
  assertEquals(result.status, 'delivered')
  assertEquals(result.startedAt, '2026-04-13T10:20:01.000Z')
  assertEquals(result.finishedAt, '2026-04-13T10:20:02.000Z')
})

test('[unit] deliveryStage: 失败细节应主归属 attempt', async () => {
  const stage = new DeliveryStage({
    now: (() => {
      const values = ['2026-04-13T10:21:01.000Z', '2026-04-13T10:21:02.000Z']
      return () => values.shift() ?? '2026-04-13T10:21:02.000Z'
    })(),
    executor: {
      execute: () => Promise.reject(new Error('telegram 500')),
    },
  })

  const result = await stage.run(createPlan())

  assertEquals(result.status, 'failed')
  assertEquals(result.reason, 'telegram 500')
  assertEquals(result.startedAt, '2026-04-13T10:21:01.000Z')
  assertEquals(result.finishedAt, '2026-04-13T10:21:02.000Z')
})

test('[unit] deliveryStage: success 日志应落 delivery.runtime.dispatch 且仅含调度键', async () => {
  const stdout: string[] = []
  const logger = createLogger({
    enabled: true,
    level: 'info',
    module: 'delivery.runtime.dispatch',
    now: () => new Date('2026-04-13T10:22:00.000Z'),
    writeStdout: (line: string) => stdout.push(line),
    writeWarn: () => {},
    writeStderr: () => {},
  })

  const deps = {
    now: (() => {
      const values = ['2026-04-13T10:22:01.000Z', '2026-04-13T10:22:02.000Z']
      return () => values.shift() ?? '2026-04-13T10:22:02.000Z'
    })(),
    executor: {
      execute: () => Promise.resolve(),
    },
    logger,
  }

  await new DeliveryStage(deps).run(createPlan())

  assertEquals(stdout.length, 1)
  const record = JSON.parse(stdout[0]!) as Record<string, unknown>
  const scope = (record.scope ?? {}) as Record<string, unknown>
  const attributes = (record.attributes ?? {}) as Record<string, unknown>
  assertEquals(scope.name, 'delivery.runtime.dispatch')
  assertEquals(attributes['delivery.operation'], 'dispatch')
  assertEquals(attributes['delivery.outcome'], 'success')
  assertEquals(attributes['delivery.id'], 'telegram')
  assertEquals(attributes['pipeline.item_id'], 'item-1')
  assertEquals(attributes['payload'], undefined)
})

test('[unit] deliveryStage: failure 日志应包含标准错误字段并保持 payload-free', async () => {
  const stderr: string[] = []
  const logger = createLogger({
    enabled: true,
    level: 'info',
    module: 'delivery.runtime.dispatch',
    now: () => new Date('2026-04-13T10:23:00.000Z'),
    writeStdout: () => {},
    writeWarn: () => {},
    writeStderr: (line: string) => stderr.push(line),
  })

  const deps = {
    now: (() => {
      const values = ['2026-04-13T10:23:01.000Z', '2026-04-13T10:23:02.000Z']
      return () => values.shift() ?? '2026-04-13T10:23:02.000Z'
    })(),
    executor: {
      execute: () => Promise.reject(new Error('telegram 500')),
    },
    logger,
  }

  await new DeliveryStage(deps).run(createPlan())

  assertEquals(stderr.length, 1)
  const record = JSON.parse(stderr[0]!) as Record<string, unknown>
  const scope = (record.scope ?? {}) as Record<string, unknown>
  const attributes = (record.attributes ?? {}) as Record<string, unknown>
  assertEquals(scope.name, 'delivery.runtime.dispatch')
  assertEquals(attributes['delivery.operation'], 'dispatch')
  assertEquals(attributes['delivery.outcome'], 'failure')
  assertEquals(attributes['delivery.id'], 'telegram')
  assertEquals(attributes['pipeline.item_id'], 'item-1')
  assertEquals(attributes['exception.type'], 'DeliveryDispatchError')
  assertEquals(attributes['exception.message'], 'delivery dispatch failed')
  assertEquals(attributes['payload'], undefined)
})

test('[unit] deliveryStage: failure 日志应使用稳定安全异常摘要且不泄漏敏感片段', async () => {
  const stderr: string[] = []
  const logger = createLogger({
    enabled: true,
    level: 'info',
    module: 'delivery.runtime.dispatch',
    now: () => new Date('2026-04-13T10:24:00.000Z'),
    writeStdout: () => {},
    writeWarn: () => {},
    writeStderr: (line: string) => stderr.push(line),
  })

  const sensitiveFragment = 'rendered body: {"text":"secret-token-123"}'
  const deps = {
    now: (() => {
      const values = ['2026-04-13T10:24:01.000Z', '2026-04-13T10:24:02.000Z']
      return () => values.shift() ?? '2026-04-13T10:24:02.000Z'
    })(),
    executor: {
      execute: () => Promise.reject(new Error(`telegram 500 ${sensitiveFragment}`)),
    },
    logger,
  }

  await new DeliveryStage(deps).run(createPlan())

  assertEquals(stderr.length, 1)
  assertEquals(stderr[0]?.includes(sensitiveFragment), false)
  const record = JSON.parse(stderr[0]!) as Record<string, unknown>
  const attributes = (record.attributes ?? {}) as Record<string, unknown>
  assertEquals(attributes['delivery.operation'], 'dispatch')
  assertEquals(attributes['delivery.outcome'], 'failure')
  assertEquals(attributes['delivery.id'], 'telegram')
  assertEquals(attributes['pipeline.item_id'], 'item-1')
  assertEquals(attributes['exception.type'], 'DeliveryDispatchError')
  assertEquals(attributes['exception.message'], 'delivery dispatch failed')
  assertEquals(attributes['exception.stacktrace'], undefined)
})
