export const testMeta = [
  {
    title: '__file__',
    layer: 'contract',
    risks: ['R03'],
  },
] as const

// layer: contract
// risk-id: R03
import { assertEquals, assertThrows } from './testing/assert.ts'

import { test } from './testing/test_api.ts'
import { withEnv, withRuntimeHarness, writeRuntimeFile } from './testing/test_helpers.ts'

const moduleUrl = new URL('./container_entrypoint.ts', import.meta.url)

test('[contract] container entrypoint: 空参数应保留 CLI 默认模式', async () => {
  const { normalizeAppArgs } = await import(`${moduleUrl.href}?default-all`)
  assertEquals(normalizeAppArgs([]), [])
})

test('[contract] container entrypoint: bun run start 应被改写为应用参数', async () => {
  const { normalizeAppArgs } = await import(`${moduleUrl.href}?task-start`)
  assertEquals(normalizeAppArgs(['bun', 'run', 'start', '--mode', 'daemon']), ['--mode', 'daemon'])
})

test('[contract] container entrypoint: 非法 KNOCK_IMMEDIATE 应报错', async () => {
  const { shouldEnableImmediate } = await import(`${moduleUrl.href}?invalid-immediate`)
  assertThrows(() => shouldEnableImmediate('maybe'), Error, 'KNOCK_IMMEDIATE 非法: maybe')
})

test('[contract] container entrypoint: 非法 KNOCK_ONCE 应报错', async () => {
  const { shouldEnableOnce } = await import(`${moduleUrl.href}?invalid-once`)
  assertThrows(() => shouldEnableOnce('maybe'), Error, 'KNOCK_ONCE 非法: maybe')
})

test('[contract] container entrypoint: web 模式默认值不应把 KNOCK_CONFIG_PATH 注入为 CLI --config', async () => {
  const { applyContainerDefaults } = await import(`${moduleUrl.href}?web-defaults`)
  assertEquals(
    applyContainerDefaults(['--mode', 'web'], {
      KNOCK_CONFIG_PATH: '/app/runtime/config.yml',
      KNOCK_WEB_HOST: '0.0.0.0',
      KNOCK_WEB_PORT: '9000',
    }),
    ['--mode', 'web', '--web_host', '0.0.0.0', '--web_port', '9000'],
  )
})

test('[contract] container entrypoint: web 模式不应从 KNOCK_IMMEDIATE 注入 CLI --immediate', async () => {
  const { applyContainerDefaults } = await import(`${moduleUrl.href}?web-ignore-immediate`)
  assertEquals(applyContainerDefaults(['--mode', 'web'], { KNOCK_IMMEDIATE: '1' }), [
    '--mode',
    'web',
  ])
})

test('[contract] container entrypoint: daemon 模式应从 KNOCK_ONCE 注入 CLI --once', async () => {
  const { applyContainerDefaults } = await import(`${moduleUrl.href}?daemon-inject-once`)
  assertEquals(applyContainerDefaults(['--mode', 'daemon'], { KNOCK_ONCE: '1' }), [
    '--mode',
    'daemon',
    '--once',
  ])
})

test('[contract] container entrypoint: web 模式不应从 KNOCK_ONCE 注入 CLI --once', async () => {
  const { applyContainerDefaults } = await import(`${moduleUrl.href}?web-ignore-once`)
  assertEquals(applyContainerDefaults(['--mode', 'web'], { KNOCK_ONCE: '1' }), ['--mode', 'web'])
})

test('[contract] container entrypoint: 空参数默认值应同时保留 daemon config 与 web host/port 注入', async () => {
  const { applyContainerDefaults } = await import(`${moduleUrl.href}?all-defaults`)
  assertEquals(
    applyContainerDefaults([], {
      KNOCK_CONFIG_PATH: '/app/runtime/config.yml',
      KNOCK_WEB_HOST: '0.0.0.0',
      KNOCK_WEB_PORT: '9000',
    }),
    ['--config', '/app/runtime/config.yml', '--web_host', '0.0.0.0', '--web_port', '9000'],
  )
})

test('[contract] container entrypoint: daemon 模式仍应从 KNOCK_CONFIG_PATH 注入 CLI --config', async () => {
  const { applyContainerDefaults } = await import(`${moduleUrl.href}?daemon-defaults`)
  assertEquals(
    applyContainerDefaults(['--mode', 'daemon'], {
      KNOCK_CONFIG_PATH: '/app/runtime/config.yml',
    }),
    ['--mode', 'daemon', '--config', '/app/runtime/config.yml'],
  )
})

test('[contract] container entrypoint: 标准化参数后应委托 main', async () => {
  const { runContainerEntrypoint } = await import(`${moduleUrl.href}?delegate-main`)
  const calls: string[][] = []

  await runContainerEntrypoint(['bun', 'run', 'start', '--mode', 'daemon'], {
    main: async (args: string[]) => {
      calls.push(args)
    },
  })

  assertEquals(calls, [['--mode', 'daemon']])
})

test('[contract] container entrypoint: CLI --once 应覆盖 env KNOCK_IMMEDIATE', async () => {
  const { runContainerEntrypoint } = await import(
    `${moduleUrl.href}?cli-once-overrides-env-immediate`
  )
  const calls: string[][] = []

  await withEnv({ KNOCK_IMMEDIATE: '1' }, async () => {
    await runContainerEntrypoint(['--mode', 'daemon', '--once'], {
      main: async (args: string[]) => {
        calls.push(args)
      },
    })
  })

  assertEquals(calls, [['--mode', 'daemon', '--once']])
})

test('[contract] container entrypoint: CLI --immediate 应覆盖 env KNOCK_ONCE', async () => {
  const { runContainerEntrypoint } = await import(
    `${moduleUrl.href}?cli-immediate-overrides-env-once`
  )
  const calls: string[][] = []

  await withEnv({ KNOCK_ONCE: '1' }, async () => {
    await runContainerEntrypoint(['--mode', 'daemon', '--immediate'], {
      main: async (args: string[]) => {
        calls.push(args)
      },
    })
  })

  assertEquals(calls, [['--mode', 'daemon', '--immediate']])
})

test('[contract] container entrypoint: 显式 daemon once 应在当前进程内返回', async () => {
  const { runContainerEntrypoint } = await import(`${moduleUrl.href}?daemon-once`)

  await withRuntimeHarness(async ({ runtimeDir }) => {
    await writeRuntimeFile(runtimeDir, 'config.yml', 'sources: {}\n')

    let timeoutId: ReturnType<typeof setTimeout> | undefined

    try {
      const result = await withEnv({ KNOCK_RUNTIME_DIR: runtimeDir }, async () => {
        return await Promise.race([
          runContainerEntrypoint(['--mode', 'daemon', '--once']).then(() => 'done'),
          new Promise<'timeout'>((resolve) => {
            timeoutId = setTimeout(() => resolve('timeout'), 2000)
          }),
        ])
      })
      assertEquals(result, 'done')
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
    }
  })
})

test('[contract] container entrypoint: 显式 daemon immediate 应透传参数给 main 且在 main 完成前保持 pending', async () => {
  const { runContainerEntrypoint } = await import(`${moduleUrl.href}?daemon-immediate`)

  const calls: string[][] = []
  let resolveMain: (() => void) | undefined
  const mainPromise = new Promise<void>((resolve) => {
    resolveMain = resolve
  })

  const entrypointPromise = runContainerEntrypoint(['--mode', 'daemon', '--immediate'], {
    main: async (args: string[]) => {
      calls.push(args)
      await mainPromise
    },
  })

  await Promise.resolve()
  assertEquals(calls, [['--mode', 'daemon', '--immediate']])

  if (resolveMain === undefined) {
    throw new Error('main resolve 未初始化')
  }
  resolveMain()

  await entrypointPromise
})
