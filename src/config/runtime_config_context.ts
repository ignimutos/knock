import {
  getConfigDocumentLookupFromEnv,
  loadRawConfigDocument,
  writeValidatedConfigDocument,
  type ConfigDocumentLookup,
  type RawConfigDocumentLoadResult,
} from './raw_config_document.ts'
import {
  loadCompiledConfig,
  type LoadCompiledConfigOptions,
  type LoadedCompiledConfig,
} from './load_compiled_config.ts'

export interface ConfigRuntimeContext {
  rawDocument: RawConfigDocumentLoadResult
  loaded: LoadedCompiledConfig
}

export interface LoadConfigRuntimeContextOptions {
  lookup?: ConfigDocumentLookup
  envMode?: LoadCompiledConfigOptions['envMode']
}

export async function loadConfigRuntimeContext(
  options: LoadConfigRuntimeContextOptions = {},
): Promise<ConfigRuntimeContext> {
  const lookup = options.lookup ?? getConfigDocumentLookupFromEnv()
  const rawDocument = await loadRawConfigDocument(lookup)
  const loaded = await loadCompiledConfig({
    runtimeDir: rawDocument.runtimeDir,
    configPath: rawDocument.configPath,
    envMode: options.envMode,
  })

  return {
    rawDocument,
    loaded,
  }
}

export async function writeConfigRuntimeContext(
  rawDocument: RawConfigDocumentLoadResult,
): Promise<ConfigRuntimeContext> {
  return {
    rawDocument,
    loaded: await writeValidatedConfigDocument(rawDocument),
  }
}
