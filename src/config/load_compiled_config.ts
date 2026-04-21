import { dirname, join, resolve } from '@std/path'
import { parse } from '@std/yaml'
import type { Logger } from '../core/logger.ts'
import { compileDefinitionsFromResolvedConfig } from '../definitions/compile_definitions.ts'
import type { DefinitionSet } from '../definitions/definition_set.ts'
import { parseWithFirstIssue } from '../zod_utils.ts'
import { isEnvExpansionAllowed } from './capabilities.ts'
import { resolveConfig } from './resolve_config.ts'
import { phase1ConfigSchema, rawConfigSyntaxSchema } from './schema.ts'
import type { AppConfigResolved } from './types.ts'
import { validateConfig } from './validate_config.ts'

export interface LoadConfigOptions {
  runtimeDir?: string
  configPath?: string
  logger?: Logger
}

export interface LoadCompiledConfigOptions extends LoadConfigOptions {
  envMode?: 'strict' | 'preserve_unknown'
}

export interface LoadedCompiledConfig {
  config: AppConfigResolved
  definitions: DefinitionSet
  diagnostics: readonly string[]
  configPath: string
  runtimeDir: string
}

function getRuntimeDir(options: LoadConfigOptions): string {
  if (options.runtimeDir) return resolve(options.runtimeDir)

  const fromEnv = Deno.env.get('KNOCK_RUNTIME_DIR')
  if (fromEnv) return resolve(fromEnv)

  if (options.configPath) return dirname(resolve(options.configPath))

  return join(Deno.cwd(), 'runtime')
}

export async function findConfigFile(runtimeDir: string): Promise<string> {
  const yml = join(runtimeDir, 'config.yml')
  try {
    await Deno.stat(yml)
    return yml
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error
    }
  }

  const yaml = join(runtimeDir, 'config.yaml')
  try {
    await Deno.stat(yaml)
    return yaml
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`配置文件不存在: ${yml} 或 ${yaml}`)
    }
    throw error
  }
}

function normalizeCapabilityLookupPath(path: string): string {
  return path.replace(/\[\d+\]/g, '')
}

function expandEnvString(
  value: string,
  path: string,
  envMode: LoadCompiledConfigOptions['envMode'],
): string {
  const capabilityPath = normalizeCapabilityLookupPath(path)
  if (value.includes('${') && !isEnvExpansionAllowed(capabilityPath)) {
    throw new Error(`${path} 不支持环境变量展开`)
  }

  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (matched, name: string) => {
    const envValue = Deno.env.get(name)
    if (envValue === undefined) {
      if (envMode === 'preserve_unknown') return matched
      throw new Error(`${path} 引用了未定义环境变量: ${name}`)
    }
    return envValue
  })
}

function expandEnvValue(
  value: unknown,
  path: string,
  envMode: LoadCompiledConfigOptions['envMode'],
): unknown {
  if (typeof value === 'string') {
    return expandEnvString(value, path, envMode)
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => expandEnvValue(item, `${path}[${index}]`, envMode))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        const childPath = path ? `${path}.${key}` : key
        return [key, expandEnvValue(child, childPath, envMode)]
      }),
    )
  }

  return value
}

function expandEnvInConfig(
  parsed: Record<string, unknown>,
  envMode: LoadCompiledConfigOptions['envMode'],
): Record<string, unknown> {
  return expandEnvValue(parsed, '', envMode) as Record<string, unknown>
}

export function parseRawConfigDocument(raw: string): Record<string, unknown> {
  parseWithFirstIssue(rawConfigSyntaxSchema, raw, '配置文件格式非法')

  return parseWithFirstIssue(
    phase1ConfigSchema,
    (parse(raw) ?? {}) as Record<string, unknown>,
    '配置非法',
  )
}

export function compileConfigDocument(options: {
  document: Record<string, unknown>
  runtimeDir: string
  configPath: string
  envMode?: 'strict' | 'preserve_unknown'
}): LoadedCompiledConfig {
  const runtimeDir = resolve(options.runtimeDir)
  const configPath = resolve(options.configPath)
  const validatedInput = validateConfig({
    ...expandEnvInConfig(options.document, options.envMode),
    runtimeDir,
  })
  const config = resolveConfig(validatedInput)

  return {
    config,
    definitions: compileDefinitionsFromResolvedConfig(config),
    diagnostics: [],
    configPath,
    runtimeDir,
  }
}

function parseConfigDocument(
  raw: string,
  envMode: LoadCompiledConfigOptions['envMode'],
): Record<string, unknown> {
  return expandEnvInConfig(parseRawConfigDocument(raw), envMode)
}

async function loadResolvedConfig(options: LoadCompiledConfigOptions): Promise<{
  config: AppConfigResolved
  configPath: string
  runtimeDir: string
}> {
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
    const parsed = parseConfigDocument(raw, options.envMode)
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

    const config = resolveConfig(validatedInput)
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

    return {
      config,
      configPath,
      runtimeDir,
    }
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

export async function loadCompiledConfig(
  options: LoadCompiledConfigOptions = {},
): Promise<LoadedCompiledConfig> {
  const loaded = await loadResolvedConfig(options)

  return {
    ...loaded,
    definitions: compileDefinitionsFromResolvedConfig(loaded.config),
    diagnostics: [],
  }
}
