import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import type { StartAppOptions } from './core/app.ts'
import {
  buildChildArgs,
  parseCliArgs,
  resolveDaemonStartOptions,
  toDaemonStartOptions,
} from './main.ts'

async function readCommandOutput(
  stream: ReadableStream<Uint8Array> | null,
  timeoutMs: number,
): Promise<string> {
  if (!stream) return ''

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ''

  try {
    const result = await Promise.race([
      (async () => {
        while (true) {
          const { done, value } = await reader.read()
          if (done) return output
          output += decoder.decode(value, { stream: true })
        }
      })(),
      new Promise<string>((resolve) => setTimeout(() => resolve(output), timeoutMs)),
    ])

    return result
  } finally {
    try {
      await reader.cancel()
    } catch {
      // noop
    }
  }
}

Deno.test('[contract] parseCliArgs: 应解析 --config、--runtime_dir 与 --immediate', () => {
  const options = parseCliArgs([
    '--config',
    '/tmp/config.yml',
    '--runtime_dir',
    '/tmp/runtime',
    '--immediate',
  ])

  assertEquals(options, {
    mode: 'all',
    configPath: '/tmp/config.yml',
    runtimeDir: '/tmp/runtime',
    immediate: true,
    webHost: undefined,
    webPort: undefined,
  })
})

Deno.test('[contract] parseCliArgs: 未知参数时应报错', () => {
  assertThrows(() => parseCliArgs(['--unknown']), Error, '未知参数: --unknown')
})

Deno.test('[contract] parseCliArgs: --config 缺少值时应报错', () => {
  assertThrows(() => parseCliArgs(['--config']), Error, '--config 缺少路径参数')
})

Deno.test('[contract] parseCliArgs: --runtime_dir 缺少值时应报错', () => {
  assertThrows(() => parseCliArgs(['--runtime_dir']), Error, '--runtime_dir 缺少目录参数')
})

Deno.test('[contract] parseCliArgs: --mode 缺少值时应报错', () => {
  assertThrows(() => parseCliArgs(['--mode']), Error, '--mode 缺少参数')
})

Deno.test('[contract] parseCliArgs: --web_host 缺少值时应报错', () => {
  assertThrows(() => parseCliArgs(['--web_host']), Error, '--web_host 缺少参数')
})

Deno.test('[contract] parseCliArgs: --web_port 缺少值时应报错', () => {
  assertThrows(() => parseCliArgs(['--web_port']), Error, '--web_port 缺少参数')
})

Deno.test('[contract] parseCliArgs: 未传 --immediate 时应显式返回 immediate=false', () => {
  const options = parseCliArgs(['--config', '/tmp/config.yml'])

  assertEquals(options, {
    mode: 'all',
    configPath: '/tmp/config.yml',
    runtimeDir: undefined,
    immediate: false,
    webHost: undefined,
    webPort: undefined,
  })
})

Deno.test('[contract] parseCliArgs: 返回值应可赋给 app 启动入口类型', () => {
  const options: StartAppOptions = parseCliArgs(['--config', '/tmp/config.yml'])

  assertEquals(options.immediate, false)
  assertEquals(options.configPath, '/tmp/config.yml')
})

Deno.test('[contract] toDaemonStartOptions: 应收敛为 daemon 启动参数', () => {
  const options = toDaemonStartOptions(
    parseCliArgs(['--config', '/tmp/config.yml', '--runtime_dir', '/tmp/runtime', '--immediate']),
  )

  assertEquals(options, {
    configPath: '/tmp/config.yml',
    runtimeDir: '/tmp/runtime',
    immediate: true,
  })
})

Deno.test('[contract] toDaemonStartOptions: 返回值应可赋给 app 启动入口类型', () => {
  const options: StartAppOptions = toDaemonStartOptions(
    parseCliArgs(['--config', '/tmp/config.yml']),
  )

  assertEquals(options.immediate, false)
  assertEquals(options.configPath, '/tmp/config.yml')
})

Deno.test('[contract] resolveDaemonStartOptions: CLI 显式 runtime_dir 应优先于环境变量', () => {
  const options = resolveDaemonStartOptions(
    parseCliArgs([
      '--mode',
      'daemon',
      '--config',
      '/tmp/config.yml',
      '--runtime_dir',
      '/tmp/runtime',
    ]),
    {
      KNOCK_RUNTIME_DIR: '/tmp/runtime-from-env',
    },
  )

  assertEquals(options, {
    configPath: '/tmp/config.yml',
    runtimeDir: '/tmp/runtime',
    immediate: false,
  })
})

Deno.test('[contract] resolveDaemonStartOptions: 未传 runtime_dir 时应回退到环境变量', () => {
  const options = resolveDaemonStartOptions(
    parseCliArgs(['--mode', 'daemon', '--config', '/tmp/config.yml']),
    {
      KNOCK_RUNTIME_DIR: '/tmp/runtime-from-env',
    },
  )

  assertEquals(options, {
    configPath: '/tmp/config.yml',
    runtimeDir: '/tmp/runtime-from-env',
    immediate: false,
  })
})

Deno.test('[contract] parseCliArgs: 应解析 mode=web 与 web 参数', () => {
  const options = parseCliArgs(['--mode', 'web', '--web_host', '127.0.0.1', '--web_port', '8080'])

  assertEquals(options, {
    mode: 'web',
    configPath: undefined,
    runtimeDir: undefined,
    immediate: false,
    webHost: '127.0.0.1',
    webPort: 8080,
  })
})

Deno.test('[contract] parseCliArgs: start 默认 mode=all', () => {
  assertEquals(parseCliArgs([]).mode, 'all')
})

Deno.test('[contract] parseCliArgs: web 模式不接受 --config', () => {
  assertThrows(
    () => parseCliArgs(['--mode', 'web', '--config', 'runtime/config.yml']),
    Error,
    'web 模式不支持 --config',
  )
})

Deno.test('[contract] parseCliArgs: web 模式不接受 --runtime_dir', () => {
  assertThrows(
    () => parseCliArgs(['--mode', 'web', '--runtime_dir', '/tmp/runtime']),
    Error,
    'web 模式不支持 --runtime_dir',
  )
})

Deno.test('[contract] parseCliArgs: web 模式不接受 --immediate', () => {
  assertThrows(
    () => parseCliArgs(['--mode', 'web', '--immediate']),
    Error,
    'web 模式不支持 --immediate',
  )
})

Deno.test('[contract] parseCliArgs: daemon 模式不接受 --web_host', () => {
  assertThrows(
    () => parseCliArgs(['--mode', 'daemon', '--web_host', '127.0.0.1']),
    Error,
    'daemon 模式不支持 --web_host',
  )
})

Deno.test('[contract] parseCliArgs: daemon 模式不接受 --web_port', () => {
  assertThrows(
    () => parseCliArgs(['--mode', 'daemon', '--web_port', '8080']),
    Error,
    'daemon 模式不支持 --web_port',
  )
})

Deno.test('[contract] parseCliArgs: --mode 非法值时应报错', () => {
  assertThrows(() => parseCliArgs(['--mode', 'oops']), Error, '--mode 非法: oops')
})

Deno.test('[contract] parseCliArgs: --web_port 非数字时应报错', () => {
  assertThrows(() => parseCliArgs(['--mode', 'web', '--web_port', 'abc']), Error, '--web_port 非法')
})

Deno.test('[contract] parseCliArgs: --web_port 小数时应报错', () => {
  assertThrows(
    () => parseCliArgs(['--mode', 'web', '--web_port', '8080.5']),
    Error,
    '--web_port 非法',
  )
})

Deno.test('[contract] parseCliArgs: --web_port 空白时应报错', () => {
  assertThrows(() => parseCliArgs(['--mode', 'web', '--web_port', '  ']), Error, '--web_port 非法')
})

Deno.test('[contract] parseCliArgs: --web_port 越界时应报错', () => {
  assertThrows(
    () => parseCliArgs(['--mode', 'web', '--web_port', '70000']),
    Error,
    '--web_port 非法',
  )
})

Deno.test('[contract] parseCliArgs: --web_port 为 0 时应报错', () => {
  assertThrows(() => parseCliArgs(['--mode', 'web', '--web_port', '0']), Error, '--web_port 非法')
})

Deno.test('[contract] parseCliArgs: --web_port 最小边界 1 应通过', () => {
  const options = parseCliArgs(['--mode', 'web', '--web_port', '1'])
  assertEquals(options.webPort, 1)
})

Deno.test('[contract] parseCliArgs: --web_port 最大边界 65535 应通过', () => {
  const options = parseCliArgs(['--mode', 'web', '--web_port', '65535'])
  assertEquals(options.webPort, 65535)
})

Deno.test('[contract] parseCliArgs: daemon 模式下 --web_host 空字符串也应报互斥错误', () => {
  assertThrows(
    () => parseCliArgs(['--mode', 'daemon', '--web_host', '']),
    Error,
    'daemon 模式不支持 --web_host',
  )
})

Deno.test('[contract] parseCliArgs: web 模式下 --config 空字符串也应报互斥错误', () => {
  assertThrows(
    () => parseCliArgs(['--mode', 'web', '--config', '']),
    Error,
    'web 模式不支持 --config',
  )
})

Deno.test('[contract] buildChildArgs: all 模式参数可分发到 daemon 子进程', () => {
  const parsed = parseCliArgs([
    '--config',
    'runtime/config.yml',
    '--runtime_dir',
    'runtime',
    '--immediate',
    '--web_host',
    '127.0.0.1',
    '--web_port',
    '8080',
  ])

  assertEquals(buildChildArgs(parsed, 'daemon'), [
    'run',
    '--allow-read',
    '--allow-write',
    '--allow-env',
    '--allow-net',
    '--allow-ffi',
    '--allow-run',
    'src/main.ts',
    '--mode',
    'daemon',
    '--config',
    'runtime/config.yml',
    '--runtime_dir',
    'runtime',
    '--immediate',
  ])
})

Deno.test('[contract] buildChildArgs: all 模式参数可分发到 web 子进程', () => {
  const parsed = parseCliArgs([
    '--config',
    'runtime/config.yml',
    '--web_host',
    '127.0.0.1',
    '--web_port',
    '8080',
  ])

  assertEquals(buildChildArgs(parsed, 'web'), [
    'run',
    '--allow-read',
    '--allow-write',
    '--allow-env',
    '--allow-net',
    '--allow-ffi',
    '--allow-run',
    'src/main.ts',
    '--mode',
    'web',
    '--web_host',
    '127.0.0.1',
    '--web_port',
    '8080',
  ])
})

Deno.test(
  '[contract] startWeb: web startup logger 应走共享 sink 配置而非硬编码 format',
  async () => {
    const source = await Deno.readTextFile(new URL('./main.ts', import.meta.url))
    assertEquals(source.includes("format: 'json'"), false)
  },
)

Deno.test('[contract] startWeb: 启动时应输出包含 host、port 与 url 的结构化日志', async () => {
  const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  const { port } = listener.addr as Deno.NetAddr
  listener.close()

  const child = new Deno.Command(Deno.execPath(), {
    args: [
      'run',
      '--allow-read',
      '--allow-write',
      '--allow-env',
      '--allow-net',
      '--allow-ffi',
      '--allow-run',
      'src/main.ts',
      '--mode',
      'web',
      '--web_host',
      '127.0.0.1',
      '--web_port',
      String(port),
    ],
    cwd: Deno.cwd(),
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()

  try {
    const output = await readCommandOutput(child.stdout, 3000)

    assertStringIncludes(output, '"web.host":"127.0.0.1"')
    assertStringIncludes(output, `"web.port":${port}`)
    assertStringIncludes(output, `"web.url":"http://127.0.0.1:${port}/"`)
  } finally {
    try {
      child.kill('SIGTERM')
    } catch {
      // noop
    }
    try {
      await child.stdout?.cancel()
    } catch {
      // noop
    }
    try {
      await child.stderr?.cancel()
    } catch {
      // noop
    }
    await child.status
  }
})
