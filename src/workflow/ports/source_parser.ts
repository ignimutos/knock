import type { UnifiedEntryFields, UnifiedFeedFields } from '../../config/types.ts'
import type { RunPlan } from '../../domain/run_plan.ts'
import type { FetchedSourceInput } from './source_input_gateway.ts'

export interface SourceParserDiagnostic {
  level: 'info' | 'warn' | 'error'
  code: string
  message: string
}

export interface ParsedSourceSnapshot {
  sourceKind: 'fetch' | 'summary'
  parser: 'rss' | 'atom' | 'json' | 'xquery' | 'summary'
  diagnostics: SourceParserDiagnostic[]
  feed: UnifiedFeedFields
  items: UnifiedEntryFields[]
}

export interface SourceParser {
  parse(plan: RunPlan, input: FetchedSourceInput): Promise<ParsedSourceSnapshot>
}
