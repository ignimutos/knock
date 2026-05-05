import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertStringIncludes,
} from '../testing/assert.ts'
import { emptyDir, ensureDir } from '../testing/fs.ts'
import { utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { createLogger } from '../core/logger.ts'
import { cwd, readDir, readTextFile } from '../platform/fs.ts'
import { withOwnedRuntime } from '../test_runtime.ts'
import { test as repoTest } from '../testing/test_api.ts'
import { createFileDelivery } from './file.ts'

const TEST_RUNTIME = join(cwd(), '.tmp', 'runtime-file-pusher')

function test(name: string, fn: () => Promise<void> | void): void {
  repoTest(name, async () => {
    await withOwnedRuntime(TEST_RUNTIME, async () => {
      await fn()
    })
  })
}

test('[unit] fileDelivery: 相对路径按 runtime_dir 输出', async () => {
  await emptyDir(TEST_RUNTIME)
  await ensureDir(TEST_RUNTIME)

  const pusher = createFileDelivery({ runtimeDir: TEST_RUNTIME })
  await pusher.push({ path: 'source.md', content: 'hello world' })

  const out = await readTextFile(join(TEST_RUNTIME, 'source.md'))
  assertStringIncludes(out, 'hello world')
})

test('[unit] fileDelivery: 绝对路径应直接使用', async () => {
  await emptyDir(TEST_RUNTIME)
  await ensureDir(TEST_RUNTIME)

  const pusher = createFileDelivery({ runtimeDir: TEST_RUNTIME })
  const absolutePath = join(TEST_RUNTIME, 'absolute', 'source.md')
  await pusher.push({ path: absolutePath, content: 'hello absolute' })

  const out = await readTextFile(absolutePath)
  assertStringIncludes(out, 'hello absolute')
})

test('[contract] fileDelivery: 轮转文件名按字典序可反映时间先后', async () => {
  await emptyDir(TEST_RUNTIME)
  await ensureDir(TEST_RUNTIME)

  const pusher = createFileDelivery({ runtimeDir: TEST_RUNTIME })
  const path = 'rotate-order.md'

  await pusher.push({
    path,
    content: 'v1',
    rotation: { enabled: true, size: '1b', backups: 2 },
  })
  await new Promise((resolve) => setTimeout(resolve, 2))
  await pusher.push({
    path,
    content: 'v2',
    rotation: { enabled: true, size: '1b', backups: 2 },
  })
  await new Promise((resolve) => setTimeout(resolve, 2))
  await pusher.push({
    path,
    content: 'v3',
    rotation: { enabled: true, size: '1b', backups: 2 },
  })

  const rotated: string[] = []
  for (const entry of await readDir(TEST_RUNTIME)) {
    if (/^rotate-order\.\d{8}T\d{9}Z\.md$/.test(entry.name)) {
      rotated.push(entry.name)
    }
  }

  assertEquals(rotated.length, 2)

  const sortedRotated = [...rotated].sort()
  assertMatch(sortedRotated[0], /^rotate-order\.\d{8}T\d{9}Z\.md$/)
  assertMatch(sortedRotated[1], /^rotate-order\.\d{8}T\d{9}Z\.md$/)
  assert(sortedRotated[0] < sortedRotated[1])
})

test('[flow] R09 fileDelivery: size 达到阈值时应触发 rotation', async () => {
  await emptyDir(TEST_RUNTIME)
  await ensureDir(TEST_RUNTIME)

  const pusher = createFileDelivery({ runtimeDir: TEST_RUNTIME })
  await pusher.push({
    path: 'rotate-size.md',
    content: 'first-content',
    rotation: { enabled: true, size: '10b', backups: 2 },
  })
  await pusher.push({
    path: 'rotate-size.md',
    content: 'second-content',
    rotation: { enabled: true, size: '10b', backups: 2 },
  })

  const names: string[] = []
  for (const entry of await readDir(TEST_RUNTIME)) {
    names.push(entry.name)
  }

  assert(names.includes('rotate-size.md'))
  assert(names.some((name) => /^rotate-size\.\d{8}T\d{9}Z\.md$/.test(name)))

  const current = await readTextFile(join(TEST_RUNTIME, 'rotate-size.md'))
  assertStringIncludes(current, 'second-content')
})

test('[flow] R09 fileDelivery: age 达到阈值时应触发 rotation', async () => {
  await emptyDir(TEST_RUNTIME)
  await ensureDir(TEST_RUNTIME)

  const pusher = createFileDelivery({ runtimeDir: TEST_RUNTIME })
  const currentPath = join(TEST_RUNTIME, 'rotate-age.md')

  await pusher.push({
    path: 'rotate-age.md',
    content: 'first-age-content',
    rotation: { enabled: true, age: '1h', backups: 2 },
  })

  const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000)
  await utimes(currentPath, twoHoursAgo, twoHoursAgo)

  await pusher.push({
    path: 'rotate-age.md',
    content: 'second-age-content',
    rotation: { enabled: true, age: '1h', backups: 2 },
  })

  const names: string[] = []
  for (const entry of await readDir(TEST_RUNTIME)) {
    names.push(entry.name)
  }

  assert(names.includes('rotate-age.md'))
  assert(names.some((name) => /^rotate-age\.\d{8}T\d{9}Z\.md$/.test(name)))
})

test('[flow] R09 fileDelivery: backups 超限时应清理最老轮转文件', async () => {
  await emptyDir(TEST_RUNTIME)
  await ensureDir(TEST_RUNTIME)

  const pusher = createFileDelivery({ runtimeDir: TEST_RUNTIME })
  const path = 'rotate-backups.md'

  await pusher.push({
    path,
    content: 'v1',
    rotation: { enabled: true, size: '1b', backups: 1 },
  })
  await pusher.push({
    path,
    content: 'v2',
    rotation: { enabled: true, size: '1b', backups: 1 },
  })
  await pusher.push({
    path,
    content: 'v3',
    rotation: { enabled: true, size: '1b', backups: 1 },
  })

  const names: string[] = []
  for (const entry of await readDir(TEST_RUNTIME)) {
    names.push(entry.name)
  }

  const rotated = names.filter((name) => /^rotate-backups\.\d{8}T\d{9}Z\.md$/.test(name))
  assertEquals(rotated.length, 1)
})

test('[contract] fileDelivery: 触发 rotation 时应以 debug 记录检查、触发、清理，并以 info 记录写入日志', async () => {
  await emptyDir(TEST_RUNTIME)
  await ensureDir(TEST_RUNTIME)

  const logs: string[] = []
  const logger = createLogger({
    enabled: true,
    level: 'debug',
    module: 'delivery.file',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStdout: (line: string) => logs.push(line),
    writeWarn: (line: string) => logs.push(line),
    writeStderr: (line: string) => logs.push(line),
  })
  const pusher = createFileDelivery({ runtimeDir: TEST_RUNTIME, logger })

  await pusher.push({
    path: 'rotate-logs.md',
    content: 'v1',
    rotation: { enabled: true, size: '1b', backups: 1 },
  })
  await pusher.push({
    path: 'rotate-logs.md',
    content: 'v2',
    rotation: { enabled: true, size: '1b', backups: 1 },
  })
  await pusher.push({
    path: 'rotate-logs.md',
    content: 'v3',
    rotation: { enabled: true, size: '1b', backups: 1 },
  })

  const output = logs.map((line) => JSON.parse(line) as Record<string, unknown>)
  assertEquals(
    output.some((item) => {
      const scope = (item.scope ?? {}) as Record<string, unknown>
      const attributes = (item.attributes ?? {}) as Record<string, unknown>
      return (
        item.severityText === 'DEBUG' &&
        scope.name === 'delivery.file' &&
        attributes['delivery.operation'] === 'rotation_check'
      )
    }),
    true,
  )
  assertEquals(
    output.some((item) => {
      const scope = (item.scope ?? {}) as Record<string, unknown>
      const attributes = (item.attributes ?? {}) as Record<string, unknown>
      return (
        item.severityText === 'DEBUG' &&
        scope.name === 'delivery.file' &&
        attributes['delivery.operation'] === 'rotate_file' &&
        attributes['delivery.outcome'] === 'success'
      )
    }),
    true,
  )
  assertEquals(
    output.some((item) => {
      const scope = (item.scope ?? {}) as Record<string, unknown>
      const attributes = (item.attributes ?? {}) as Record<string, unknown>
      return (
        item.severityText === 'DEBUG' &&
        scope.name === 'delivery.file' &&
        attributes['delivery.operation'] === 'prune_backups' &&
        attributes['delivery.outcome'] === 'success'
      )
    }),
    true,
  )
  assertEquals(
    output.some(
      (item) =>
        ((item.attributes ?? {}) as Record<string, unknown>)['delivery.rotation_enabled'] === true,
    ),
    true,
  )
  assertEquals(
    output.some(
      (item) =>
        ((item.attributes ?? {}) as Record<string, unknown>)['delivery.rotation_reason'] === 'size',
    ),
    true,
  )
  assertEquals(
    output.some(
      (item) =>
        item.severityText === 'DEBUG' &&
        typeof ((item.attributes ?? {}) as Record<string, unknown>)['delivery.rotated_path'] ===
          'string',
    ),
    true,
  )
  assertEquals(
    output.some((item) => {
      const scope = (item.scope ?? {}) as Record<string, unknown>
      const attributes = (item.attributes ?? {}) as Record<string, unknown>
      return (
        item.severityText === 'INFO' &&
        scope.name === 'delivery.file' &&
        attributes['delivery.operation'] === 'push' &&
        attributes['delivery.outcome'] === 'success'
      )
    }),
    true,
  )
})

test('[flow] R09 fileDelivery: rotation 失败时也应记录 failure 日志并抛错', async () => {
  await emptyDir(TEST_RUNTIME)
  await ensureDir(TEST_RUNTIME)

  const logs: string[] = []
  const logger = createLogger({
    enabled: true,
    level: 'debug',
    module: 'delivery.file',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStdout: (line: string) => logs.push(line),
    writeWarn: (line: string) => logs.push(line),
    writeStderr: (line: string) => logs.push(line),
  })
  const pusher = createFileDelivery({ runtimeDir: TEST_RUNTIME, logger })
  const fixedNow = new Date('2026-04-28T12:34:56.789Z')
  const realDate = Date
  const rotatedPath = join(TEST_RUNTIME, 'rotate-failure.20260428T123456789Z.md')

  class FixedDate extends Date {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super(fixedNow.getTime())
        return
      }

      if (args.length === 1) {
        const value = args[0]
        super(value instanceof realDate ? value.getTime() : (value as string | number))
        return
      }

      super(
        args[0] as number,
        args[1] as number,
        args[2] as number | undefined,
        args[3] as number | undefined,
        args[4] as number | undefined,
        args[5] as number | undefined,
        args[6] as number | undefined,
      )
    }

    static override now(): number {
      return fixedNow.getTime()
    }

    static override parse(value: string): number {
      return realDate.parse(value)
    }

    static override UTC(...args: Parameters<typeof Date.UTC>): number {
      return realDate.UTC(...args)
    }
  }

  try {
    await pusher.push({
      path: 'rotate-failure.md',
      content: 'v1',
      rotation: { enabled: true, size: '1b', backups: 1 },
    })
    await ensureDir(rotatedPath)
    globalThis.Date = FixedDate as DateConstructor

    const error = await assertRejects(
      () =>
        pusher.push({
          path: 'rotate-failure.md',
          content: 'v2',
          rotation: { enabled: true, size: '1b', backups: 1 },
        }),
      Error,
    )

    const output = logs.map((line) => JSON.parse(line) as Record<string, unknown>)
    const failureLog = output.find((item) => {
      const scope = (item.scope ?? {}) as Record<string, unknown>
      const attributes = (item.attributes ?? {}) as Record<string, unknown>
      return (
        item.severityText === 'ERROR' &&
        scope.name === 'delivery.file' &&
        attributes['delivery.operation'] === 'push' &&
        attributes['delivery.outcome'] === 'failure'
      )
    })
    const failureAttributes = (failureLog?.attributes ?? {}) as Record<string, unknown>
    assertEquals(Boolean(failureLog), true)
    assertEquals(failureAttributes['exception.message'], error.message)
    assertEquals(failureAttributes['delivery.rotation_enabled'], true)
    assertEquals(failureAttributes['delivery.path'], join(TEST_RUNTIME, 'rotate-failure.md'))
  } finally {
    globalThis.Date = realDate
  }
})

test('[flow] R09 fileDelivery: 写入失败时应记录 failure 日志并抛错', async () => {
  await emptyDir(TEST_RUNTIME)
  await ensureDir(TEST_RUNTIME)

  const logs: string[] = []
  const logger = createLogger({
    enabled: true,
    level: 'info',
    module: 'delivery.file',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStdout: (line: string) => logs.push(line),
    writeWarn: (line: string) => logs.push(line),
    writeStderr: (line: string) => logs.push(line),
  })
  const pusher = createFileDelivery({ runtimeDir: TEST_RUNTIME, logger })
  const targetPath = join(TEST_RUNTIME, 'write-failure')
  await ensureDir(targetPath)

  const error = await assertRejects(
    () =>
      pusher.push({
        path: targetPath,
        content: 'hello failure',
      }),
    Error,
  )

  const output = logs.map((line) => JSON.parse(line) as Record<string, unknown>)
  const failureLog = output.find((item) => {
    const scope = (item.scope ?? {}) as Record<string, unknown>
    const attributes = (item.attributes ?? {}) as Record<string, unknown>
    return (
      item.severityText === 'ERROR' &&
      scope.name === 'delivery.file' &&
      attributes['delivery.operation'] === 'push' &&
      attributes['delivery.outcome'] === 'failure'
    )
  })
  const failureAttributes = (failureLog?.attributes ?? {}) as Record<string, unknown>
  assertEquals(Boolean(failureLog), true)
  assertEquals(failureAttributes['delivery.path'], targetPath)
  assertEquals(failureAttributes['exception.message'], error.message)
})
export const testMeta = [
  {
    title: '[flow] R09 fileDelivery: size 达到阈值时应触发 rotation',
    layer: 'flow',
    risks: ['R09'],
  },
  {
    title: '[flow] R09 fileDelivery: age 达到阈值时应触发 rotation',
    layer: 'flow',
    risks: ['R09'],
  },
  {
    title: '[flow] R09 fileDelivery: backups 超限时应清理最老轮转文件',
    layer: 'flow',
    risks: ['R09'],
  },
  {
    title: '[flow] R09 fileDelivery: rotation 失败时也应记录 failure 日志并抛错',
    layer: 'flow',
    risks: ['R09'],
  },
  {
    title: '[flow] R09 fileDelivery: 写入失败时应记录 failure 日志并抛错',
    layer: 'flow',
    risks: ['R09'],
  },
] as const
