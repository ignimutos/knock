import fontoxpath from 'fontoxpath'
import { JSDOM } from 'jsdom'
import type { XqueryMappingConfig } from '../../config/schema.ts'

const { evaluateXPathToString, evaluateXPathToNodes, evaluateXPathToMap } = fontoxpath
const xmlParserWindow = new JSDOM('').window

export interface ParsedXqueryEntity {
  mapped: Record<string, string>
  raw: Record<string, string>
}

export interface ParsedXquerySource {
  feed: ParsedXqueryEntity
  entries: ParsedXqueryEntity[]
}

function createDocument(content: string): Document {
  const trimmed = content.trimStart()
  const lowered = trimmed.toLowerCase()
  if (lowered.startsWith('<!doctype html') || lowered.startsWith('<html')) {
    return new JSDOM(content).window.document as unknown as Document
  }
  return new xmlParserWindow.DOMParser().parseFromString(content, 'text/xml') as unknown as Document
}

function evaluateToString(
  expression: string,
  contextItem: Node,
  domFacade: typeof fontoxpath.domFacade,
  variables: Record<string, unknown>,
  namespaceResolver?: (prefix: string | null) => string | null,
): string {
  return String(
    evaluateXPathToString(expression, contextItem, domFacade, variables, {
      namespaceResolver,
    }),
  )
}

function evaluateToMap(
  expression: string,
  contextItem: Node,
  domFacade: typeof fontoxpath.domFacade,
): Record<string, unknown> {
  const result = evaluateXPathToMap(expression, contextItem, domFacade, {})
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('xquery 表达式必须返回对象(map)')
  }
  return result as Record<string, unknown>
}

function normalizeObjectToStringRecord(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, String(value ?? '')]))
}

function mapFields(
  fields: Record<string, string> | undefined,
  documentNode: Document,
  contextNode: Node,
  domFacade: typeof fontoxpath.domFacade,
  namespaceResolver?: (prefix: string | null) => string | null,
): Record<string, string> {
  const result: Record<string, string> = {}
  if (!fields) return result

  for (const [key, expression] of Object.entries(fields)) {
    const baseNode =
      expression.startsWith('/') || expression.startsWith('//') ? documentNode : contextNode
    result[key] = evaluateToString(expression, baseNode, domFacade, {}, namespaceResolver)
  }

  return result
}

export function parseXquerySource(
  content: string,
  config: XqueryMappingConfig,
): ParsedXquerySource {
  const documentNode = createDocument(content)
  const domFacade = fontoxpath.domFacade
  const namespaceResolver = config.namespaces
    ? (prefix: string | null) => (prefix ? (config.namespaces?.[prefix] ?? null) : null)
    : undefined

  const nodes = config.locate
    ? (evaluateXPathToNodes(
        config.locate,
        documentNode,
        domFacade,
        {},
        {
          namespaceResolver,
        },
      ) as Node[])
    : [documentNode]

  const feedRaw =
    typeof config.feed === 'string'
      ? normalizeObjectToStringRecord(evaluateToMap(config.feed, documentNode, domFacade))
      : mapFields(
          config.feed as Record<string, string> | undefined,
          documentNode,
          documentNode,
          domFacade,
          namespaceResolver,
        )

  const entries = nodes.map((node) => {
    const entryRaw =
      typeof config.entry === 'string'
        ? normalizeObjectToStringRecord(evaluateToMap(config.entry, node, domFacade))
        : mapFields(
            config.entry as Record<string, string> | undefined,
            documentNode,
            node,
            domFacade,
            namespaceResolver,
          )

    if (!entryRaw.id || entryRaw.id.trim() === '') {
      throw new Error('xquery.entry.id 必填')
    }

    return {
      mapped: entryRaw,
      raw: entryRaw,
    }
  })

  return {
    feed: {
      mapped: feedRaw,
      raw: feedRaw,
    },
    entries,
  }
}
