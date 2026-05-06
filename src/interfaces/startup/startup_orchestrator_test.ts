export const testMeta = [
  {
    title: '__file__',
    layer: 'contract',
    risks: ['R03'],
  },
] as const

// layer: contract
// risk-id: R03
import { assertEquals, assertRejects } from '../../testing/assert.ts'
import { test } from '../../testing/test_api.ts'
import { dispatchStartupCommand } from './startup_orchestrator.ts'

function child(name: 'daemon' | 'web', success: boolean) {
  return {
    status: Promise.resolve({ success, code: success ? 0 : 1 }),
    kill: () => killed.push(name),
  }
}

let killed: Array<'daemon' | 'web'> = []

test('[contract] startup orchestrator: all 模式应启动 daemon 与 web 子进程', async () => {
  const spawned: string[][] = []
  killed = []
  const daemon = child('daemon', true)
  const web = child('web', true)

  await dispatchStartupCommand(
    {
      kind: 'all',
      configPath: '/tmp/config.yml',
      runtimeDir: '/tmp/runtime',
      immediate: false,
      once: false,
    },
    {
      env: { KNOCK_RUNTIME_DIR: '/tmp/runtime' },
      spawnChild: ({ args }) => {
        spawned.push(args)
        return args[1] === 'daemon' ? daemon : web
      },
      startDaemon: async () => {
        throw new Error('should not start inline')
      },
      startWeb: async () => {
        throw new Error('should not start inline')
      },
    },
  )

  assertEquals(spawned, [
    ['--mode', 'daemon', '--config', '/tmp/config.yml', '--runtime_dir', '/tmp/runtime'],
    ['--mode', 'web'],
  ])
  assertEquals(killed, [])
})

test('[contract] startup orchestrator: all+once 模式应在 daemon 成功后终止 web 并返回', async () => {
  killed = []
  const daemon = child('daemon', true)
  let resolveWebStatus: ((status: { success: boolean; code: number }) => void) | undefined
  const web = {
    status: new Promise<{ success: boolean; code: number }>((resolve) => {
      resolveWebStatus = resolve
      setTimeout(() => resolve({ success: true, code: 0 }), 50)
    }),
    kill: () => {
      killed.push('web')
      resolveWebStatus?.({ success: true, code: 0 })
    },
  }

  await dispatchStartupCommand(
    {
      kind: 'all',
      configPath: '/tmp/config.yml',
      runtimeDir: '/tmp/runtime',
      immediate: false,
      once: true,
    },
    {
      env: { KNOCK_RUNTIME_DIR: '/tmp/runtime' },
      spawnChild: ({ args }) => (args[1] === 'daemon' ? daemon : web),
    },
  )

  assertEquals(killed, ['web'])
})

test('[contract] startup orchestrator: all 模式 web 先成功退出时应终止 daemon 并返回', async () => {
  killed = []
  let resolveDaemonStatus: ((status: { success: boolean; code: number }) => void) | undefined
  const daemon = {
    status: new Promise<{ success: boolean; code: number }>((resolve) => {
      resolveDaemonStatus = resolve
      setTimeout(() => resolve({ success: true, code: 0 }), 50)
    }),
    kill: () => {
      killed.push('daemon')
      resolveDaemonStatus?.({ success: true, code: 0 })
    },
  }
  const web = child('web', true)

  await dispatchStartupCommand(
    {
      kind: 'all',
      configPath: '/tmp/config.yml',
      runtimeDir: '/tmp/runtime',
      immediate: false,
      once: false,
    },
    {
      env: { KNOCK_RUNTIME_DIR: '/tmp/runtime' },
      spawnChild: ({ args }) => (args[1] === 'daemon' ? daemon : web),
    },
  )

  assertEquals(killed, ['daemon'])
})

test('[contract] startup orchestrator: all 模式首个失败子进程应终止另一侧并抛错', async () => {
  const spawned: string[][] = []
  killed = []
  const daemon = child('daemon', false)
  const web = child('web', true)

  await assertRejects(
    () =>
      dispatchStartupCommand(
        {
          kind: 'all',
          configPath: '/tmp/config.yml',
          runtimeDir: '/tmp/runtime',
          immediate: false,
          once: false,
        },
        {
          env: { KNOCK_RUNTIME_DIR: '/tmp/runtime' },
          spawnChild: ({ args }) => {
            spawned.push(args)
            return args[1] === 'daemon' ? daemon : web
          },
        },
      ),
    Error,
    'daemon 子进程异常退出: 1',
  )

  assertEquals(spawned.length, 2)
  assertEquals(killed, ['web'])
})
