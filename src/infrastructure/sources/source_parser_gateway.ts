import type {
  ResolvedSourceConfig,
  UnifiedEntryFields,
  UnifiedFeedFields,
} from '../../config/types.ts'
import type { ContentRuntime } from '../../core/content_runtime.ts'
import type { AiRuntime } from '../../core/ai_runtime.ts'
import type { SummaryQueryService } from '../sqlite/summary_query_service.ts'
import type { SummarySourceDefinition } from '../../domain/source_definition.ts'
import type { ParsedSourceSnapshot, SourceParser } from '../../application/ports/source_parser.ts'
import type { FetchedSourceInput } from '../../application/ports/source_input_gateway.ts'
import type { RunPlan } from '../../domain/run_plan.ts'
import type { Logger } from '../../core/logger.ts'
import { buildSummarySource } from '../../sources/summary.ts'
import { parseSyndicationSource } from '../../sources/syndication.ts'
import { parseXquerySource } from '../../sources/xquery.ts'

export interface SourceParserGatewayDeps {
  resolveSourceConfig(sourceId: string): ResolvedSourceConfig
  timeOptions: {
    timezone: string
    timestampFormat: string
  }
  language: string
  aiRuntime?: AiRuntime
  summaryQueryService?: SummaryQueryService
  contentRuntime?: ContentRuntime
  logger?: Logger
}

function toParsedSourceSnapshot(input: {
  sourceKind: 'fetch' | 'summary'
  parser: 'rss' | 'atom' | 'json' | 'xquery' | 'summary'
  feed: ParsedSourceSnapshot['feed']
  items: ParsedSourceSnapshot['items']
}): ParsedSourceSnapshot {
  return {
    sourceKind: input.sourceKind,
    parser: input.parser,
    diagnostics: [],
    feed: input.feed,
    items: input.items,
  }
}

function createEmptyFeed(): UnifiedFeedFields {
  return {
    title: '',
    link: '',
    description: '',
    generator: '',
    language: '',
    published: '',
  }
}

function createEmptyEntry(): UnifiedEntryFields {
  return {
    id: '',
    title: '',
    link: '',
    description: '',
    content: '',
    published: '',
    updated: '',
  }
}

function normalizeXqueryFeed(mapped: Record<string, string>): UnifiedFeedFields {
  const feed = createEmptyFeed()
  return {
    title: mapped.title ?? feed.title,
    link: mapped.link ?? feed.link,
    description: mapped.description ?? feed.description,
    generator: mapped.generator ?? feed.generator,
    language: mapped.language ?? feed.language,
    published: mapped.published ?? feed.published,
  }
}

function normalizeXqueryEntry(mapped: Record<string, string>): UnifiedEntryFields {
  const entry = createEmptyEntry()
  return {
    id: mapped.id ?? entry.id,
    title: mapped.title ?? entry.title,
    link: mapped.link ?? entry.link,
    description: mapped.description ?? entry.description,
    content: mapped.content ?? entry.content,
    published: mapped.published ?? entry.published,
    updated: mapped.updated ?? entry.updated,
  }
}

function getSummaryDeps(deps: SourceParserGatewayDeps): {
  summaryQueryService: SummaryQueryService
  contentRuntime: ContentRuntime
} {
  if (!deps.summaryQueryService || !deps.contentRuntime) {
    throw new Error('summary parser 缺少 summaryQueryService 或 contentRuntime')
  }

  return {
    summaryQueryService: deps.summaryQueryService,
    contentRuntime: deps.contentRuntime,
  }
}

async function parseSummary(
  deps: SourceParserGatewayDeps,
  plan: RunPlan,
  source: SummarySourceDefinition,
): Promise<ParsedSourceSnapshot> {
  const config = deps.resolveSourceConfig(source.sourceId)
  const summaryDeps = getSummaryDeps(deps)
  const parsed = await buildSummarySource({
    source: config,
    upstreamSourceIds: source.upstreamSourceIds,
    scheduledAt: plan.scheduledAt,
    language: deps.language,
    effectDomain: plan.effectDomain,
    summaryQueryService: summaryDeps.summaryQueryService,
    contentRuntime: summaryDeps.contentRuntime,
  })

  return toParsedSourceSnapshot({
    sourceKind: 'summary',
    parser: 'summary',
    feed: parsed.feedMapped,
    items: parsed.entries.map((entry) => entry.mapped),
  })
}

export class SourceParserGateway implements SourceParser {
  constructor(private readonly deps: SourceParserGatewayDeps) {}

  private logParseSuccess(
    sourceId: string,
    parser: ParsedSourceSnapshot['parser'],
    itemCount: number,
  ): void {
    this.deps.logger?.info('source 解析完成', {
      module: 'source.parse',
      'source.operation': 'parse_payload',
      'source.outcome': 'success',
      'source.id': sourceId,
      'source.parser': parser,
      'source.item_count': itemCount,
    })
  }

  private logParseFailure(sourceId: string, error: unknown): void {
    const normalizedError = error instanceof Error ? error : new Error(String(error))
    this.deps.logger?.error('source 解析失败', {
      module: 'source.parse',
      'source.operation': 'parse_payload',
      'source.outcome': 'failure',
      'source.id': sourceId,
      error_name: normalizedError.name,
      error_message: 'source parser failed',
    })
  }

  async parse(plan: RunPlan, input: FetchedSourceInput): Promise<ParsedSourceSnapshot> {
    const config = this.deps.resolveSourceConfig(plan.source.sourceId)

    try {
      if (plan.source.kind === 'summary') {
        const parsed = await parseSummary(this.deps, plan, plan.source)
        this.logParseSuccess(config.id, parsed.parser, parsed.items.length)
        return parsed
      }

      if (plan.source.parser === 'syndication') {
        if (!config.syndication) {
          throw new Error(`source ${config.id} 缺少 syndication parser 配置`)
        }

        const parsed = await parseSyndicationSource(
          input.rawText ?? '',
          config.syndication,
          this.deps.timeOptions,
          {
            sourceId: config.id,
            aiRuntime: this.deps.aiRuntime,
          },
        )

        const snapshot = toParsedSourceSnapshot({
          sourceKind: 'fetch',
          parser: parsed.format,
          feed: parsed.feed,
          items: parsed.entries.map((entry) => entry.mapped),
        })
        this.logParseSuccess(config.id, snapshot.parser, snapshot.items.length)
        return snapshot
      }

      if (plan.source.parser === 'xquery') {
        if (!config.xquery) {
          throw new Error(`source ${config.id} 缺少 xquery parser 配置`)
        }

        const parsed = parseXquerySource(input.rawText ?? '', config.xquery)
        const snapshot = toParsedSourceSnapshot({
          sourceKind: 'fetch',
          parser: 'xquery',
          feed: normalizeXqueryFeed(parsed.feed.mapped),
          items: parsed.entries.map((entry) => normalizeXqueryEntry(entry.mapped)),
        })
        this.logParseSuccess(config.id, snapshot.parser, snapshot.items.length)
        return snapshot
      }

      throw new Error(`source ${config.id} 使用了未知 parser`)
    } catch (error) {
      this.logParseFailure(config.id, error)
      throw error
    }
  }
}
