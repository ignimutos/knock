import { parseArgs } from 'node:util'
import { z } from 'zod'
import type { StartAppOptions } from './core/app.ts'
import { createLogger } from './core/logger.ts'
import { parseWithFirstIssue } from './zod_utils.ts'

export type CliMode = 'all' | 'web' | 'daemon'

export interface ParsedCliOptions extends StartAppOptions {
  mode: CliMode
  webHost?: string
  webPort?: number
}

export function toDaemonStartOptions(options: ParsedCliOptions): StartAppOptions {
  return {
    configPath: options.configPath,
    runtimeDir: options.runtimeDir,
    immediate: options.immediate,
  }
}

export function resolveDaemonStartOptions(
  options: ParsedCliOptions,
  env: Record<string, string | undefined> = Deno.env.toObject(),
): StartAppOptions {
  return {
    ...toDaemonStartOptions(options),
    runtimeDir: options.runtimeDir ?? env.KNOCK_RUNTIME_DIR,
  }
}

export function buildChildArgs(options: ParsedCliOptions, mode: 'web' | 'daemon'): string[] {
  const args = [
    'run',
    '--allow-read',
    '--allow-write',
    '--allow-env',
    '--allow-net',
    '--allow-ffi',
    '--allow-run',
    'src/main.ts',
    '--mode',
    mode,
  ]

  if (mode === 'daemon') {
    if (options.configPath !== undefined) {
      args.push('--config', options.configPath)
    }
    if (options.runtimeDir !== undefined) {
      args.push('--runtime_dir', options.runtimeDir)
    }
    if (options.immediate) args.push('--immediate')
  }

  if (mode === 'web') {
    if (options.webHost !== undefined) args.push('--web_host', options.webHost)
    if (options.webPort !== undefined) {
      args.push('--web_port', String(options.webPort))
    }
  }

  return args
}

export async function startWeb(options: { host: string; port: number }) {
  const { default: webApp } = await import('../web/main.ts')
  const logger = createLogger({
    enabled: true,
    level: 'info',
    format: 'json',
    module: 'web.startup',
    component: 'web',
    timezone: 'UTC',
    timestampFormat: 'yyyy-MM-dd HH:mm:ss',
  })

  await webApp.listen({
    hostname: options.host,
    port: options.port,
    onListen: ({ hostname, port }) => {
      logger.info('Web 服务开始监听', {
        'web.operation': 'startup',
        'web.outcome': 'listening',
        'web.host': hostname,
        'web.port': port,
        'web.url': `http://${hostname}:${port}/`,
      })
    },
  })
}

export async function runAllModes(options: ParsedCliOptions): Promise<void> {
  const daemonChild = new Deno.Command(Deno.execPath(), {
    args: buildChildArgs(options, 'daemon'),
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()

  const webChild = new Deno.Command(Deno.execPath(), {
    args: buildChildArgs(options, 'web'),
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()

  const firstExit = await Promise.race([
    daemonChild.status.then((status) => ({ name: 'daemon', status })),
    webChild.status.then((status) => ({ name: 'web', status })),
  ])

  if (firstExit.name === 'daemon') {
    try {
      webChild.kill('SIGTERM')
    } catch {
      // noop
    }
  } else {
    try {
      daemonChild.kill('SIGTERM')
    } catch {
      // noop
    }
  }

  await Promise.allSettled([daemonChild.status, webChild.status])

  if (!firstExit.status.success) {
    throw new Error(`${firstExit.name} 子进程异常退出: ${firstExit.status.code}`)
  }
}

const cliPositionalsSchema = z.array(z.string()).superRefine((positionals, ctx) => {
  if (positionals.length === 0) return
  ctx.addIssue({
    code: 'custom',
    message: `未知参数: ${positionals[0]}`,
  })
})

const cliModeSchema = z.string().superRefine((value, ctx) => {
  if (value === 'all' || value === 'web' || value === 'daemon') return
  ctx.addIssue({
    code: 'custom',
    message: `--mode 非法: ${value}`,
  })
}) as z.ZodType<CliMode>

const cliOptionsSchema = z
  .object({
    mode: cliModeSchema,
    configPath: z.string().optional(),
    runtimeDir: z.string().optional(),
    immediate: z.boolean(),
    webHost: z.string().optional(),
    webPort: z.number().int().min(1).max(65535).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'web') {
      if (value.configPath !== undefined) {
        ctx.addIssue({ code: 'custom', message: 'web 模式不支持 --config' })
      }
      if (value.runtimeDir !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'web 模式不支持 --runtime_dir',
        })
      }
      if (value.immediate) {
        ctx.addIssue({ code: 'custom', message: 'web 模式不支持 --immediate' })
      }
    }

    if (value.mode === 'daemon') {
      if (value.webHost !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'daemon 模式不支持 --web_host',
        })
      }
      if (value.webPort !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'daemon 模式不支持 --web_port',
        })
      }
    }
  })

function parseWebPort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!/^\d+$/.test(value)) {
    throw new Error('--web_port 非法')
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error('--web_port 非法')
  }
  return parsed
}

/**
 * 只解析当前入口明确支持的 CLI 参数；遇到未知参数或缺失值时立即报错，避免静默带着错误配置启动。
 */
export function parseCliArgs(args: string[]): ParsedCliOptions {
  try {
    const { values, positionals } = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        mode: {
          type: 'string',
        },
        config: {
          type: 'string',
        },
        runtime_dir: {
          type: 'string',
        },
        immediate: {
          type: 'boolean',
        },
        web_host: {
          type: 'string',
        },
        web_port: {
          type: 'string',
        },
      },
    })

    parseWithFirstIssue(cliPositionalsSchema, positionals, '未知参数')

    return parseWithFirstIssue(
      cliOptionsSchema,
      {
        mode: values.mode ?? 'all',
        configPath: values.config,
        runtimeDir: values.runtime_dir,
        immediate: values.immediate ?? false,
        webHost: values.web_host,
        webPort: parseWebPort(values.web_port),
      },
      'CLI 参数非法',
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (
      message.includes("option '--mode <value>' argument missing") ||
      message.includes("Option '--mode <value>' argument missing")
    ) {
      throw new Error('--mode 缺少参数')
    }
    if (
      message.includes("option '--config <value>' argument missing") ||
      message.includes("Option '--config <value>' argument missing")
    ) {
      throw new Error('--config 缺少路径参数')
    }
    if (
      message.includes("option '--runtime_dir <value>' argument missing") ||
      message.includes("Option '--runtime_dir <value>' argument missing")
    ) {
      throw new Error('--runtime_dir 缺少目录参数')
    }
    if (
      message.includes("option '--web_host <value>' argument missing") ||
      message.includes("Option '--web_host <value>' argument missing")
    ) {
      throw new Error('--web_host 缺少参数')
    }
    if (
      message.includes("option '--web_port <value>' argument missing") ||
      message.includes("Option '--web_port <value>' argument missing")
    ) {
      throw new Error('--web_port 缺少参数')
    }
    if (message.includes('Unknown option')) {
      const match = message.match(/Unknown option '([^']+)'/)
      throw new Error(`未知参数: ${match?.[1] ?? args[0]}`)
    }

    throw error
  }
}

if (import.meta.main) {
  const options = parseCliArgs(Deno.args)

  if (options.mode === 'daemon') {
    const { startApp } = await import('./core/app.ts')
    await startApp(resolveDaemonStartOptions(options))
  } else if (options.mode === 'web') {
    await startWeb({
      host: options.webHost ?? '127.0.0.1',
      port: options.webPort ?? 8000,
    })
  } else {
    await runAllModes(options)
  }
}
