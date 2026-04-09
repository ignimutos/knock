import { parseFeed } from 'feedsmith'
import type { SyndicationSourceConfig } from '../config/schema.ts'
import type {
  UnifiedEntryField,
  UnifiedEntryFields,
  UnifiedFeedField,
  UnifiedFeedFields,
} from '../config/types.ts'
import { renderLiquidSync } from '../core/liquid_runtime.ts'
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

function resolveCustomMapping(
  customMapping: Record<string, string>,
  baseScope: MappingScope,
  extras: Record<string, unknown>,
): MappingScope {
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
        ? renderLiquidSync(template, {
            ...baseScope,
            ...resolved,
            ...extras,
          })
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

function renderFeedMapping(
  rawDefaults: RawFeedDefaults,
  normalizedDefaults: UnifiedFeedFields,
  mapping: SyndicationSourceConfig['feed'],
): UnifiedFeedFields {
  if (!mapping) return { ...normalizedDefaults }

  const customMapping = Object.fromEntries(
    Object.entries(mapping).filter(([key]) => !FEED_FIELDS.includes(key as UnifiedFeedField)),
  )
  const baseScope = toMappingScope({ ...rawDefaults })
  const customValues = resolveCustomMapping(customMapping, baseScope, {
    feed: rawDefaults,
  })
  const scope: MappingScope = { ...baseScope, ...customValues }
  const output: UnifiedFeedFields = { ...normalizedDefaults }

  for (const key of FEED_FIELDS) {
    const value = mapping[key]
    if (!value) continue
    output[key] = isTemplateValue(value)
      ? renderLiquidSync(value, {
          ...scope,
          feed: { ...rawDefaults, ...customValues, ...output },
        })
      : value
  }

  return output
}

function renderEntryMapping(
  rawDefaults: RawEntryDefaults,
  normalizedDefaults: UnifiedEntryFields,
  mapping: SyndicationSourceConfig['entry'],
  feed: UnifiedFeedFields,
): UnifiedEntryFields {
  if (!mapping) return { ...normalizedDefaults }

  const customMapping = Object.fromEntries(
    Object.entries(mapping).filter(([key]) => !ENTRY_FIELDS.includes(key as UnifiedEntryField)),
  )
  const baseScope = toMappingScope({ ...rawDefaults })
  const customValues = resolveCustomMapping(customMapping, baseScope, {
    feed,
    entry: rawDefaults,
  })
  const scope: MappingScope = { ...baseScope, ...customValues }
  const output: UnifiedEntryFields = { ...normalizedDefaults }

  for (const key of ENTRY_FIELDS) {
    const value = mapping[key]
    if (!value) continue
    output[key] = isTemplateValue(value)
      ? renderLiquidSync(value, {
          ...scope,
          entry: { ...rawDefaults, ...customValues, ...output },
          feed,
        })
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

export function parseSyndicationSource(
  payload: string,
  mapping: SyndicationSourceConfig = {},
  options: FeedParseOptions = {},
): ParsedSyndicationSource {
  const format = detectSyndicationFormat(payload)
  const parsed = extractNormalizedFeed(payload, format)
  const rawFeedDefaults = pickRawFeedDefaults(format, parsed.feed)
  const feedDefaults = normalizeFeedDefaults(rawFeedDefaults, options)
  const feed = renderFeedMapping(rawFeedDefaults, feedDefaults, mapping.feed)
  const entries = parsed.entries.map((item) => {
    const rawDefaults = pickRawEntryDefaults(format, item)
    const defaults = normalizeEntryDefaults(rawDefaults, options)
    return {
      mapped: renderEntryMapping(rawDefaults, defaults, mapping.entry, feed),
    }
  })

  return {
    feed,
    entries,
    format,
  }
}
