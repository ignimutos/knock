import { parseFeed } from 'feedsmith'
import type { SyndicationSourceConfig } from '../config/schema.ts'
import type {
  UnifiedEntryField,
  UnifiedEntryFields,
  UnifiedFeedField,
  UnifiedFeedFields,
} from '../config/types.ts'
import type { AiEntryRuntime, AiRuntime } from '../core/ai_runtime.ts'
import { attachAiEntryRuntime } from '../core/ai_runtime.ts'
import { createLiquidRuntime } from '../core/liquid_runtime.ts'
import {
  type FeedParseOptions,
  isTemplateValue,
  normalizeDefaultDate,
  normalizeDefaultText,
} from './feed_shared.ts'

export interface ParsedSyndicationEntry {
  mapped: UnifiedEntryFields
}

export interface ParsedSyndicationSource {
  feed: UnifiedFeedFields
  entries: ParsedSyndicationEntry[]
  format: 'rss' | 'atom' | 'json'
}

export interface SyndicationParseRuntimeOptions {
  sourceId?: string
  aiRuntime?: AiRuntime
}

type MappingScope = Record<string, string>
type FeedRecord = Record<string, unknown>
type EntryRecord = Record<string, unknown>
type RawFeedDefaults = UnifiedFeedFields

type RawEntryDefaults = {
  id: string
  title: string
  link: string
  description: string
  content: string
  published: string
  updated: string
}

interface TemplateRenderer {
  render(template: string, context: Record<string, unknown>): Promise<string>
}

const FEED_FIELDS: UnifiedFeedField[] = [
  'title',
  'link',
  'description',
  'generator',
  'language',
  'published',
]

const ENTRY_FIELDS: UnifiedEntryField[] = [
  'id',
  'title',
  'link',
  'description',
  'content',
  'published',
  'updated',
]

function detectSyndicationFormat(payload: string): 'rss' | 'atom' | 'json' {
  const text = payload.trim()
  if (text.startsWith('{') || text.startsWith('[')) return 'json'
  if (/<(?:[A-Za-z_][\w.-]*:)?feed(?:\s|>)/i.test(text)) return 'atom'
  if (/<(?:[A-Za-z_][\w.-]*:)?rss(?:\s|>)/i.test(text)) return 'rss'
  if (/<(?:[A-Za-z_][\w.-]*:)?channel(?:\s|>)/i.test(text)) return 'rss'
  throw new Error('无法识别 syndication 类型')
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return ''
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    : []
}

function pickLink(value: unknown): string {
  if (typeof value === 'string') return value
  const record = toRecord(value)
  if (typeof record.href === 'string') return record.href
  if (typeof record.url === 'string') return record.url
  return ''
}

function normalizeLink(value: string): string {
  const text = value.trim()
  if (!text) return ''
  try {
    return new URL(text).toString()
  } catch {
    return text
  }
}

function pickAlternateLink(value: unknown): string {
  const links = toRecordArray(value)
  const alternate = links.find((link) => !link.rel || link.rel === 'alternate')
  return pickLink(alternate ?? links[0])
}

function pickRawFeedDefaults(format: 'rss' | 'atom' | 'json', feed: FeedRecord): RawFeedDefaults {
  const defaults = {
    title: toText(feed.title),
    generator: toText(feed.generator),
    language: toText(feed.language),
  }

  if (format === 'rss') {
    return {
      ...defaults,
      link: normalizeLink(toText(feed.link)),
      description: toText(feed.description),
      published: toText(feed.pubDate),
    }
  }

  if (format === 'atom') {
    return {
      ...defaults,
      link: normalizeLink(pickAlternateLink(feed.links) || toText(feed.link)),
      description: toText(feed.subtitle),
      published: toText(feed.published) || toText(feed.updated),
    }
  }

  return {
    ...defaults,
    link: normalizeLink(toText(feed.home_page_url)),
    description: toText(feed.description),
    published: toText(feed.date_published) || toText(feed.date_modified),
  }
}

function normalizeFeedDefaults(raw: RawFeedDefaults, options: FeedParseOptions): UnifiedFeedFields {
  return {
    title: normalizeDefaultText(raw.title),
    link: normalizeDefaultText(raw.link),
    description: normalizeDefaultText(raw.description),
    generator: normalizeDefaultText(raw.generator),
    language: normalizeDefaultText(raw.language),
    published: normalizeDefaultDate(raw.published, options),
  }
}

function pickRawEntryDefaults(
  format: 'rss' | 'atom' | 'json',
  entry: EntryRecord,
): RawEntryDefaults {
  if (format === 'rss') {
    return {
      id: toText(toRecord(entry.guid).value) || toText(entry.link),
      title: toText(entry.title),
      link: normalizeLink(toText(entry.link)),
      description: toText(entry.description),
      content: toText(toRecord(entry.content).encoded),
      published: toText(entry.pubDate),
      updated: toText(entry.lastBuildDate),
    }
  }

  if (format === 'atom') {
    return {
      id: toText(entry.id),
      title: toText(entry.title),
      link: normalizeLink(pickAlternateLink(entry.links) || toText(entry.link)),
      description: toText(entry.summary),
      content: toText(entry.content),
      published: toText(entry.published) || toText(entry.updated),
      updated: toText(entry.updated),
    }
  }

  return {
    id: toText(entry.id) || toText(entry.url),
    title: toText(entry.title),
    link: normalizeLink(toText(entry.url) || toText(entry.external_url)),
    description: toText(entry.summary),
    content: toText(entry.content_html) || toText(entry.content_text),
    published: toText(entry.date_published) || toText(entry.date_modified),
    updated: toText(entry.date_modified),
  }
}

function normalizeEntryDefaults(
  raw: RawEntryDefaults,
  options: FeedParseOptions,
): UnifiedEntryFields {
  const description = normalizeDefaultText(raw.description)
  const content = normalizeDefaultText(raw.content) || description
  const published = normalizeDefaultDate(raw.published, options)
  const updated = normalizeDefaultDate(raw.updated, options) || published

  return {
    id: normalizeDefaultText(raw.id),
    title: normalizeDefaultText(raw.title),
    link: normalizeDefaultText(raw.link),
    description,
    content,
    published,
    updated,
  }
}

function resolveTemplateDependencies(template: string, candidates: string[]): string[] {
  const dependencies = new Set<string>()
  for (const candidate of candidates) {
    const pattern = new RegExp(`{{\\s*${candidate}(?:\\b|\\s*[|}])`, 'g')
    if (pattern.test(template)) dependencies.add(candidate)
  }
  return [...dependencies]
}

function toMappingScope(values: Record<string, unknown>): MappingScope {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, toText(value)]))
}

function toSyndicationSourceId(sourceId?: string): string {
  const normalized = sourceId?.trim()
  return normalized && normalized !== '' ? normalized : '__syndication__'
}

function createFeedAiEntryRuntime(
  runtimeOptions: SyndicationParseRuntimeOptions,
): AiEntryRuntime | undefined {
  if (!runtimeOptions.aiRuntime) return undefined
  return runtimeOptions.aiRuntime.createEntryRuntime(
    toSyndicationSourceId(runtimeOptions.sourceId),
    '__feed__',
  )
}

function createEntryAiEntryRuntime(
  runtimeOptions: SyndicationParseRuntimeOptions,
  rawDefaults: RawEntryDefaults,
  entryIndex: number,
): AiEntryRuntime | undefined {
  if (!runtimeOptions.aiRuntime) return undefined
  return runtimeOptions.aiRuntime.createEntryRuntime(
    toSyndicationSourceId(runtimeOptions.sourceId),
    normalizeDefaultText(rawDefaults.id) || `__entry_${entryIndex}`,
  )
}

async function renderTemplate(
  renderer: TemplateRenderer,
  template: string,
  context: Record<string, unknown>,
  aiEntryRuntime?: AiEntryRuntime,
): Promise<string> {
  return await renderer.render(template, attachAiEntryRuntime(context, aiEntryRuntime))
}

async function resolveCustomMapping(
  customMapping: Record<string, string>,
  baseScope: MappingScope,
  extras: Record<string, unknown>,
  renderer: TemplateRenderer,
  aiEntryRuntime?: AiEntryRuntime,
): Promise<MappingScope> {
  const keys = Object.keys(customMapping)
  if (keys.length === 0) return {}

  const dependencies = new Map<string, string[]>()
  for (const key of keys) {
    const template = customMapping[key]
    dependencies.set(
      key,
      isTemplateValue(template) ? resolveTemplateDependencies(template, keys) : [],
    )
  }

  const resolved: MappingScope = {}
  const pending = new Set(keys)

  while (pending.size > 0) {
    let progressed = false
    for (const key of [...pending]) {
      const deps = dependencies.get(key) ?? []
      if (deps.some((dep) => pending.has(dep))) continue

      const template = customMapping[key]
      resolved[key] = isTemplateValue(template)
        ? await renderTemplate(
            renderer,
            template,
            {
              ...baseScope,
              ...resolved,
              ...extras,
            },
            aiEntryRuntime,
          )
        : template

      pending.delete(key)
      progressed = true
    }

    if (!progressed) {
      throw new Error('存在循环依赖')
    }
  }

  return resolved
}

async function renderFeedMapping(
  rawDefaults: RawFeedDefaults,
  normalizedDefaults: UnifiedFeedFields,
  mapping: SyndicationSourceConfig['feed'],
  renderer: TemplateRenderer,
  aiEntryRuntime?: AiEntryRuntime,
): Promise<UnifiedFeedFields> {
  if (!mapping) return { ...normalizedDefaults }

  const customMapping = Object.fromEntries(
    Object.entries(mapping).filter(([key]) => !FEED_FIELDS.includes(key as UnifiedFeedField)),
  )
  const baseScope = toMappingScope({ ...rawDefaults })
  const customValues = await resolveCustomMapping(
    customMapping,
    baseScope,
    {
      feed: rawDefaults,
    },
    renderer,
    aiEntryRuntime,
  )
  const scope: MappingScope = { ...baseScope, ...customValues }
  const output: UnifiedFeedFields = { ...normalizedDefaults }

  for (const key of FEED_FIELDS) {
    const value = mapping[key]
    if (!value) continue
    output[key] = isTemplateValue(value)
      ? await renderTemplate(
          renderer,
          value,
          {
            ...scope,
            feed: { ...rawDefaults, ...customValues, ...output },
          },
          aiEntryRuntime,
        )
      : value
  }

  return output
}

async function renderEntryMapping(
  rawDefaults: RawEntryDefaults,
  normalizedDefaults: UnifiedEntryFields,
  mapping: SyndicationSourceConfig['entry'],
  feed: UnifiedFeedFields,
  renderer: TemplateRenderer,
  aiEntryRuntime?: AiEntryRuntime,
): Promise<UnifiedEntryFields> {
  if (!mapping) return { ...normalizedDefaults }

  const customMapping = Object.fromEntries(
    Object.entries(mapping).filter(([key]) => !ENTRY_FIELDS.includes(key as UnifiedEntryField)),
  )
  const baseScope = toMappingScope({ ...rawDefaults })
  const customValues = await resolveCustomMapping(
    customMapping,
    baseScope,
    {
      feed,
      entry: rawDefaults,
    },
    renderer,
    aiEntryRuntime,
  )
  const scope: MappingScope = { ...baseScope, ...customValues }
  const output: UnifiedEntryFields = { ...normalizedDefaults }

  for (const key of ENTRY_FIELDS) {
    const value = mapping[key]
    if (!value) continue
    output[key] = isTemplateValue(value)
      ? await renderTemplate(
          renderer,
          value,
          {
            ...scope,
            entry: { ...rawDefaults, ...customValues, ...output },
            feed,
          },
          aiEntryRuntime,
        )
      : value
  }

  return output
}

function extractNormalizedFeed(
  payload: string,
  format: 'rss' | 'atom' | 'json',
): { feed: FeedRecord; entries: EntryRecord[] } {
  const parsed = parseFeed(payload)
  const feed = toRecord(parsed.feed)

  if (format === 'atom') {
    return { feed, entries: toRecordArray(feed.entries) }
  }

  return { feed, entries: toRecordArray(feed.items) }
}

export async function parseSyndicationSource(
  payload: string,
  mapping: SyndicationSourceConfig = {},
  options: FeedParseOptions = {},
  runtimeOptions: SyndicationParseRuntimeOptions = {},
): Promise<ParsedSyndicationSource> {
  const format = detectSyndicationFormat(payload)
  const parsed = extractNormalizedFeed(payload, format)
  const rawFeedDefaults = pickRawFeedDefaults(format, parsed.feed)
  const feedDefaults = normalizeFeedDefaults(rawFeedDefaults, options)
  const liquidRuntime = createLiquidRuntime({ aiRuntime: runtimeOptions.aiRuntime })
  const renderer: TemplateRenderer = {
    render(template, context) {
      return liquidRuntime.render(template, context)
    },
  }
  const feed = await renderFeedMapping(
    rawFeedDefaults,
    feedDefaults,
    mapping.feed,
    renderer,
    createFeedAiEntryRuntime(runtimeOptions),
  )
  const entries: ParsedSyndicationEntry[] = []

  for (const [entryIndex, item] of parsed.entries.entries()) {
    const rawDefaults = pickRawEntryDefaults(format, item)
    const defaults = normalizeEntryDefaults(rawDefaults, options)
    entries.push({
      mapped: await renderEntryMapping(
        rawDefaults,
        defaults,
        mapping.entry,
        feed,
        renderer,
        createEntryAiEntryRuntime(runtimeOptions, rawDefaults, entryIndex),
      ),
    })
  }

  return {
    feed,
    entries,
    format,
  }
}
