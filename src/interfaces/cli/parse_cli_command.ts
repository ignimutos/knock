import { parseArgs } from 'node:util'
import { z } from 'zod'
import { parseWithFirstIssue } from '../../zod_utils.ts'

export type CliMode = 'all' | 'web' | 'daemon'

export interface DaemonCliCommand {
  kind: 'daemon'
  configPath?: string
  runtimeDir?: string
  immediate: boolean
}

export interface WebCliCommand {
  kind: 'web'
  host: string
  port: number
}

export interface AllCliCommand {
  kind: 'all'
  configPath?: string
  runtimeDir?: string
  immediate: boolean
  host?: string
  port?: number
}

export type CliCommand = DaemonCliCommand | WebCliCommand | AllCliCommand

export interface DaemonStartOptions {
  configPath?: string
  runtimeDir?: string
  immediate: boolean
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
    host: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'web') {
      if (value.configPath !== undefined) {
        ctx.addIssue({ code: 'custom', message: 'web 模式不支持 --config' })
      }
      if (value.runtimeDir !== undefined) {
        ctx.addIssue({ code: 'custom', message: 'web 模式不支持 --runtime_dir' })
      }
      if (value.immediate) {
        ctx.addIssue({ code: 'custom', message: 'web 模式不支持 --immediate' })
      }
    }

    if (value.mode === 'daemon') {
      if (value.host !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'daemon 模式不支持 --web_host',
        })
      }
      if (value.port !== undefined) {
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

function assertDaemonLikeCommand(
  command: CliCommand,
): asserts command is DaemonCliCommand | AllCliCommand {
  if (command.kind === 'web') {
    throw new Error('web command 无法转换为 daemon 启动参数')
  }
}

function assertAllCommand(command: CliCommand): asserts command is AllCliCommand {
  if (command.kind !== 'all') {
    throw new Error('仅 all 命令可拆分为 daemon/web 子进程')
  }
}

export function parseCliCommand(args: string[]): CliCommand {
  try {
    const { values, positionals } = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        mode: { type: 'string' },
        config: { type: 'string' },
        runtime_dir: { type: 'string' },
        immediate: { type: 'boolean' },
        web_host: { type: 'string' },
        web_port: { type: 'string' },
      },
    })

    parseWithFirstIssue(cliPositionalsSchema, positionals, '未知参数')

    const options = parseWithFirstIssue(
      cliOptionsSchema,
      {
        mode: values.mode ?? 'all',
        configPath: values.config,
        runtimeDir: values.runtime_dir,
        immediate: values.immediate ?? false,
        host: values.web_host,
        port: parseWebPort(values.web_port),
      },
      'CLI 参数非法',
    )

    if (options.mode === 'daemon') {
      return {
        kind: 'daemon',
        configPath: options.configPath,
        runtimeDir: options.runtimeDir,
        immediate: options.immediate,
      }
    }

    if (options.mode === 'web') {
      return {
        kind: 'web',
        host: options.host ?? '127.0.0.1',
        port: options.port ?? 8000,
      }
    }

    return {
      kind: 'all',
      configPath: options.configPath,
      runtimeDir: options.runtimeDir,
      immediate: options.immediate,
      host: options.host,
      port: options.port,
    }
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

export function toDaemonStartOptions(command: CliCommand): DaemonStartOptions {
  assertDaemonLikeCommand(command)
  return {
    configPath: command.configPath,
    runtimeDir: command.runtimeDir,
    immediate: command.immediate,
  }
}

export function resolveDaemonStartOptions(
  command: CliCommand,
  env: Record<string, string | undefined> = Deno.env.toObject(),
): DaemonStartOptions {
  const options = toDaemonStartOptions(command)
  return {
    ...options,
    runtimeDir: options.runtimeDir ?? env.KNOCK_RUNTIME_DIR,
  }
}

export function buildChildArgs(command: CliCommand, mode: 'web' | 'daemon'): string[] {
  assertAllCommand(command)

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
    if (command.configPath !== undefined) {
      args.push('--config', command.configPath)
    }
    if (command.runtimeDir !== undefined) {
      args.push('--runtime_dir', command.runtimeDir)
    }
    if (command.immediate) args.push('--immediate')
  }

  if (mode === 'web') {
    if (command.host !== undefined) args.push('--web_host', command.host)
    if (command.port !== undefined) {
      args.push('--web_port', String(command.port))
    }
  }

  return args
}
