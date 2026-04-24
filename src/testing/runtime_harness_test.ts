import { assertEquals } from '@std/assert'
import { exists } from '@std/fs'
import { join } from '@std/path'
import { withRuntimeHarness } from './runtime_harness.ts'

Deno.test('runtime-harness: 应自动 prepare 与 cleanup', async () => {
  let runtimeDirFromRun = ''

  await withRuntimeHarness(async ({ runtimeDir }) => {
    runtimeDirFromRun = runtimeDir
    assertEquals(await exists(runtimeDir), true)
    await Deno.writeTextFile(join(runtimeDir, 'probe.txt'), 'ok')
  })

  assertEquals(runtimeDirFromRun.length > 0, true)
  assertEquals(await exists(runtimeDirFromRun), false)
})

Deno.test('runtime-harness: 兼容传入 runtimeDir 的旧调用形式', async () => {
  const runtimeDir = join(Deno.cwd(), '.tmp', 'runtime-harness-compat')
  const stalePath = join(runtimeDir, 'stale.txt')

  await Deno.mkdir(runtimeDir, { recursive: true })
  await Deno.writeTextFile(stalePath, 'stale')

  await withRuntimeHarness(runtimeDir, async (ownedRuntimeDir) => {
    assertEquals(ownedRuntimeDir, runtimeDir)
    assertEquals(await exists(stalePath), false)
    assertEquals(await exists(runtimeDir), true)
  })

  assertEquals(await exists(runtimeDir), false)
})
