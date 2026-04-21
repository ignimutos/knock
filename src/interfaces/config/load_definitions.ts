import type { LoadConfigOptions } from '../../config/load_compiled_config.ts'
import { loadCompiledConfig } from '../../config/load_compiled_config.ts'
import { compileDefinitionsFromResolvedConfig } from '../../definitions/compile_definitions.ts'
import type { AppConfigResolved } from '../../config/types.ts'
import type { DefinitionSet } from '../../definitions/definition_set.ts'

export type LoadedDefinitions = DefinitionSet

export function buildLoadedDefinitionsFromResolvedConfig(
  config: AppConfigResolved,
): LoadedDefinitions {
  return compileDefinitionsFromResolvedConfig(config)
}

export async function loadDefinitions(options: LoadConfigOptions = {}): Promise<LoadedDefinitions> {
  const loaded = await loadCompiledConfig(options)
  return loaded.definitions
}
