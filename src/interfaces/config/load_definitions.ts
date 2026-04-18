import type { LoadConfigOptions } from '../../config/load_config.ts'
import { loadConfig } from '../../config/load_config.ts'
import { compileDefinitionsFromResolvedConfig } from '../../definitions/compile_definitions.ts'
import type { AppConfigResolved } from '../../config/types.ts'
import type { DefinitionSet } from '../../definitions/definition_set.ts'

export type LoadedDefinitions = Pick<
  DefinitionSet,
  'sources' | 'deliveries' | 'bindings' | 'sourceConfigsById'
>

export function buildLoadedDefinitionsFromResolvedConfig(
  config: AppConfigResolved,
): LoadedDefinitions {
  const { policies: _ignoredPolicies, ...loadedDefinitions } =
    compileDefinitionsFromResolvedConfig(config)
  return loadedDefinitions
}

export async function loadDefinitions(options: LoadConfigOptions = {}): Promise<LoadedDefinitions> {
  const config = await loadConfig(options)
  return buildLoadedDefinitionsFromResolvedConfig(config)
}
