import { dirname, join, resolve } from '@std/path'
import { parse } from '@std/yaml'
import type { Logger } from '../core/logger.ts'
import { compileDefinitionsFromResolvedConfig } from '../definitions/compile_definitions.ts'
import type { DefinitionSet } from '../definitions/definition_set.ts'
import { getEnv } from '../platform/env.ts'
import { cwd, isNotFoundError, readTextFile, statPath } from '../platform/fs.ts'
import { parseWithFirstIssue } from '../zod_utils.ts'
import { isEnvExpansionAllowed } from './capabilities.ts'
import { resolveConfig } from './resolve_config.ts'
import { phase1ConfigSchema, rawConfigSyntaxSchema, type AppConfigValidated } from './schema.ts'
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

  const fromEnv = getEnv('KNOCK_RUNTIME_DIR')
  if (fromEnv) return resolve(fromEnv)

  if (options.configPath) return dirname(resolve(options.configPath))

  return join(cwd(), 'runtime')
}

export async function findConfigFile(runtimeDir: string): Promise<string> {
  const yml = join(runtimeDir, 'config.yml')
  try {
    await statPath(yml)
    return yml
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
  }

  const yaml = join(runtimeDir, 'config.yaml')
  try {
    await statPath(yaml)
    return yaml
  } catch (error) {
    if (isNotFoundError(error)) {
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
    const envValue = getEnv(name)
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

function validateCompiledConfigDocument(input: {
  document: Record<string, unknown>
  runtimeDir: string
  envMode?: 'strict' | 'preserve_unknown'
}): AppConfigValidated {
  return validateConfig({
    ...expandEnvInConfig(input.document, input.envMode),
    runtimeDir: resolve(input.runtimeDir),
  })
}

function createCompiledConfigResult(input: {
  validatedInput: AppConfigValidated
  runtimeDir: string
  configPath: string
}): LoadedCompiledConfig {
  const runtimeDir = resolve(input.runtimeDir)
  const configPath = resolve(input.configPath)
  const config = resolveConfig(input.validatedInput)

  return {
    config,
    definitions: compileDefinitionsFromResolvedConfig(config),
    diagnostics: [],
    configPath,
    runtimeDir,
  }
}

export function compileConfigDocument(options: {
  document: Record<string, unknown>
  runtimeDir: string
  configPath: string
  envMode?: 'strict' | 'preserve_unknown'
}): LoadedCompiledConfig {
  const runtimeDir = resolve(options.runtimeDir)
  const validatedInput = validateCompiledConfigDocument({
    document: options.document,
    runtimeDir,
    envMode: options.envMode,
  })

  return createCompiledConfigResult({
    validatedInput,
    runtimeDir,
    configPath: options.configPath,
  })
}

async function loadResolvedConfig(
  options: LoadCompiledConfigOptions,
): Promise<LoadedCompiledConfig> {
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
    const raw = await readTextFile(configPath)
    const document = parseRawConfigDocument(raw)

    options.logger?.info('开始校验配置', {
      module: 'config.validate',
      'config.operation': 'validate_config',
      'config.outcome': 'start',
      'config.path': configPath,
      'config.runtime_dir': runtimeDir,
    })
    const validatedInput = validateCompiledConfigDocument({
      document,
      runtimeDir,
      envMode: options.envMode,
    })
    options.logger?.info('配置校验通过', {
      module: 'config.validate',
      'config.operation': 'validate_config',
      'config.outcome': 'success',
      'config.path': configPath,
      'config.runtime_dir': runtimeDir,
    })

    const loaded = createCompiledConfigResult({
      validatedInput,
      runtimeDir,
      configPath,
    })
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

    return loaded
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
  return await loadResolvedConfig(options)
}
