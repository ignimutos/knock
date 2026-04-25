import { assertEquals, assertThrows } from '@std/assert'

const moduleUrl = new URL('./container_entrypoint.ts', import.meta.url)

Deno.test('[contract] container entrypoint: 空参数应默认收敛为 web 模式', async () => {
  const { normalizeAppArgs } = await import(`${moduleUrl.href}?default-web`)
  assertEquals(normalizeAppArgs([]), ['--mode', 'web'])
})

Deno.test('[contract] container entrypoint: deno task start 应被改写为应用参数', async () => {
  const { normalizeAppArgs } = await import(`${moduleUrl.href}?task-start`)
  assertEquals(normalizeAppArgs(['deno', 'task', 'start', '--mode', 'daemon']), [
    '--mode',
    'daemon',
  ])
})

Deno.test('[contract] container entrypoint: 非法 KNOCK_IMMEDIATE 应报错', async () => {
  const { shouldEnableImmediate } = await import(`${moduleUrl.href}?invalid-immediate`)
  const previous = Deno.env.get('KNOCK_IMMEDIATE')
  Deno.env.set('KNOCK_IMMEDIATE', 'maybe')

  try {
    assertThrows(() => shouldEnableImmediate(), Error, 'KNOCK_IMMEDIATE 非法: maybe')
  } finally {
    if (previous === undefined) {
      Deno.env.delete('KNOCK_IMMEDIATE')
    } else {
      Deno.env.set('KNOCK_IMMEDIATE', previous)
    }
  }
})

Deno.test('[contract] container entrypoint: 显式 daemon immediate 应在当前进程内返回', async () => {
  const { runContainerEntrypoint } = await import(`${moduleUrl.href}?daemon-immediate`)
  const previousRuntimeDir = Deno.env.get('KNOCK_RUNTIME_DIR')
  const runtimeDir = await Deno.makeTempDir({ prefix: 'knock-container-entrypoint-' })
  await Deno.writeTextFile(new URL(`file://${runtimeDir}/config.yml`), 'sources: {}\n')
  Deno.env.set('KNOCK_RUNTIME_DIR', runtimeDir)

  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    const result = await Promise.race([
      runContainerEntrypoint(['--mode', 'daemon', '--immediate']).then(() => 'done'),
      new Promise<'timeout'>((resolve) => {
        timeoutId = setTimeout(() => resolve('timeout'), 2000)
      }),
    ])
    assertEquals(result, 'done')
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
    if (previousRuntimeDir === undefined) {
      Deno.env.delete('KNOCK_RUNTIME_DIR')
    } else {
      Deno.env.set('KNOCK_RUNTIME_DIR', previousRuntimeDir)
    }
    await Deno.remove(runtimeDir, { recursive: true })
  }
})
