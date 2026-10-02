export type SourceDefinition = FetchSourceDefinition | SummarySourceDefinition

export interface FetchSourceDefinition {
  kind: 'fetch'
  sourceId: string
  fetcher: 'http' | 'byparr'
  parser: 'syndication' | 'xquery'
  filter?: string
}

export interface SummarySourceDefinition {
  kind: 'summary'
  sourceId: string
  upstreamSourceIds: string[]
  filter?: string
}

export function isFetchSourceDefinition(
  definition: SourceDefinition,
): definition is FetchSourceDefinition {
  return definition.kind === 'fetch'
}

export function isSummarySourceDefinition(
  definition: SourceDefinition,
): definition is SummarySourceDefinition {
  return definition.kind === 'summary'
}
