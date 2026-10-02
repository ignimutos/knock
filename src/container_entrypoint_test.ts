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

test('[contract] container entrypoint: 空参数应保留 CLI 默认参数', async () => {
  const { normalizeAppArgs } = await import(`${moduleUrl.href}?default`)
  assertEquals(normalizeAppArgs([]), [])
})

test('[contract] container entrypoint: bun run start 应被改写为应用参数', async () => {
  const { normalizeAppArgs } = await import(`${moduleUrl.href}?task-start`)
  assertEquals(normalizeAppArgs(['bun', 'run', 'start', '--config', '/app/runtime/config.yml']), [
    '--config',
    '/app/runtime/config.yml',
  ])
})

test('[contract] container entrypoint: 非法 KNOCK_IMMEDIATE 应报错', async () => {
  const { shouldEnableImmediate } = await import(`${moduleUrl.href}?invalid-immediate`)
  assertThrows(() => shouldEnableImmediate('maybe'), Error, 'KNOCK_IMMEDIATE 非法: maybe')
})

test('[contract] container entrypoint: 非法 KNOCK_ONCE 应报错', async () => {
  const { shouldEnableOnce } = await import(`${moduleUrl.href}?invalid-once`)
  assertThrows(() => shouldEnableOnce('maybe'), Error, 'KNOCK_ONCE 非法: maybe')
})

test('[contract] container entrypoint: KNOCK_CONFIG_PATH 应注入 CLI --config', async () => {
  const { applyContainerDefaults } = await import(`${moduleUrl.href}?config-inject`)
  assertEquals(applyContainerDefaults([], { KNOCK_CONFIG_PATH: '/app/runtime/config.yml' }), [
    '--config',
    '/app/runtime/config.yml',
  ])
})

test('[contract] container entrypoint: 显式 CLI --config 应优先于 KNOCK_CONFIG_PATH', async () => {
  const { applyContainerDefaults } = await import(`${moduleUrl.href}?config-priority`)
  assertEquals(
    applyContainerDefaults(['--config', '/custom.yml'], {
      KNOCK_CONFIG_PATH: '/app/runtime/config.yml',
    }),
    ['--config', '/custom.yml'],
  )
})

test('[contract] container entrypoint: KNOCK_ONCE 应注入 CLI --once', async () => {
  const { applyContainerDefaults } = await import(`${moduleUrl.href}?once-inject`)
  assertEquals(applyContainerDefaults([], { KNOCK_ONCE: '1' }), ['--once'])
})

test('[contract] container entrypoint: KNOCK_IMMEDIATE 应注入 CLI --immediate', async () => {
  const { applyContainerDefaults } = await import(`${moduleUrl.href}?immediate-inject`)
  assertEquals(applyContainerDefaults([], { KNOCK_IMMEDIATE: '1' }), ['--immediate'])
})

test('[contract] container entrypoint: 标准化参数后应委托 main', async () => {
  const { runContainerEntrypoint } = await import(`${moduleUrl.href}?delegate-main`)
  const calls: string[][] = []

  await runContainerEntrypoint(['bun', 'run', 'start', '--config', '/app/runtime/config.yml'], {
    main: async (args: string[]) => {
      calls.push(args)
    },
  })

  assertEquals(calls, [['--config', '/app/runtime/config.yml']])
})

test('[contract] container entrypoint: CLI --once 应覆盖 env KNOCK_IMMEDIATE', async () => {
  const { runContainerEntrypoint } = await import(
    `${moduleUrl.href}?cli-once-overrides-env-immediate`
  )
  const calls: string[][] = []

  await withEnv({ KNOCK_IMMEDIATE: '1' }, async () => {
    await runContainerEntrypoint(['--once'], {
      main: async (args: string[]) => {
        calls.push(args)
      },
    })
  })

  assertEquals(calls, [['--once']])
})

test('[contract] container entrypoint: CLI --immediate 应覆盖 env KNOCK_ONCE', async () => {
  const { runContainerEntrypoint } = await import(
    `${moduleUrl.href}?cli-immediate-overrides-env-once`
  )
  const calls: string[][] = []

  await withEnv({ KNOCK_ONCE: '1' }, async () => {
    await runContainerEntrypoint(['--immediate'], {
      main: async (args: string[]) => {
        calls.push(args)
      },
    })
  })

  assertEquals(calls, [['--immediate']])
})

test('[contract] container entrypoint: 显式 daemon once 应在当前进程内返回', async () => {
  const { runContainerEntrypoint } = await import(`${moduleUrl.href}?daemon-once`)

  await withRuntimeHarness(async ({ runtimeDir }) => {
    await writeRuntimeFile(runtimeDir, 'config.yml', 'sources: {}\n')

    let timeoutId: ReturnType<typeof setTimeout> | undefined

    try {
      const result = await withEnv({ KNOCK_RUNTIME_DIR: runtimeDir }, async () => {
        return await Promise.race([
          runContainerEntrypoint(['--once']).then(() => 'done'),
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

  const entrypointPromise = runContainerEntrypoint(['--immediate'], {
    main: async (args: string[]) => {
      calls.push(args)
      await mainPromise
    },
  })

  await Promise.resolve()
  assertEquals(calls, [['--immediate']])

  if (resolveMain === undefined) {
    throw new Error('main resolve 未初始化')
  }
  resolveMain()

  await entrypointPromise
})
