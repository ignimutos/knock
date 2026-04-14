import { assertEquals } from '@std/assert'
import { createLogger } from './logger.ts'
import { createScheduler } from './scheduler.ts'

Deno.test('[contract] R05 scheduler: 同一 source 不允许重入', async () => {
  let running = 0
  let maxRunning = 0

  const scheduler = createScheduler()

  const run = () =>
    scheduler.runSource('s1', async () => {
      running += 1
      maxRunning = Math.max(maxRunning, running)
      await new Promise((resolve) => setTimeout(resolve, 30))
      running -= 1
    })

  await Promise.all([run(), run(), run()])
  assertEquals(maxRunning, 1)
})

Deno.test('[contract] R05 scheduler: 首次执行结束后允许同一 source 再次执行', async () => {
  const scheduler = createScheduler()
  let runCount = 0

  await scheduler.runSource('s1', () => {
    runCount += 1
    return Promise.resolve()
  })

  await scheduler.runSource('s1', () => {
    runCount += 1
    return Promise.resolve()
  })

  assertEquals(runCount, 2)
})

Deno.test('[contract] R05 scheduler: 重入跳过时应记录结构化日志', async () => {
  const logs: string[] = []
  const logger = createLogger({
    enabled: true,
    level: 'info',
    module: 'scheduler.source',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStdout: (line: string) => logs.push(line),
    writeWarn: (line: string) => logs.push(line),
  })
  const scheduler = createScheduler(logger)

  const release = Promise.withResolvers<void>()
  const firstRun = scheduler.runSource('s1', async () => {
    await release.promise
  })

  await scheduler.runSource('s1', () => {
    throw new Error('should not run')
  })

  release.resolve()
  await firstRun

  assertEquals(logs.length, 1)
  const record = JSON.parse(logs[0]) as Record<string, unknown>
  const scope = (record.scope ?? {}) as Record<string, unknown>
  const attributes = (record.attributes ?? {}) as Record<string, unknown>
  assertEquals(scope.name, 'scheduler.source')
  assertEquals(attributes.operation, 'run_source')
  assertEquals(attributes.outcome, 'skipped')
  assertEquals(attributes.reason, 'reentry_inflight')
  assertEquals(attributes['source.id'], 's1')
})
