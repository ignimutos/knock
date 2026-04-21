import type { AppConfigResolved } from '../config/types.ts'
import {
  compileCanonicalDeliveryDefinitions,
  compileSourceBindings,
  compileSourceDefinitions,
} from './definition_compiler_support.ts'
import type { DefinitionSet } from './definition_set.ts'

export function compileDefinitionsFromResolvedConfig(config: AppConfigResolved): DefinitionSet {
  return {
    sources: compileSourceDefinitions(config),
    deliveries: compileCanonicalDeliveryDefinitions(config),
    bindings: compileSourceBindings(config),
  }
}
