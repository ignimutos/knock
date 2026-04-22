import type { SourceByparrConfig, SourceConfigInput, SourceHttpConfig } from './schema.ts'

function cloneSourceHttpConfig(input?: SourceHttpConfig): SourceHttpConfig | undefined {
  if (!input) return undefined

  return {
    ...input,
    headers: input.headers ? { ...input.headers } : undefined,
  }
}

function cloneSourceByparrConfig(input?: SourceByparrConfig): SourceByparrConfig | undefined {
  if (!input) return undefined
  return { ...input }
}

export function cloneSourceSummaryConfig(
  input?: SourceConfigInput['summary'],
): SourceConfigInput['summary'] | undefined {
  if (!input) return undefined

  return {
    sources: [...input.sources],
    feed: input.feed ? { ...input.feed } : undefined,
    entry: input.entry ? { ...input.entry } : undefined,
  }
}

export function normalizeSources(
  value: Record<string, SourceConfigInput>,
): Array<SourceConfigInput & { id: string }> {
  return Object.entries(value).map(([id, source]) => ({
    ...source,
    id,
    http: cloneSourceHttpConfig(source.http),
    byparr: cloneSourceByparrConfig(source.byparr),
    summary: cloneSourceSummaryConfig(source.summary),
  }))
}
