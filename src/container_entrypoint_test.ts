import { assertEquals, assertThrows } from '@std/assert'

const moduleUrl = new URL('./container_entrypoint.ts', import.meta.url)

Deno.test('[contract] container entrypoint: 空参数应保留 CLI 默认模式', async () => {
  const { normalizeAppArgs } = await import(`${moduleUrl.href}?default-all`)
  assertEquals(normalizeAppArgs([]), [])
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
  assertThrows(() => shouldEnableImmediate('maybe'), Error, 'KNOCK_IMMEDIATE 非法: maybe')
})

Deno.test(
  '[contract] container entrypoint: web 模式默认值不应把 KNOCK_CONFIG_PATH 注入为 CLI --config',
  async () => {
    const { applyContainerDefaults } = await import(`${moduleUrl.href}?web-defaults`)
    assertEquals(
      applyContainerDefaults(['--mode', 'web'], {
        KNOCK_CONFIG_PATH: '/app/runtime/config.yml',
        KNOCK_WEB_HOST: '0.0.0.0',
        KNOCK_WEB_PORT: '9000',
      }),
      ['--mode', 'web', '--web_host', '0.0.0.0', '--web_port', '9000'],
    )
  },
)

Deno.test(
  '[contract] container entrypoint: 空参数默认值应同时保留 daemon config 与 web host/port 注入',
  async () => {
    const { applyContainerDefaults } = await import(`${moduleUrl.href}?all-defaults`)
    assertEquals(
      applyContainerDefaults([], {
        KNOCK_CONFIG_PATH: '/app/runtime/config.yml',
        KNOCK_WEB_HOST: '0.0.0.0',
        KNOCK_WEB_PORT: '9000',
      }),
      ['--config', '/app/runtime/config.yml', '--web_host', '0.0.0.0', '--web_port', '9000'],
    )
  },
)

Deno.test(
  '[contract] container entrypoint: daemon 模式仍应从 KNOCK_CONFIG_PATH 注入 CLI --config',
  async () => {
    const { applyContainerDefaults } = await import(`${moduleUrl.href}?daemon-defaults`)
    assertEquals(
      applyContainerDefaults(['--mode', 'daemon'], {
        KNOCK_CONFIG_PATH: '/app/runtime/config.yml',
      }),
      ['--mode', 'daemon', '--config', '/app/runtime/config.yml'],
    )
  },
)

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
