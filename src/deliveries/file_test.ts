import { assert, assertEquals, assertMatch, assertStringIncludes } from '@std/assert'
import { emptyDir, ensureDir } from '@std/fs'
import { join } from '@std/path'
import { withOwnedRuntime } from '../test_runtime.ts'
import { createLogger } from '../core/logger.ts'
import { createFileDelivery } from './file.ts'

const TEST_RUNTIME = join(Deno.cwd(), '.tmp', 'runtime-file-pusher')

const registerTest = Deno.test

function test(name: string, fn: () => Promise<void> | void): void {
  registerTest(name, async () => {
    await withOwnedRuntime(TEST_RUNTIME, async () => {
      await fn()
    })
  })
}

test('fileDelivery: 相对路径按 runtime_dir 输出', async () => {
  await emptyDir(TEST_RUNTIME)
  await ensureDir(TEST_RUNTIME)

  const pusher = createFileDelivery({ runtimeDir: TEST_RUNTIME })
  await pusher.push({ path: 'source.md', content: 'hello world' })

  const out = await Deno.readTextFile(join(TEST_RUNTIME, 'source.md'))
  assertStringIncludes(out, 'hello world')
})

test('fileDelivery: 绝对路径应直接使用', async () => {
  await emptyDir(TEST_RUNTIME)
  await ensureDir(TEST_RUNTIME)

  const pusher = createFileDelivery({ runtimeDir: TEST_RUNTIME })
  const absolutePath = join(TEST_RUNTIME, 'absolute', 'source.md')
  await pusher.push({ path: absolutePath, content: 'hello absolute' })

  const out = await Deno.readTextFile(absolutePath)
  assertStringIncludes(out, 'hello absolute')
})

test('fileDelivery: 轮转文件名按字典序可反映时间先后', async () => {
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
  for await (const entry of Deno.readDir(TEST_RUNTIME)) {
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

test('fileDelivery: size 达到阈值时应触发 rotation', async () => {
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
  for await (const entry of Deno.readDir(TEST_RUNTIME)) {
    names.push(entry.name)
  }

  assert(names.includes('rotate-size.md'))
  assert(names.some((name) => /^rotate-size\.\d{8}T\d{9}Z\.md$/.test(name)))

  const current = await Deno.readTextFile(join(TEST_RUNTIME, 'rotate-size.md'))
  assertStringIncludes(current, 'second-content')
})

test('fileDelivery: age 达到阈值时应触发 rotation', async () => {
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
  await Deno.utime(currentPath, twoHoursAgo, twoHoursAgo)

  await pusher.push({
    path: 'rotate-age.md',
    content: 'second-age-content',
    rotation: { enabled: true, age: '1h', backups: 2 },
  })

  const names: string[] = []
  for await (const entry of Deno.readDir(TEST_RUNTIME)) {
    names.push(entry.name)
  }

  assert(names.includes('rotate-age.md'))
  assert(names.some((name) => /^rotate-age\.\d{8}T\d{9}Z\.md$/.test(name)))
})

test('fileDelivery: backups 超限时应清理最老轮转文件', async () => {
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
  for await (const entry of Deno.readDir(TEST_RUNTIME)) {
    names.push(entry.name)
  }

  const rotated = names.filter((name) => /^rotate-backups\.\d{8}T\d{9}Z\.md$/.test(name))
  assertEquals(rotated.length, 1)
})

test('fileDelivery: 触发 rotation 时应以 debug 记录检查、触发、清理，并以 info 记录写入日志', async () => {
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
        attributes.operation === 'rotation_check'
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
        attributes.operation === 'rotate_file' &&
        attributes.outcome === 'success'
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
        attributes.operation === 'prune_backups' &&
        attributes.outcome === 'success'
      )
    }),
    true,
  )
  assertEquals(
    output.some(
      (item) => ((item.attributes ?? {}) as Record<string, unknown>).rotation_enabled === true,
    ),
    true,
  )
  assertEquals(
    output.some(
      (item) => ((item.attributes ?? {}) as Record<string, unknown>).rotation_reason === 'size',
    ),
    true,
  )
  assertEquals(
    output.some(
      (item) =>
        item.severityText === 'DEBUG' &&
        typeof ((item.attributes ?? {}) as Record<string, unknown>).rotated_path === 'string',
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
        attributes.operation === 'push' &&
        attributes.outcome === 'success'
      )
    }),
    true,
  )
})
