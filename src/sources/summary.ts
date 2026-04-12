import type {
  ResolvedSourceConfig,
  UnifiedEntryFields,
  UnifiedFeedFields,
} from '../config/types.ts'
import type { AiEntryRuntime } from '../core/ai_runtime.ts'
import { attachAiEntryRuntime } from '../core/ai_runtime.ts'
import type { ContentContext, ContentRuntime } from '../core/content_runtime.ts'
import { attachLogFields } from '../core/logger.ts'
import type { SourceStateQuery, SummarySourceInput } from '../db/source_state_query.ts'
import type { FetchedParsedSourceResult, ParsedSourceEntry } from './source_runtime.ts'

interface SummaryWindow {
  previousCheckpoint?: string
  scheduledAt: string
}

export interface BuildSummarySourceInput {
  source: ResolvedSourceConfig
  scheduledAt: string
  language: string
  stateQuery: SourceStateQuery
  contentRuntime: ContentRuntime
}

function getSourceDisplayName(source: ResolvedSourceConfig): string {
  return source.name?.trim() || source.id
}

function buildDefaultFeed(
  source: ResolvedSourceConfig,
  scheduledAt: string,
  language: string,
): UnifiedFeedFields {
  return {
    title: getSourceDisplayName(source),
    link: '',
    description: '',
    generator: 'knock.summary',
    language,
    published: scheduledAt,
  }
}

function buildDefaultEntry(
  source: ResolvedSourceConfig,
  window: SummaryWindow,
): UnifiedEntryFields {
  return {
    id: `${source.id}:${window.previousCheckpoint ?? ''}..${window.scheduledAt}`,
    title: getSourceDisplayName(source),
    link: '',
    description: '',
    content: '',
    published: window.scheduledAt,
    updated: window.scheduledAt,
  }
}

function buildRuntimeAwareSource(
  source: ResolvedSourceConfig,
  window: SummaryWindow,
): ResolvedSourceConfig & {
  runtime: {
    window: {
      previousCheckpoint?: string
      scheduledAt: string
    }
  }
} {
  return {
    ...source,
    summary: source.summary
      ? {
          ...source.summary,
          sources: [...source.summary.sources],
          feed: source.summary.feed ? { ...source.summary.feed } : undefined,
          entry: source.summary.entry ? { ...source.summary.entry } : undefined,
        }
      : undefined,
    runtime: {
      window: {
        previousCheckpoint: window.previousCheckpoint,
        scheduledAt: window.scheduledAt,
      },
    },
  }
}

function buildSummaryPayload(
  source: ResolvedSourceConfig,
  scheduledAt: string,
  previousCheckpoint?: string,
): string {
  return JSON.stringify({
    kind: 'summary',
    sourceId: source.id,
    sourceIds: source.summary?.sources ?? [],
    previousCheckpoint: previousCheckpoint ?? null,
    scheduledAt,
  })
}

function createSummaryAiEntryRuntime(sourceId: string, entryId: string): AiEntryRuntime {
  return {
    sourceId,
    entryId,
    cache: new Map<string, Promise<string>>(),
  }
}

function buildSummaryTemplateContext(
  source: ResolvedSourceConfig,
  feed: UnifiedFeedFields,
  entry: UnifiedEntryFields,
  inputs: Record<string, SummarySourceInput>,
  window: SummaryWindow,
  aiEntryRuntime?: AiEntryRuntime,
): ContentContext {
  const runtimeAwareSource = buildRuntimeAwareSource(source, window)
  return attachAiEntryRuntime(
    attachLogFields(
      {
        ...entry,
        entry,
        feed,
        source: runtimeAwareSource,
        sources: inputs,
      },
      {
        'source.id': source.id,
        ...(aiEntryRuntime?.entryId ? { 'pipeline.item_id': aiEntryRuntime.entryId } : {}),
      },
    ),
    aiEntryRuntime,
  )
}

async function renderFeedMapped(
  source: ResolvedSourceConfig,
  feed: UnifiedFeedFields,
  entry: UnifiedEntryFields,
  inputs: Record<string, SummarySourceInput>,
  window: SummaryWindow,
  contentRuntime: ContentRuntime,
): Promise<UnifiedFeedFields> {
  const overrides = source.summary?.feed
  if (!overrides) return feed

  const context = buildSummaryTemplateContext(
    source,
    feed,
    entry,
    inputs,
    window,
    createSummaryAiEntryRuntime(source.id, entry.id),
  )

  const rendered = { ...feed }
  for (const [key, template] of Object.entries(overrides)) {
    rendered[key as keyof UnifiedFeedFields] = await contentRuntime.renderContent(template, context)
  }
  return rendered
}

async function renderEntryMapped(
  source: ResolvedSourceConfig,
  feed: UnifiedFeedFields,
  entry: UnifiedEntryFields,
  inputs: Record<string, SummarySourceInput>,
  window: SummaryWindow,
  contentRuntime: ContentRuntime,
): Promise<UnifiedEntryFields> {
  const overrides = source.summary?.entry
  if (!overrides) return entry

  const context = buildSummaryTemplateContext(
    source,
    feed,
    entry,
    inputs,
    window,
    createSummaryAiEntryRuntime(source.id, entry.id),
  )

  const rendered = { ...entry }
  for (const [key, template] of Object.entries(overrides)) {
    rendered[key as keyof UnifiedEntryFields] = await contentRuntime.renderContent(
      template,
      context,
    )
  }
  return rendered
}

export async function buildSummarySource(
  input: BuildSummarySourceInput,
): Promise<FetchedParsedSourceResult> {
  const previousCheckpoint = await input.stateQuery.getSummaryCheckpoint(input.source.id)
  const window: SummaryWindow = {
    previousCheckpoint,
    scheduledAt: input.scheduledAt,
  }
  const summaryInputs = previousCheckpoint
    ? await input.stateQuery.getSummaryInputs(input.source.summary?.sources ?? [], {
        after: previousCheckpoint,
        atOrBefore: input.scheduledAt,
      })
    : Object.fromEntries(
        (input.source.summary?.sources ?? []).map((sourceId) => [
          sourceId,
          { name: '', feed: {}, entries: [] },
        ]),
      )

  const defaultFeed = buildDefaultFeed(input.source, input.scheduledAt, input.language)
  const defaultEntry = buildDefaultEntry(input.source, window)
  const feedMapped = previousCheckpoint
    ? await renderFeedMapped(
        input.source,
        defaultFeed,
        defaultEntry,
        summaryInputs,
        window,
        input.contentRuntime,
      )
    : defaultFeed

  const entries: ParsedSourceEntry[] = []
  if (previousCheckpoint) {
    const entryMapped = await renderEntryMapped(
      input.source,
      feedMapped,
      defaultEntry,
      summaryInputs,
      window,
      input.contentRuntime,
    )
    entries.push({ mapped: entryMapped })
  }

  return {
    payload: buildSummaryPayload(input.source, input.scheduledAt, previousCheckpoint),
    timing: {
      fetchDurationMs: 0,
      parseDurationMs: 0,
    },
    feedMapped,
    entries,
    parser: 'summary',
    observedAt: input.scheduledAt,
  }
}
