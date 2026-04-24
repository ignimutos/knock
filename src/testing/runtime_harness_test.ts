import { assertEquals } from '@std/assert'
import { exists } from '@std/fs'
import { join } from '@std/path'
import { createStableChildEnv, withRuntimeHarness } from './runtime_harness.ts'

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

Deno.test('runtime-harness: createStableChildEnv 应过滤宿主颜色与 CI 变量', () => {
  const originalCi = Deno.env.get('CI')
  const originalForceColor = Deno.env.get('FORCE_COLOR')
  const originalNoColor = Deno.env.get('NO_COLOR')

  Deno.env.set('CI', 'true')
  Deno.env.set('FORCE_COLOR', '1')
  Deno.env.set('NO_COLOR', '1')

  try {
    const env = createStableChildEnv({ KNOCK_RUNTIME_DIR: '/tmp/runtime' })
    assertEquals(env.KNOCK_RUNTIME_DIR, '/tmp/runtime')
    assertEquals('CI' in env, false)
    assertEquals('FORCE_COLOR' in env, false)
    assertEquals('NO_COLOR' in env, false)
  } finally {
    if (originalCi === undefined) {
      Deno.env.delete('CI')
    } else {
      Deno.env.set('CI', originalCi)
    }
    if (originalForceColor === undefined) {
      Deno.env.delete('FORCE_COLOR')
    } else {
      Deno.env.set('FORCE_COLOR', originalForceColor)
    }
    if (originalNoColor === undefined) {
      Deno.env.delete('NO_COLOR')
    } else {
      Deno.env.set('NO_COLOR', originalNoColor)
    }
  }
})
