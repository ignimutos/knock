import { dirname, join, resolve } from '@std/path'
import { stringify } from '@std/yaml'
import {
  compileConfigDocument,
  findConfigFile,
  parseRawConfigDocument,
  type LoadedCompiledConfig,
} from './load_compiled_config.ts'

export interface ConfigDocumentLookup {
  runtimeDir: string
  configPath?: string
}

export interface RawConfigDocumentLoadResult {
  runtimeDir: string
  configPath: string
  document: Record<string, unknown>
}

export function getConfigDocumentLookupFromEnv(): ConfigDocumentLookup {
  const configPath = Deno.env.get('KNOCK_CONFIG_PATH')
  if (configPath) {
    const resolvedConfigPath = resolve(configPath)
    return {
      runtimeDir: dirname(resolvedConfigPath),
      configPath: resolvedConfigPath,
    }
  }

  return {
    runtimeDir: resolve(Deno.env.get('KNOCK_RUNTIME_DIR') ?? join(Deno.cwd(), 'runtime')),
  }
}

export async function loadRawConfigDocument(
  lookup: ConfigDocumentLookup,
): Promise<RawConfigDocumentLoadResult> {
  const configPath = lookup.configPath ?? (await findConfigFile(lookup.runtimeDir))
  const raw = await Deno.readTextFile(configPath)

  return {
    runtimeDir: lookup.runtimeDir,
    configPath,
    document: parseRawConfigDocument(raw),
  }
}

export async function writeValidatedConfigDocument(input: {
  document: Record<string, unknown>
  runtimeDir: string
  configPath: string
}): Promise<LoadedCompiledConfig> {
  const compiled = compileConfigDocument({
    document: input.document,
    runtimeDir: input.runtimeDir,
    configPath: input.configPath,
    envMode: 'preserve_unknown',
  })
  await Deno.writeTextFile(input.configPath, stringify(input.document))
  return compiled
}
