import { assertEquals, assertThrows } from './testing/assert.ts'
import type { StartDaemonProcessOptions as StartAppOptions } from './bootstrap/start_daemon_process.ts'
import { dispatchCliCommand, main } from './bootstrap/dispatch_cli_command.ts'
import {
  parseCliCommand,
  resolveDaemonStartOptions,
  toDaemonStartOptions,
} from './bootstrap/parse_cli_command.ts'
import { test } from './testing/test_api.ts'

test('[contract] parseCliCommand: 应解析 --config、--runtime_dir 与 --immediate', () => {
  const command = parseCliCommand([
    '--config',
    '/tmp/config.yml',
    '--runtime_dir',
    '/tmp/runtime',
    '--immediate',
  ])

  assertEquals(command, {
    kind: 'daemon',
    configPath: '/tmp/config.yml',
    runtimeDir: '/tmp/runtime',
    immediate: true,
    once: false,
  })
})

test('[contract] parseCliCommand: 未知参数时应报错', () => {
  assertThrows(() => parseCliCommand(['--unknown']), Error, '未知参数: --unknown')
})

test('[contract] parseCliCommand: --config 缺少值时应报错', () => {
  assertThrows(() => parseCliCommand(['--config']), Error, '--config 缺少路径参数')
})

test('[contract] parseCliCommand: --runtime_dir 缺少值时应报错', () => {
  assertThrows(() => parseCliCommand(['--runtime_dir']), Error, '--runtime_dir 缺少目录参数')
})

test('[contract] parseCliCommand: 未传任何参数时应默认为 daemon', () => {
  assertEquals(parseCliCommand([]), {
    kind: 'daemon',
    configPath: undefined,
    runtimeDir: undefined,
    immediate: false,
    once: false,
  })
})

test('[contract] parseCliCommand: 未传 --immediate 时应显式返回 immediate=false', () => {
  const command = parseCliCommand(['--config', '/tmp/config.yml'])

  assertEquals(command, {
    kind: 'daemon',
    configPath: '/tmp/config.yml',
    runtimeDir: undefined,
    immediate: false,
    once: false,
  })
})

test('[contract] parseCliCommand: 已移除的 --mode 应视为未知参数', () => {
  assertThrows(() => parseCliCommand(['--mode', 'daemon']), Error, '未知参数: --mode')
})

test('[contract] parseCliCommand: 已移除的 --web_host 应视为未知参数', () => {
  assertThrows(() => parseCliCommand(['--web_host', '127.0.0.1']), Error, '未知参数: --web_host')
})

test('[contract] parseCliCommand: 已移除的 --web_port 应视为未知参数', () => {
  assertThrows(() => parseCliCommand(['--web_port', '8080']), Error, '未知参数: --web_port')
})

test('[contract] parseCliCommand: --immediate 与 --once 不能同时使用', () => {
  assertThrows(
    () => parseCliCommand(['--immediate', '--once']),
    Error,
    '--immediate 与 --once 不能同时使用',
  )
})

test('[contract] toDaemonStartOptions: 返回值应可赋给 app 启动入口类型', () => {
  const options: StartAppOptions = toDaemonStartOptions(
    parseCliCommand(['--config', '/tmp/config.yml']),
  )

  assertEquals(options.immediate, false)
  assertEquals(options.once, false)
  assertEquals(options.configPath, '/tmp/config.yml')
})

test('[contract] toDaemonStartOptions: 应收敛为 daemon 启动参数', () => {
  const options = toDaemonStartOptions(
    parseCliCommand([
      '--config',
      '/tmp/config.yml',
      '--runtime_dir',
      '/tmp/runtime',
      '--immediate',
    ]),
  )

  assertEquals(options, {
    configPath: '/tmp/config.yml',
    runtimeDir: '/tmp/runtime',
    immediate: true,
    once: false,
  })
})

test('[contract] toDaemonStartOptions: --once 应收敛为 once=true', () => {
  assertEquals(toDaemonStartOptions(parseCliCommand(['--once'])), {
    configPath: undefined,
    runtimeDir: undefined,
    immediate: false,
    once: true,
  })
})

test('[contract] resolveDaemonStartOptions: CLI 显式 runtime_dir 应优先于环境变量', () => {
  const options = resolveDaemonStartOptions(
    parseCliCommand(['--config', '/tmp/config.yml', '--runtime_dir', '/tmp/runtime']),
    {
      KNOCK_RUNTIME_DIR: '/tmp/runtime-from-env',
    },
  )

  assertEquals(options, {
    configPath: '/tmp/config.yml',
    runtimeDir: '/tmp/runtime',
    immediate: false,
    once: false,
  })
})

test('[contract] resolveDaemonStartOptions: 未传 runtime_dir 时应回退到环境变量', () => {
  const options = resolveDaemonStartOptions(parseCliCommand(['--config', '/tmp/config.yml']), {
    KNOCK_RUNTIME_DIR: '/tmp/runtime-from-env',
  })

  assertEquals(options, {
    configPath: '/tmp/config.yml',
    runtimeDir: '/tmp/runtime-from-env',
    immediate: false,
    once: false,
  })
})

test('[contract] dispatchCliCommand: 应通过 command object 分发 daemon 入口', async () => {
  const calls: unknown[] = []

  await dispatchCliCommand(
    {
      kind: 'daemon',
      configPath: '/tmp/config.yml',
      immediate: false,
      once: false,
    },
    {
      dispatchStartupCommand: async (command) => {
        calls.push(command)
      },
    },
  )

  assertEquals(calls, [
    {
      kind: 'daemon',
      configPath: '/tmp/config.yml',
      immediate: false,
      once: false,
    },
  ])
})

test('[contract] dispatchCliCommand: daemon 命令应委托 startup orchestrator', async () => {
  const calls: string[] = []

  await dispatchCliCommand(
    {
      kind: 'daemon',
      configPath: '/tmp/config.yml',
      runtimeDir: '/tmp/runtime',
      immediate: true,
      once: false,
    },
    {
      dispatchStartupCommand: async () => {
        calls.push('startup')
      },
    },
  )

  assertEquals(calls, ['startup'])
})

test('[contract] main: 通过 main(args) 应走同一 dispatch 路径', async () => {
  const calls: string[] = []

  await main(['--once'], {
    dispatchStartupCommand: async (command) => {
      calls.push(command.kind)
    },
  })

  assertEquals(calls, ['daemon'])
})
