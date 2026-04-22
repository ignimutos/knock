import type { SourceDeliveryOverride } from './types.ts'

export interface SourceConfigDocumentUpdate {
  sourceId: string
  name: string
  enabled: boolean
  schedule: string
  filter: string
  deliveryIds: string[]
  deliveryOverrides: Record<string, SourceDeliveryOverride>
  transport: 'http' | 'byparr' | 'summary'
  parser: 'syndication' | 'xquery' | 'summary'
  targetUrl: string
  xqueryLocate: string
  xqueryEntryId: string
}

export class SourceConfigDocumentUpdateError extends Error {
  constructor(
    message: string,
    readonly kind: 'validation' | 'not_found',
  ) {
    super(message)
    this.name = 'SourceConfigDocumentUpdateError'
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function throwValidation(message: string): never {
  throw new SourceConfigDocumentUpdateError(message, 'validation')
}

function throwNotFound(message: string): never {
  throw new SourceConfigDocumentUpdateError(message, 'not_found')
}

function getDocumentSources(document: Record<string, unknown>): Record<string, unknown> {
  const sources = document.sources
  if (!isPlainObject(sources)) {
    throwValidation('sources 配置非法')
  }
  return sources
}

function getMutableSourceDocument(
  document: Record<string, unknown>,
  sourceId: string,
): Record<string, unknown> {
  const sources = getDocumentSources(document)
  const source = sources[sourceId]
  if (!isPlainObject(source)) {
    throwNotFound(`source 未定义: ${sourceId}`)
  }
  return source
}

function setOptionalTrimmedString(
  target: Record<string, unknown>,
  key: string,
  value: string,
): void {
  const trimmed = value.trim()
  if (trimmed === '') {
    delete target[key]
    return
  }
  target[key] = trimmed
}

function updateDeliveryOverrides(
  source: Record<string, unknown>,
  nextDeliveryIds: string[],
  nextOverrides: Record<string, SourceDeliveryOverride>,
): void {
  const existing = isPlainObject(source.deliveries) ? source.deliveries : {}
  const next: Record<string, unknown> = {}

  for (const deliveryId of nextDeliveryIds) {
    const fallback = isPlainObject(existing[deliveryId])
      ? structuredClone(existing[deliveryId])
      : {}
    const override = nextOverrides[deliveryId]
    next[deliveryId] = override ? structuredClone(override) : fallback
  }

  if (Object.keys(next).length === 0) {
    delete source.deliveries
    return
  }

  source.deliveries = next
}

function buildByparrSourceConfig(
  source: Record<string, unknown>,
  nextTargetUrl: string,
): Record<string, unknown> {
  const current = isPlainObject(source.byparr) ? structuredClone(source.byparr) : {}
  const resolvedUrl =
    nextTargetUrl.trim() || (typeof current.url === 'string' ? current.url.trim() : '')
  if (resolvedUrl === '') {
    throwValidation('source.byparr.url 必填')
  }

  return {
    endpoint: 'http://byparr:8191/v1',
    cmd: 'request.get',
    maxTimeout: '60s',
    ...current,
    url: resolvedUrl,
  }
}

function buildHttpSourceConfig(
  source: Record<string, unknown>,
  nextTargetUrl: string,
): Record<string, unknown> {
  const current = isPlainObject(source.http) ? structuredClone(source.http) : {}
  const resolvedUrl =
    nextTargetUrl.trim() || (typeof current.url === 'string' ? current.url.trim() : '')
  if (resolvedUrl === '') {
    throwValidation('source.http.url 必填')
  }

  return {
    ...current,
    url: resolvedUrl,
  }
}

function updateFetchSourceConfig(
  source: Record<string, unknown>,
  input: SourceConfigDocumentUpdate,
): void {
  if (input.transport === 'summary' || input.parser === 'summary') {
    throwValidation('fetch source 不支持 summary transport 或 parser')
  }

  if (input.transport === 'http') {
    source.http = buildHttpSourceConfig(source, input.targetUrl)
    delete source.byparr
  } else {
    source.byparr = buildByparrSourceConfig(source, input.targetUrl)
    delete source.http
  }

  if (input.parser === 'syndication') {
    source.syndication = isPlainObject(source.syndication)
      ? structuredClone(source.syndication)
      : {}
    delete source.xquery
    return
  }

  const currentXquery = isPlainObject(source.xquery) ? structuredClone(source.xquery) : {}
  const currentEntry = currentXquery.entry
  const nextEntryId = input.xqueryEntryId.trim()

  if (typeof currentEntry === 'string') {
    if (nextEntryId !== '') {
      currentXquery.entry = { id: nextEntryId }
    }
  } else {
    const nextEntry = isPlainObject(currentEntry) ? { ...currentEntry } : {}
    const resolvedEntryId =
      nextEntryId || (typeof nextEntry.id === 'string' ? nextEntry.id.trim() : '')
    if (resolvedEntryId === '') {
      throwValidation('xquery.entry.id 必填')
    }
    nextEntry.id = resolvedEntryId
    currentXquery.entry = nextEntry
  }

  const nextLocate = input.xqueryLocate.trim()
  if (nextLocate === '') {
    delete currentXquery.locate
  } else {
    currentXquery.locate = nextLocate
  }

  source.xquery = currentXquery
  delete source.syndication
}

export function applySourceConfigDocumentUpdate(
  document: Record<string, unknown>,
  input: SourceConfigDocumentUpdate,
): void {
  const source = getMutableSourceDocument(document, input.sourceId)

  setOptionalTrimmedString(source, 'name', input.name)
  source.enabled = input.enabled
  setOptionalTrimmedString(source, 'schedule', input.schedule)
  setOptionalTrimmedString(source, 'filter', input.filter)
  updateDeliveryOverrides(source, input.deliveryIds, input.deliveryOverrides)

  if ('summary' in source && source.summary !== undefined) {
    if (input.transport !== 'summary' || input.parser !== 'summary') {
      throwValidation('summary source 暂不支持在 Web 中修改 transport 或 parser')
    }
    if (
      input.targetUrl.trim() !== '' ||
      input.xqueryLocate.trim() !== '' ||
      input.xqueryEntryId.trim() !== ''
    ) {
      throwValidation('summary source 不支持抓取配置字段')
    }
    return
  }

  updateFetchSourceConfig(source, input)
}
