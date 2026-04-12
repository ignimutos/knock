import { exists } from '@std/fs'
import { dirname, join, resolve } from '@std/path'
import { parse } from '@std/yaml'
import type { Logger } from '../core/logger.ts'
import { parseWithFirstIssue } from '../zod_utils.ts'
import { resolveConfig } from './resolve_config.ts'
import { phase1ConfigSchema, rawConfigSyntaxSchema } from './schema.ts'
import type { AppConfigResolved } from './types.ts'
import { validateConfig } from './validate_config.ts'
import { isEnvExpansionAllowed } from './capabilities.ts'

export interface LoadConfigOptions {
  runtimeDir?: string
  configPath?: string
  logger?: Logger
}

function getRuntimeDir(options: LoadConfigOptions): string {
  if (options.runtimeDir) return resolve(options.runtimeDir)

  const fromEnv = Deno.env.get('KNOCK_RUNTIME_DIR')
  if (fromEnv) return resolve(fromEnv)

  if (options.configPath) return dirname(resolve(options.configPath))

  return join(Deno.cwd(), 'runtime')
}

async function findConfigFile(runtimeDir: string): Promise<string> {
  const yml = join(runtimeDir, 'config.yml')
  const yaml = join(runtimeDir, 'config.yaml')

  if (await exists(yml)) return yml
  if (await exists(yaml)) return yaml
  throw new Error(`配置文件不存在: ${yml} 或 ${yaml}`)
}

function normalizeCapabilityLookupPath(path: string): string {
  return path.replace(/\[\d+\]/g, '')
}

function expandEnvString(value: string, path: string): string {
  const capabilityPath = normalizeCapabilityLookupPath(path)
  if (value.includes('${') && !isEnvExpansionAllowed(capabilityPath)) {
    throw new Error(`${path} 不支持环境变量展开`)
  }

  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => {
    const envValue = Deno.env.get(name)
    if (envValue === undefined) {
      throw new Error(`${path} 引用了未定义环境变量: ${name}`)
    }
    return envValue
  })
}

function expandEnvValue(value: unknown, path: string): unknown {
  if (typeof value === 'string') {
    return expandEnvString(value, path)
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => expandEnvValue(item, `${path}[${index}]`))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        const childPath = path ? `${path}.${key}` : key
        return [key, expandEnvValue(child, childPath)]
      }),
    )
  }

  return value
}

function expandEnvInConfig(parsed: Record<string, unknown>): Record<string, unknown> {
  return expandEnvValue(parsed, '') as Record<string, unknown>
}

function parseConfigDocument(raw: string): Record<string, unknown> {
  parseWithFirstIssue(rawConfigSyntaxSchema, raw, '配置文件格式非法')

  const parsed = parseWithFirstIssue(
    phase1ConfigSchema,
    (parse(raw) ?? {}) as Record<string, unknown>,
    '配置非法',
  )

  return expandEnvInConfig(parsed)
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<AppConfigResolved> {
  const runtimeDir = getRuntimeDir(options)
  const configPath = options.configPath
    ? resolve(options.configPath)
    : await findConfigFile(runtimeDir)
  options.logger?.info('开始加载配置', {
    module: 'config.load',
    'config.operation': 'load_config',
    'config.outcome': 'start',
    'config.path': configPath,
    'config.runtime_dir': runtimeDir,
  })

  try {
    const raw = await Deno.readTextFile(configPath)
    const parsed = parseConfigDocument(raw)
    const input = {
      ...parsed,
      runtimeDir,
    }

    options.logger?.info('开始校验配置', {
      module: 'config.validate',
      'config.operation': 'validate_config',
      'config.outcome': 'start',
      'config.path': configPath,
      'config.runtime_dir': runtimeDir,
    })
    const validatedInput = validateConfig(input)
    options.logger?.info('配置校验通过', {
      module: 'config.validate',
      'config.operation': 'validate_config',
      'config.outcome': 'success',
      'config.path': configPath,
      'config.runtime_dir': runtimeDir,
    })

    const resolved = resolveConfig(validatedInput)
    options.logger?.info('配置解析完成', {
      module: 'config.resolve',
      'config.operation': 'resolve_config',
      'config.outcome': 'success',
      'config.path': configPath,
      'config.runtime_dir': runtimeDir,
    })
    options.logger?.info('配置加载完成', {
      module: 'config.load',
      'config.operation': 'load_config',
      'config.outcome': 'success',
      'config.path': configPath,
      'config.runtime_dir': runtimeDir,
    })
    return resolved
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    options.logger?.error('配置加载失败', {
      module: 'config.load',
      'config.operation': 'load_config',
      'config.outcome': 'failure',
      'config.path': configPath,
      'config.runtime_dir': runtimeDir,
      error_name: error instanceof Error ? error.name : 'Error',
      error_message: msg,
      stack: error instanceof Error ? error.stack : undefined,
    })
    throw new Error(`配置文件错误(${configPath}): ${msg}`)
  }
}
