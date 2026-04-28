import { assertEquals } from './assert.ts'
import { exists } from './fs.ts'
import { join } from 'node:path'
import { cwd, mkdirPath, writeTextFile } from '../platform/fs.ts'
import { withRuntimeHarness } from './runtime_harness.ts'
import { test } from './test_api.ts'

test('runtime-harness: 应自动 prepare 与 cleanup', async () => {
  let runtimeDirFromRun = ''

  await withRuntimeHarness(async ({ runtimeDir }) => {
    runtimeDirFromRun = runtimeDir
    assertEquals(await exists(runtimeDir), true)
    await writeTextFile(join(runtimeDir, 'probe.txt'), 'ok')
  })

  assertEquals(runtimeDirFromRun.length > 0, true)
  assertEquals(await exists(runtimeDirFromRun), false)
})

test('runtime-harness: 兼容传入 runtimeDir 的旧调用形式', async () => {
  const runtimeDir = join(cwd(), '.tmp', 'runtime-harness-compat')
  const stalePath = join(runtimeDir, 'stale.txt')

  await mkdirPath(runtimeDir, { recursive: true })
  await writeTextFile(stalePath, 'stale')

  await withRuntimeHarness(runtimeDir, async (ownedRuntimeDir) => {
    assertEquals(ownedRuntimeDir, runtimeDir)
    assertEquals(await exists(stalePath), false)
    assertEquals(await exists(runtimeDir), true)
  })

  assertEquals(await exists(runtimeDir), false)
})
