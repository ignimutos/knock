import { assertEquals, assertStringIncludes } from '../testing/assert.ts'
import { ensureDir, exists } from '../testing/fs.ts'
import { dirname, join } from 'node:path'
import { readDir, readTextFile } from '../platform/fs.ts'
import { withOwnedRuntime } from '../test_runtime.ts'
import { configureLoggingRuntime, shutdownLoggingRuntime } from './logging_runtime.ts'
import { createLogger } from './logger.ts'
import { test } from '../testing/test_api.ts'

test('[contract] R11 logging_runtime: 不配置 sinks 时不应输出', async () => {
  const stdout: string[] = []

  await configureLoggingRuntime({
    logging: { level: 'info', sinks: {} },
    runtimeDir: '/tmp/runtime',
    timezone: 'UTC',
    timestampFormat: 'yyyy-MM-dd HH:mm:ss',
    consoleWriters: {
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stdout.push(line),
      warn: (line: string) => stdout.push(line),
    },
  })

  createLogger({ enabled: true, level: 'info', module: 'app.startup' }).info('no sinks')
  await shutdownLoggingRuntime()

  assertEquals(stdout, [])
})

test('[contract] R11 logging_runtime: 只配置 file sink 时应只写 jsonl 文件', async () => {
  await withOwnedRuntime(async ({ runtimeDir }) => {
    const logPath = join(runtimeDir, 'logs', 'app.jsonl')
    await ensureDir(dirname(logPath))
    const stdout: string[] = []

    await configureLoggingRuntime({
      logging: {
        level: 'info',
        sinks: {
          file: {
            type: 'file',
            format: 'jsonl',
            path: logPath,
          },
        },
      },
      runtimeDir,
      timezone: 'UTC',
      timestampFormat: 'yyyy-MM-dd HH:mm:ss',
      consoleWriters: {
        stdout: (line: string) => stdout.push(line),
        stderr: (line: string) => stdout.push(line),
        warn: (line: string) => stdout.push(line),
      },
    })

    createLogger({
      enabled: true,
      level: 'info',
      module: 'delivery.http',
    }).info('file only', {
      'delivery.id': 'archive',
    })
    await shutdownLoggingRuntime()

    assertEquals(stdout, [])
    assertEquals(await exists(logPath), true)
    const written = await readTextFile(logPath)
    assertStringIncludes(written, '"delivery.id":"archive"')
  })
})

test('[contract] R11 logging_runtime: size rotation 应委托 rotating file sink', async () => {
  await withOwnedRuntime(async ({ runtimeDir }) => {
    const logPath = join(runtimeDir, 'logs', 'rotating.jsonl')
    await configureLoggingRuntime({
      logging: {
        level: 'info',
        sinks: {
          file: {
            type: 'file',
            format: 'jsonl',
            path: logPath,
            rotation: {
              type: 'size',
              maxSize: '1k',
              maxFiles: 2,
            },
          },
        },
      },
      runtimeDir,
      timezone: 'UTC',
      timestampFormat: 'yyyy-MM-dd HH:mm:ss',
    })

    for (let i = 0; i < 50; i += 1) {
      createLogger({
        enabled: true,
        level: 'info',
        module: 'delivery.http',
      }).info('rotate', {
        'delivery.id': `d${i}`,
      })
    }
    await shutdownLoggingRuntime()

    const files = (await readDir(join(runtimeDir, 'logs'))).map((entry) => entry.name)
    assertEquals(
      files.some((name) => name.includes('rotating')),
      true,
    )
  })
})

test('[contract] R11 logging_runtime: shutdown 应 flush file sink 尾日志', async () => {
  await withOwnedRuntime(async ({ runtimeDir }) => {
    const logPath = join(runtimeDir, 'logs', 'flush.jsonl')
    await configureLoggingRuntime({
      logging: {
        level: 'info',
        sinks: {
          file: {
            type: 'file',
            format: 'jsonl',
            path: logPath,
          },
        },
      },
      runtimeDir,
      timezone: 'UTC',
      timestampFormat: 'yyyy-MM-dd HH:mm:ss',
    })

    createLogger({
      enabled: true,
      level: 'info',
      module: 'app.startup',
    }).info('tail record')
    await shutdownLoggingRuntime()

    const written = await readTextFile(logPath)
    assertStringIncludes(written, 'tail record')
  })
})

test('[contract] R11 logging_runtime: trace 级别应输出 trace 记录到 console sink', async () => {
  const stdout: string[] = []

  await configureLoggingRuntime({
    logging: {
      level: 'trace',
      sinks: {
        console: {
          type: 'console',
          format: 'jsonl',
        },
      },
    },
    runtimeDir: '/tmp/runtime',
    timezone: 'UTC',
    timestampFormat: 'yyyy-MM-dd HH:mm:ss',
    consoleWriters: {
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stdout.push(line),
      warn: (line: string) => stdout.push(line),
    },
  })

  createLogger({ enabled: true, level: 'trace', module: 'app.startup' }).trace('trace visible')
  await shutdownLoggingRuntime()

  assertEquals(stdout.length, 1)
  assertStringIncludes(stdout[0] ?? '', '"severityText":"TRACE"')
  assertStringIncludes(stdout[0] ?? '', 'trace visible')
})

test('[contract] R11 logging_runtime: 不应输出 logtape meta startup 提示', async () => {
  const stdout: string[] = []

  await configureLoggingRuntime({
    logging: {
      level: 'info',
      sinks: {
        console: {
          type: 'console',
          format: 'jsonl',
        },
      },
    },
    runtimeDir: '/tmp/runtime',
    timezone: 'UTC',
    timestampFormat: 'yyyy-MM-dd HH:mm:ss',
    consoleWriters: {
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stdout.push(line),
      warn: (line: string) => stdout.push(line),
    },
  })

  await shutdownLoggingRuntime()

  assertEquals(
    stdout.some((line) => line.includes('LogTape loggers are configured')),
    false,
  )
})
