import type { ResolvedSourceConfig } from '../config/types.ts'
import type { SourceInputGateway } from '../application/ports/source_input_gateway.ts'
import type { SourceDefinition } from '../domain/source_definition.ts'

export function resolveSourceConfig(
  sourceConfigsById: Record<string, ResolvedSourceConfig>,
  sourceId: string,
): ResolvedSourceConfig {
  const source = sourceConfigsById[sourceId]
  if (!source) {
    throw new Error(`source 未定义: ${sourceId}`)
  }
  return source
}

export function selectSourceInputGateway(
  source: SourceDefinition,
  deps: {
    httpGateway: SourceInputGateway
    byparrGateway: SourceInputGateway
    summaryGateway: SourceInputGateway
  },
): SourceInputGateway {
  if (source.kind === 'summary') return deps.summaryGateway
  return source.fetcher === 'byparr' ? deps.byparrGateway : deps.httpGateway
}
