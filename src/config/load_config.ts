import type { AppConfigResolved } from './types.ts'
import { type LoadConfigOptions, loadCompiledConfig } from './load_compiled_config.ts'

export type { LoadConfigOptions } from './load_compiled_config.ts'
export { findConfigFile, parseRawConfigDocument } from './load_compiled_config.ts'

export async function loadConfig(options: LoadConfigOptions = {}): Promise<AppConfigResolved> {
  const loaded = await loadCompiledConfig(options)
  return loaded.config
}
