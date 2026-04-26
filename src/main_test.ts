import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from '@std/assert'
import { join } from '@std/path'
import { withOwnedRuntime } from './test_runtime.ts'
import { createStableChildEnv } from './testing/runtime_harness.ts'
import type { StartAppOptions } from './main.ts'
import { dispatchCliCommand, main, startWeb } from './main.ts'
import { waitForWebReady } from './interfaces/web/start_web.ts'
import {
  buildChildArgs,
  parseCliCommand,
  resolveDaemonStartOptions,
  toDaemonStartOptions,
} from './interfaces/cli/parse_cli_command.ts'

const WEB_STARTUP_TEST_TIMEOUT_MS = 90_000

async function readCommandOutputUntil(
  stream: ReadableStream<Uint8Array> | null,
  expected: string,
  timeoutMs: number,
): Promise<string> {
  if (!stream) return ''

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ''
  const deadline = Date.now() + timeoutMs

  try {
    while (Date.now() < deadline) {
      const remaining = Math.max(0, deadline - Date.now())
      let timeoutId: number | undefined
      const chunk = await Promise.race([
        reader.read(),
        new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
          timeoutId = setTimeout(() => resolve({ done: true, value: undefined }), remaining)
        }),
      ])
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
      if (chunk.done) break
      output += decoder.decode(chunk.value, { stream: true })
      if (output.includes(expected)) {
        return output
      }
    }
    return output
  } finally {
    try {
      await reader.cancel()
    } catch {
      // noop
    }
  }
}

async function readStartupOutput(
  child: Deno.ChildProcess,
  port: number,
  timeoutMs: number,
): Promise<string> {
  const expected = `Web 服务开始监听 http://127.0.0.1:${port}/`
  const output = await readCommandOutputUntil(child.stdout, expected, timeoutMs)
  assertStringIncludes(output, expected)
  return output
}

Deno.test('[contract] parseCliCommand: 应解析 --config、--runtime_dir 与 --immediate', () => {
  const command = parseCliCommand([
    '--config',
    '/tmp/config.yml',
    '--runtime_dir',
    '/tmp/runtime',
    '--immediate',
  ])

  assertEquals(command, {
    kind: 'all',
    configPath: '/tmp/config.yml',
    runtimeDir: '/tmp/runtime',
    immediate: true,
    host: undefined,
    port: undefined,
  })
})

Deno.test('[contract] parseCliCommand: 未知参数时应报错', () => {
  assertThrows(() => parseCliCommand(['--unknown']), Error, '未知参数: --unknown')
})

Deno.test('[contract] parseCliCommand: --config 缺少值时应报错', () => {
  assertThrows(() => parseCliCommand(['--config']), Error, '--config 缺少路径参数')
})

Deno.test('[contract] parseCliCommand: --runtime_dir 缺少值时应报错', () => {
  assertThrows(() => parseCliCommand(['--runtime_dir']), Error, '--runtime_dir 缺少目录参数')
})

Deno.test('[contract] parseCliCommand: --mode 缺少值时应报错', () => {
  assertThrows(() => parseCliCommand(['--mode']), Error, '--mode 缺少参数')
})

Deno.test('[contract] parseCliCommand: --web_host 缺少值时应报错', () => {
  assertThrows(() => parseCliCommand(['--web_host']), Error, '--web_host 缺少参数')
})

Deno.test('[contract] parseCliCommand: --web_port 缺少值时应报错', () => {
  assertThrows(() => parseCliCommand(['--web_port']), Error, '--web_port 缺少参数')
})

Deno.test('[contract] parseCliCommand: 未传 --immediate 时应显式返回 immediate=false', () => {
  const command = parseCliCommand(['--config', '/tmp/config.yml'])

  assertEquals(command, {
    kind: 'all',
    configPath: '/tmp/config.yml',
    runtimeDir: undefined,
    immediate: false,
    host: undefined,
    port: undefined,
  })
})

Deno.test('[contract] toDaemonStartOptions: 返回值应可赋给 app 启动入口类型', () => {
  const options: StartAppOptions = toDaemonStartOptions(
    parseCliCommand(['--config', '/tmp/config.yml']),
  )

  assertEquals(options.immediate, false)
  assertEquals(options.configPath, '/tmp/config.yml')
})

Deno.test('[contract] toDaemonStartOptions: 应收敛为 daemon 启动参数', () => {
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
  })
})

Deno.test('[contract] resolveDaemonStartOptions: CLI 显式 runtime_dir 应优先于环境变量', () => {
  const options = resolveDaemonStartOptions(
    parseCliCommand([
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
    parseCliCommand(['--mode', 'daemon', '--config', '/tmp/config.yml']),
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

Deno.test('[contract] parseCliCommand: 应解析 mode=web 与 web 参数', () => {
  const command = parseCliCommand([
    '--mode',
    'web',
    '--web_host',
    '127.0.0.1',
    '--web_port',
    '8080',
  ])

  assertEquals(command, {
    kind: 'web',
    host: '127.0.0.1',
    port: 8080,
  })
})

Deno.test('[contract] parseCliCommand: start 默认 mode=all', () => {
  assertEquals(parseCliCommand([]).kind, 'all')
})

Deno.test('[contract] parseCliCommand: web 模式不接受 --config', () => {
  assertThrows(
    () => parseCliCommand(['--mode', 'web', '--config', 'runtime/config.yml']),
    Error,
    'web 模式不支持 --config',
  )
})

Deno.test('[contract] parseCliCommand: web 模式不接受 --runtime_dir', () => {
  assertThrows(
    () => parseCliCommand(['--mode', 'web', '--runtime_dir', '/tmp/runtime']),
    Error,
    'web 模式不支持 --runtime_dir',
  )
})

Deno.test('[contract] parseCliCommand: web 模式不接受 --immediate', () => {
  assertThrows(
    () => parseCliCommand(['--mode', 'web', '--immediate']),
    Error,
    'web 模式不支持 --immediate',
  )
})

Deno.test('[contract] parseCliCommand: daemon 模式不接受 --web_host', () => {
  assertThrows(
    () => parseCliCommand(['--mode', 'daemon', '--web_host', '127.0.0.1']),
    Error,
    'daemon 模式不支持 --web_host',
  )
})

Deno.test('[contract] parseCliCommand: daemon 模式不接受 --web_port', () => {
  assertThrows(
    () => parseCliCommand(['--mode', 'daemon', '--web_port', '8080']),
    Error,
    'daemon 模式不支持 --web_port',
  )
})

Deno.test('[contract] parseCliCommand: --mode 非法值时应报错', () => {
  assertThrows(() => parseCliCommand(['--mode', 'oops']), Error, '--mode 非法: oops')
})

Deno.test('[contract] parseCliCommand: --web_port 非数字时应报错', () => {
  assertThrows(
    () => parseCliCommand(['--mode', 'web', '--web_port', 'abc']),
    Error,
    '--web_port 非法',
  )
})

Deno.test('[contract] parseCliCommand: --web_port 小数时应报错', () => {
  assertThrows(
    () => parseCliCommand(['--mode', 'web', '--web_port', '8080.5']),
    Error,
    '--web_port 非法',
  )
})

Deno.test('[contract] parseCliCommand: --web_port 空白时应报错', () => {
  assertThrows(
    () => parseCliCommand(['--mode', 'web', '--web_port', '  ']),
    Error,
    '--web_port 非法',
  )
})

Deno.test('[contract] parseCliCommand: --web_port 越界时应报错', () => {
  assertThrows(
    () => parseCliCommand(['--mode', 'web', '--web_port', '70000']),
    Error,
    '--web_port 非法',
  )
})

Deno.test('[contract] parseCliCommand: --web_port 为 0 时应报错', () => {
  assertThrows(
    () => parseCliCommand(['--mode', 'web', '--web_port', '0']),
    Error,
    '--web_port 非法',
  )
})

Deno.test('[contract] parseCliCommand: --web_port 最小边界 1 应通过', () => {
  const command = parseCliCommand(['--mode', 'web', '--web_port', '1'])
  assertEquals(command.kind, 'web')
  if (command.kind !== 'web') throw new Error('unexpected command kind')
  assertEquals(command.port, 1)
})

Deno.test('[contract] parseCliCommand: --web_port 最大边界 65535 应通过', () => {
  const command = parseCliCommand(['--mode', 'web', '--web_port', '65535'])
  assertEquals(command.kind, 'web')
  if (command.kind !== 'web') throw new Error('unexpected command kind')
  assertEquals(command.port, 65535)
})

Deno.test('[contract] parseCliCommand: daemon 模式下 --web_host 空字符串也应报互斥错误', () => {
  assertThrows(
    () => parseCliCommand(['--mode', 'daemon', '--web_host', '']),
    Error,
    'daemon 模式不支持 --web_host',
  )
})

Deno.test('[contract] parseCliCommand: web 模式下 --config 空字符串也应报互斥错误', () => {
  assertThrows(
    () => parseCliCommand(['--mode', 'web', '--config', '']),
    Error,
    'web 模式不支持 --config',
  )
})

Deno.test('[contract] buildChildArgs: all 模式参数可分发到 daemon 子进程', () => {
  const command = parseCliCommand([
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

  assertEquals(buildChildArgs(command, 'daemon'), [
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
  const command = parseCliCommand([
    '--config',
    'runtime/config.yml',
    '--web_host',
    '127.0.0.1',
    '--web_port',
    '8080',
  ])

  assertEquals(buildChildArgs(command, 'web'), [
    '--mode',
    'web',
    '--web_host',
    '127.0.0.1',
    '--web_port',
    '8080',
  ])
})

Deno.test('[contract] dispatchCliCommand: 应通过 command object 分发 daemon 入口', async () => {
  const calls: StartAppOptions[] = []

  await dispatchCliCommand(
    {
      kind: 'daemon',
      configPath: '/tmp/config.yml',
      immediate: false,
    },
    {
      env: { KNOCK_RUNTIME_DIR: '/tmp/runtime-from-env' },
      startApp: (options) => {
        calls.push(options)
        return Promise.resolve({ mode: 'daemon' })
      },
    },
  )

  assertEquals(calls, [
    {
      configPath: '/tmp/config.yml',
      runtimeDir: '/tmp/runtime-from-env',
      immediate: false,
    },
  ])
})

Deno.test('[contract] main: 应通过 command object 分发入口', async () => {
  const calls: string[] = []
  const originalStartWeb = globalThis.fetch

  try {
    await dispatchCliCommand(
      parseCliCommand(['--mode', 'web', '--web_host', '127.0.0.1', '--web_port', '8080']),
      {
        startWeb: ({ host, port }) => {
          calls.push(`${host}:${port}`)
          return Promise.resolve()
        },
      },
    )
  } finally {
    globalThis.fetch = originalStartWeb
  }

  assertEquals(calls, ['127.0.0.1:8080'])
})

Deno.test('[contract] main: 通过 main(args) 应走同一 dispatch 路径', async () => {
  const calls: string[] = []

  await main([], {
    runAllModes: () => {
      calls.push('all')
      return Promise.resolve()
    },
  })

  assertEquals(calls, ['all'])
})

Deno.test('[contract] startWeb: 配置 jsonl 时应输出 JSONL 而不是 pretty', async () => {
  const originalCi = Deno.env.get('CI')
  const originalForceColor = Deno.env.get('FORCE_COLOR')
  const originalTerm = Deno.env.get('TERM')
  const originalNoColor = Deno.env.get('NO_COLOR')

  Deno.env.set('CI', 'true')
  Deno.env.set('FORCE_COLOR', '1')
  Deno.env.set('TERM', 'xterm-256color')
  Deno.env.delete('NO_COLOR')

  try {
    await withOwnedRuntime(async ({ runtimeDir }) => {
      await Deno.writeTextFile(
        join(runtimeDir, 'config.yml'),
        [
          'sources: {}',
          'logging:',
          '  level: info',
          '  sinks:',
          '    console:',
          '      type: console',
          '      format: jsonl',
        ].join('\n'),
      )

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
          '--allow-sys',
          'src/main.ts',
          '--mode',
          'web',
          '--web_host',
          '127.0.0.1',
          '--web_port',
          String(port),
        ],
        cwd: Deno.cwd(),
        env: createStableChildEnv({
          KNOCK_RUNTIME_DIR: runtimeDir,
        }),
        stdout: 'piped',
        stderr: 'piped',
      }).spawn()

      try {
        const output = await readStartupOutput(child, port, WEB_STARTUP_TEST_TIMEOUT_MS)

        assertEquals(output.includes('\u001b['), false)
        assertStringIncludes(output, '"severityText":"INFO"')
        assertStringIncludes(output, '"scope":{"name":"web.startup"}')
        assertStringIncludes(output, '"web.host":"127.0.0.1"')
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
    if (originalTerm === undefined) {
      Deno.env.delete('TERM')
    } else {
      Deno.env.set('TERM', originalTerm)
    }
    if (originalNoColor === undefined) {
      Deno.env.delete('NO_COLOR')
    } else {
      Deno.env.set('NO_COLOR', originalNoColor)
    }
  }
})

Deno.test('[contract] startWeb: 应拒绝 logging 路径中的环境变量展开', async () => {
  await withOwnedRuntime(async ({ runtimeDir }) => {
    const originalRuntimeDir = Deno.env.get('KNOCK_RUNTIME_DIR')

    await Deno.writeTextFile(
      join(runtimeDir, 'config.yml'),
      [
        'sources: {}',
        'logging:',
        '  level: info',
        '  sinks:',
        '    console:',
        '      type: console',
        '      format: ${LOG_FORMAT}',
      ].join('\n'),
    )

    Deno.env.set('KNOCK_RUNTIME_DIR', runtimeDir)

    try {
      await assertRejects(
        () => startWeb({ host: '127.0.0.1', port: 18080 }),
        Error,
        'logging.sinks.console.format 不支持环境变量展开',
      )
    } finally {
      if (originalRuntimeDir === undefined) {
        Deno.env.delete('KNOCK_RUNTIME_DIR')
      } else {
        Deno.env.set('KNOCK_RUNTIME_DIR', originalRuntimeDir)
      }
    }
  })
})

Deno.test('[contract] startWeb: 启动时应输出 pretty 单行并包含 host、port 与 url', async () => {
  await withOwnedRuntime(async ({ runtimeDir }) => {
    await Deno.writeTextFile(
      join(runtimeDir, 'config.yml'),
      [
        'deliveries:',
        '  telegram:',
        '    enabled: false',
        '    push:',
        '      http:',
        '        url: https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage',
        '      request:',
        '        payload:',
        '          chat_id: ${TELEGRAM_CHAT_ID}',
        '          text: hello',
        'sources: {}',
        'logging:',
        '  level: info',
        '  sinks:',
        '    console:',
        '      type: console',
        '      format: pretty',
      ].join('\n'),
    )

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
        '--allow-sys',
        'src/main.ts',
        '--mode',
        'web',
        '--web_host',
        '127.0.0.1',
        '--web_port',
        String(port),
      ],
      cwd: Deno.cwd(),
      env: createStableChildEnv({
        KNOCK_RUNTIME_DIR: runtimeDir,
      }),
      stdout: 'piped',
      stderr: 'piped',
    }).spawn()

    try {
      const output = await readStartupOutput(child, port, WEB_STARTUP_TEST_TIMEOUT_MS)

      assertStringIncludes(output, '\u001b[')
      assertStringIncludes(output, 'info')
      assertStringIncludes(output, 'startup')
      assertStringIncludes(output, `Web 服务开始监听 http://127.0.0.1:${port}/`)
      assertEquals(output.includes('"web.host"'), false)
      assertEquals(output.includes('TELEGRAM_BOT_TOKEN'), false)
      assertEquals(output.includes('TELEGRAM_CHAT_ID'), false)
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
})

Deno.test(
  '[contract] startWeb: 配置存在但 sqlite 不可用时应 fail fast 而不是假装启动成功',
  async () => {
    await withOwnedRuntime(async ({ runtimeDir }) => {
      await Deno.writeTextFile(
        join(runtimeDir, 'config.yml'),
        ['sqlite:', '  path: db/knock.db', 'sources: {}'].join('\n'),
      )
      await Deno.writeTextFile(join(runtimeDir, 'db'), 'not-a-directory')

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
          '--allow-sys',
          'src/main.ts',
          '--mode',
          'web',
          '--web_host',
          '127.0.0.1',
          '--web_port',
          String(port),
        ],
        cwd: Deno.cwd(),
        env: createStableChildEnv({
          KNOCK_RUNTIME_DIR: runtimeDir,
        }),
        stdout: 'piped',
        stderr: 'piped',
      }).spawn()

      try {
        const stderr = await readCommandOutputUntil(child.stderr, 'Web 启动前检查失败:', 10_000)
        assertStringIncludes(stderr, 'Web 启动前检查失败:')
        const status = await child.status
        assertEquals(status.success, false)
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
        await child.status.catch(() => undefined)
      }
    })
  },
)

Deno.test('[contract] startWeb: 监听 0.0.0.0 时应通过回环地址完成就绪探测', async () => {
  await withOwnedRuntime(async ({ runtimeDir }) => {
    await Deno.writeTextFile(join(runtimeDir, 'config.yml'), 'sources: {}\n')

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
        '--allow-sys',
        'src/main.ts',
        '--mode',
        'web',
        '--web_host',
        '0.0.0.0',
        '--web_port',
        String(port),
      ],
      cwd: Deno.cwd(),
      env: createStableChildEnv({
        KNOCK_RUNTIME_DIR: runtimeDir,
      }),
      stdout: 'piped',
      stderr: 'piped',
    }).spawn()

    try {
      const deadline = Date.now() + WEB_STARTUP_TEST_TIMEOUT_MS
      let configResponse: Response | undefined
      let lastError: unknown

      while (Date.now() < deadline) {
        try {
          const candidate = await fetch(`http://127.0.0.1:${port}/config`)
          if (candidate.status === 200) {
            configResponse = candidate
            break
          }
          lastError = new Error(`unexpected status: ${candidate.status}`)
        } catch (error) {
          lastError = error
        }

        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      if (!configResponse) {
        throw lastError instanceof Error ? lastError : new Error('等待 0.0.0.0 config 页面可达超时')
      }
      await configResponse.text()
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
})

Deno.test('[contract] waitForWebReady: 单次长首访应在总等待窗口内成功', async () => {
  const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  const { port } = listener.addr as Deno.NetAddr
  listener.close()

  let requestCount = 0
  const server = Deno.serve({ hostname: '127.0.0.1', port }, async (request) => {
    if (new URL(request.url).pathname !== '/config') {
      return new Response('not found', { status: 404 })
    }

    requestCount += 1
    if (requestCount === 1) {
      await new Promise((resolve) => setTimeout(resolve, 18_000))
    }

    return new Response('<html><body>Knock Config</body></html>', {
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
    })
  })

  const startedAt = Date.now()
  try {
    await waitForWebReady(
      {
        status: new Promise<Deno.CommandStatus>(() => {}),
      } as Deno.ChildProcess,
      '127.0.0.1',
      port,
    )
  } finally {
    await server.shutdown()
  }

  if (requestCount !== 1) {
    throw new Error(`长首访不应被中断重试，实际请求了 ${requestCount} 次`)
  }
  if (Date.now() - startedAt < 18_000) {
    throw new Error('waitForWebReady 不应在长首访完成前返回')
  }
})

Deno.test('[contract] startWeb: 启动后 config 页面应实际可访问', async () => {
  await withOwnedRuntime(async ({ runtimeDir }) => {
    await Deno.writeTextFile(join(runtimeDir, 'config.yml'), 'sources: {}\n')

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
        '--allow-sys',
        'src/main.ts',
        '--mode',
        'web',
        '--web_host',
        '127.0.0.1',
        '--web_port',
        String(port),
      ],
      cwd: Deno.cwd(),
      env: createStableChildEnv({
        KNOCK_RUNTIME_DIR: runtimeDir,
      }),
      stdout: 'piped',
      stderr: 'piped',
    }).spawn()

    try {
      const deadline = Date.now() + WEB_STARTUP_TEST_TIMEOUT_MS
      let homeResponse: Response | undefined
      let lastError: unknown

      while (Date.now() < deadline) {
        try {
          const candidate = await fetch(`http://127.0.0.1:${port}/`)
          if (candidate.status === 200) {
            homeResponse = candidate
            break
          }
          lastError = new Error(`unexpected status: ${candidate.status}`)
        } catch (error) {
          lastError = error
        }

        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      if (!homeResponse) {
        throw lastError instanceof Error ? lastError : new Error('等待首页可达超时')
      }
      await homeResponse.text()

      const response = await fetch(`http://127.0.0.1:${port}/config`)
      assertEquals(response.status, 200)
      await response.text()
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
})

Deno.test('[contract] startWeb: 端口被占用时应直接报子进程退出而不是等待超时', async () => {
  await withOwnedRuntime(async ({ runtimeDir }) => {
    const originalRuntimeDir = Deno.env.get('KNOCK_RUNTIME_DIR')

    await Deno.writeTextFile(join(runtimeDir, 'config.yml'), 'sources: {}\n')

    const occupied = Deno.listen({ hostname: '127.0.0.1', port: 0 })
    const { port } = occupied.addr as Deno.NetAddr

    Deno.env.set('KNOCK_RUNTIME_DIR', runtimeDir)

    try {
      const startedAt = Date.now()
      await assertRejects(
        () =>
          startWeb({
            host: '127.0.0.1',
            port,
          }),
        Error,
        'web 子进程异常退出: 1',
      )
      const elapsedMs = Date.now() - startedAt
      if (elapsedMs >= 14_000) {
        throw new Error(`端口占用失败不应等待接近超时窗口，实际耗时 ${elapsedMs}ms`)
      }
    } finally {
      if (originalRuntimeDir === undefined) {
        Deno.env.delete('KNOCK_RUNTIME_DIR')
      } else {
        Deno.env.set('KNOCK_RUNTIME_DIR', originalRuntimeDir)
      }
      occupied.close()
    }
  })
})

Deno.test('[contract] startWeb: 就绪后短窗口内不应因 config watcher 立即退出', async () => {
  await withOwnedRuntime(async ({ runtimeDir }) => {
    await Deno.writeTextFile(join(runtimeDir, 'config.yml'), 'sources: {}\n')

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
        '--allow-sys',
        'src/main.ts',
        '--mode',
        'web',
        '--web_host',
        '127.0.0.1',
        '--web_port',
        String(port),
      ],
      cwd: Deno.cwd(),
      env: createStableChildEnv({
        KNOCK_RUNTIME_DIR: runtimeDir,
      }),
      stdout: 'piped',
      stderr: 'piped',
    }).spawn()

    try {
      const deadline = Date.now() + WEB_STARTUP_TEST_TIMEOUT_MS
      let configResponse: Response | undefined
      let lastError: unknown

      while (Date.now() < deadline) {
        try {
          const candidate = await fetch(`http://127.0.0.1:${port}/config`)
          if (candidate.status === 200) {
            configResponse = candidate
            break
          }
          lastError = new Error(`unexpected status: ${candidate.status}`)
        } catch (error) {
          lastError = error
        }

        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      if (!configResponse) {
        throw lastError instanceof Error ? lastError : new Error('等待 config 页面可达超时')
      }
      await configResponse.text()

      const earlyExit = await Promise.race([
        child.status.then((status) => ({ kind: 'exit' as const, status })),
        new Promise<{ kind: 'timeout' }>((resolve) =>
          setTimeout(() => resolve({ kind: 'timeout' }), 1200),
        ),
      ])
      if (earlyExit.kind === 'exit') {
        throw new Error(`web 子进程在启动后过早退出: ${earlyExit.status.code}`)
      }
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
})
