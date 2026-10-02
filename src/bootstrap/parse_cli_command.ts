import { parseArgs } from 'node:util'
import { z } from 'zod'
import { getEnvObject } from '../platform/env.ts'
import { parseWithFirstIssue } from '../zod_utils.ts'

export interface DaemonCliCommand {
  kind: 'daemon'
  configPath?: string
  runtimeDir?: string
  immediate: boolean
  once: boolean
}

export type CliCommand = DaemonCliCommand

export interface DaemonStartOptions {
  configPath?: string
  runtimeDir?: string
  immediate: boolean
  once: boolean
}

const cliPositionalsSchema = z.array(z.string()).superRefine((positionals, ctx) => {
  if (positionals.length === 0) return
  ctx.addIssue({
    code: 'custom',
    message: `未知参数: ${positionals[0]}`,
  })
})

const cliOptionsSchema = z
  .object({
    configPath: z.string().optional(),
    runtimeDir: z.string().optional(),
    immediate: z.boolean(),
    once: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.immediate && value.once) {
      ctx.addIssue({ code: 'custom', message: '--immediate 与 --once 不能同时使用' })
    }
  })

export function parseCliCommand(args: string[]): CliCommand {
  try {
    const { values, positionals } = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        config: { type: 'string' },
        runtime_dir: { type: 'string' },
        immediate: { type: 'boolean' },
        once: { type: 'boolean' },
      },
    })

    parseWithFirstIssue(cliPositionalsSchema, positionals, '未知参数')

    const options = parseWithFirstIssue(
      cliOptionsSchema,
      {
        configPath: values.config,
        runtimeDir: values.runtime_dir,
        immediate: values.immediate ?? false,
        once: values.once ?? false,
      },
      'CLI 参数非法',
    )

    return {
      kind: 'daemon',
      configPath: options.configPath,
      runtimeDir: options.runtimeDir,
      immediate: options.immediate,
      once: options.once,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

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
    if (message.includes('Unknown option')) {
      const match = message.match(/Unknown option '([^']+)'/)
      throw new Error(`未知参数: ${match?.[1] ?? args[0]}`)
    }

    throw error
  }
}

export function toDaemonStartOptions(command: CliCommand): DaemonStartOptions {
  return {
    configPath: command.configPath,
    runtimeDir: command.runtimeDir,
    immediate: command.immediate,
    once: command.once,
  }
}

export function resolveDaemonStartOptions(
  command: CliCommand,
  env: Record<string, string | undefined> = getEnvObject(),
): DaemonStartOptions {
  const options = toDaemonStartOptions(command)
  return {
    ...options,
    runtimeDir: options.runtimeDir ?? env.KNOCK_RUNTIME_DIR,
  }
}
