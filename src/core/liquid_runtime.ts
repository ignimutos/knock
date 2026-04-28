import { Liquid, TokenKind } from '../platform/liquidjs.ts'
import MarkdownIt from 'markdown-it'
import sanitizeHtml from 'sanitize-html'
import TurndownService from 'turndown/lib/turndown.cjs.js'
import type { AiRuntime } from './ai_runtime.ts'
import { getAiEntryRuntime } from './ai_runtime.ts'
import type { Logger } from './logger.ts'

type LiquidContext = Record<string, unknown>
type MatchMode = 'left' | 'right' | 'both'

interface CreateLiquidRuntimeOptions {
  aiRuntime?: AiRuntime
  logger?: Logger
}

interface LiquidRuntime {
  asyncEngine: Liquid
  syncEngine: Liquid
  render(template: string, context: LiquidContext): Promise<string>
  renderSync(template: string, context: LiquidContext): string
}

function toLiquidString(value: unknown): string {
  return String(value ?? '')
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseInvertArg(filterName: string, invert: unknown): boolean {
  if (invert === undefined) return false
  if (typeof invert === 'boolean') return invert
  throw new Error(`${filterName} 的 invert 参数必须是布尔值`)
}

function compileRegex(_filterName: string, pattern: unknown, flags?: unknown): RegExp {
  const resolvedFlags = flags === undefined ? undefined : toLiquidString(flags)
  return new RegExp(toLiquidString(pattern), resolvedFlags)
}

function parseRegexGroupArg(group: unknown): number {
  if (group === undefined) return 1
  if (typeof group === 'number' && Number.isSafeInteger(group) && group >= 0) {
    return group
  }
  if (typeof group === 'string' && /^\d+$/.test(group.trim())) {
    return Number(group.trim())
  }
  throw new Error('extract_regex 的 group 参数必须是非负整数')
}

type AiFilterName = 'ai_translate' | 'ai_summarize'
type AiFilterTokenValue = { kind?: number }
type AiFilterNamedTokenArg = [string?, AiFilterTokenValue?]

interface AiFilterNamedArg {
  key: string
  value: unknown
  valueToken: AiFilterTokenValue
}

function getAiFilterNamedArguments(
  filterName: AiFilterName,
  args: unknown[],
  filterThis: unknown,
): AiFilterNamedArg[] {
  const tokenArgs = (
    filterThis as {
      token?: {
        args?: AiFilterNamedTokenArg[]
      }
    }
  )?.token?.args

  if (!Array.isArray(tokenArgs) || tokenArgs.length !== args.length) {
    throw new Error(`${filterName} 参数解析失败`)
  }

  return tokenArgs.map((tokenArg, index) => {
    if (!Array.isArray(tokenArg) || tokenArg.length !== 2 || typeof tokenArg[0] !== 'string') {
      throw new Error(`${filterName} 仅支持命名参数`)
    }

    const runtimeArg = args[index]
    if (
      !Array.isArray(runtimeArg) ||
      runtimeArg.length !== 2 ||
      typeof runtimeArg[0] !== 'string' ||
      runtimeArg[0] !== tokenArg[0]
    ) {
      throw new Error(`${filterName} 参数解析失败`)
    }

    if (!tokenArg[1] || typeof tokenArg[1] !== 'object') {
      throw new Error(`${filterName} 的 ${tokenArg[0]} 参数缺少值`)
    }

    return {
      key: tokenArg[0],
      value: runtimeArg[1],
      valueToken: tokenArg[1],
    }
  })
}

function parseAiStringLiteralArg(
  filterName: AiFilterName,
  key: string,
  value: unknown,
  valueToken: AiFilterTokenValue,
): string {
  if (valueToken.kind !== TokenKind.Quoted) {
    throw new Error(`${filterName} 的 ${key} 参数必须是字符串字面量`)
  }
  if (typeof value !== 'string') {
    throw new Error(`${filterName} 的 ${key} 参数必须是字符串字面量`)
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new Error(`${filterName} 的 ${key} 参数不能为空字符串`)
  }
  return trimmed
}

function parseAiPositiveIntegerArg(
  filterName: AiFilterName,
  key: string,
  value: unknown,
  valueToken: AiFilterTokenValue,
): number {
  if (valueToken.kind !== TokenKind.Quoted && valueToken.kind !== TokenKind.Number) {
    throw new Error(`${filterName} 的 ${key} 参数必须是正整数，或可解析为正整数的字符串字面量`)
  }

  const raw =
    typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${filterName} 的 ${key} 参数必须是正整数，或可解析为正整数的字符串字面量`)
  }

  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${filterName} 的 ${key} 参数必须是正整数，或可解析为正整数的字符串字面量`)
  }
  return parsed
}

function parseTranslateArgs(
  args: unknown[],
  filterThis: unknown,
): {
  model?: string
  variant?: string
  language?: string
} {
  const namedArgs = getAiFilterNamedArguments('ai_translate', args, filterThis)
  const parsed: {
    model?: string
    variant?: string
    language?: string
  } = {}
  const seen = new Set<string>()

  for (const { key, value, valueToken } of namedArgs) {
    if (seen.has(key)) {
      throw new Error(`ai_translate 的 ${key} 参数重复`)
    }
    seen.add(key)

    switch (key) {
      case 'model':
        parsed.model = parseAiStringLiteralArg('ai_translate', key, value, valueToken)
        break
      case 'variant':
        parsed.variant = parseAiStringLiteralArg('ai_translate', key, value, valueToken)
        break
      case 'language':
        parsed.language = parseAiStringLiteralArg('ai_translate', key, value, valueToken)
        break
      default:
        throw new Error(`ai_translate 不支持命名参数 ${key}`)
    }
  }

  return parsed
}

function parseSummarizeArgs(
  args: unknown[],
  filterThis: unknown,
): { model?: string; variant?: string; language?: string; length?: number } {
  const namedArgs = getAiFilterNamedArguments('ai_summarize', args, filterThis)
  const parsed: { model?: string; variant?: string; language?: string; length?: number } = {}
  const seen = new Set<string>()

  for (const { key, value, valueToken } of namedArgs) {
    if (seen.has(key)) {
      throw new Error(`ai_summarize 的 ${key} 参数重复`)
    }
    seen.add(key)

    switch (key) {
      case 'model':
        parsed.model = parseAiStringLiteralArg('ai_summarize', key, value, valueToken)
        break
      case 'variant':
        parsed.variant = parseAiStringLiteralArg('ai_summarize', key, value, valueToken)
        break
      case 'language':
        parsed.language = parseAiStringLiteralArg('ai_summarize', key, value, valueToken)
        break
      case 'length':
        parsed.length = parseAiPositiveIntegerArg('ai_summarize', key, value, valueToken)
        break
      default:
        throw new Error(`ai_summarize 不支持命名参数 ${key}`)
    }
  }

  return parsed
}

function getEntryRuntimeFromFilterThis(filterThis: unknown) {
  if (!filterThis || typeof filterThis !== 'object') return undefined
  const maybeContext = (
    filterThis as {
      context?: { environments?: Record<PropertyKey, unknown>; scopes?: unknown[] }
    }
  ).context
  if (!maybeContext) return undefined

  const direct = maybeContext.environments
  if (direct && typeof direct === 'object') {
    const runtime = getAiEntryRuntime(direct)
    if (runtime) return runtime
  }

  for (const scope of maybeContext.scopes ?? []) {
    if (scope && typeof scope === 'object') {
      const runtime = getAiEntryRuntime(scope as Record<PropertyKey, unknown>)
      if (runtime) return runtime
    }
  }

  return undefined
}

const markdownRenderer = new MarkdownIt({
  html: false,
  breaks: false,
  linkify: false,
  typographer: false,
  xhtmlOut: false,
})
const markdownConverter = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  fence: '```',
  emDelimiter: '*',
  strongDelimiter: '**',
  linkStyle: 'inlined',
  br: '  ',
  preformattedCode: true,
})

function convertToHtml(value: unknown): string {
  const text = toLiquidString(value)
  return markdownRenderer.render(text).trim()
}

function convertToMarkdown(value: unknown): string {
  const text = toLiquidString(value)
  return markdownConverter.turndown(text)
}

const TELEGRAM_HTML_ALLOWED_TAGS = new Set([
  'a',
  'b',
  'blockquote',
  'code',
  'del',
  'em',
  'i',
  'ins',
  'pre',
  's',
  'strike',
  'strong',
  'tg-emoji',
  'tg-spoiler',
  'u',
])
const TELEGRAM_HTML_SEMANTIC_LOSS_TAGS = new Set([
  'audio',
  'dl',
  'dt',
  'dd',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'iframe',
  'img',
  'li',
  'ol',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
  'video',
])
const TELEGRAM_HTML_START_TAG_PATTERN = /<([a-zA-Z][\w-]*)(\s[^<>]*?)?\s*>/g
const TELEGRAM_HTML_ATTRIBUTE_PATTERN =
  /([:@a-zA-Z_][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

interface TelegramHtmlMetrics {
  changed: boolean
  normalizedTagCount: number
  reason: 'auto_corrected' | 'semantic_loss' | 'unchanged'
  removedAttributeCount: number
  removedLinkCount: number
  semanticLossTagCount: number
  strippedTagCount: number
}

interface TelegramHtmlSanitizeResult {
  html: string
  metrics: TelegramHtmlMetrics
}

function isAllowedTelegramHref(value: string): boolean {
  try {
    const url = new URL(value)
    return ['http:', 'https:', 'mailto:', 'tg:'].includes(url.protocol)
  } catch {
    return false
  }
}

function parseTelegramHtmlAttributes(
  rawAttributes: string | undefined,
): Record<string, string | true> {
  if (!rawAttributes) return {}

  const attributes: Record<string, string | true> = {}
  for (const match of rawAttributes.matchAll(TELEGRAM_HTML_ATTRIBUTE_PATTERN)) {
    const [, rawName, doubleQuoted, singleQuoted, bareValue] = match
    attributes[rawName.toLowerCase()] = doubleQuoted ?? singleQuoted ?? bareValue ?? true
  }
  return attributes
}

function hasTelegramSpoilerClass(attributes: Record<string, string | true>): boolean {
  const classValue = attributes.class
  if (typeof classValue !== 'string') return false
  return classValue
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token !== '')
    .includes('tg-spoiler')
}

function getTelegramAttributeValue(
  attributes: Record<string, string | true>,
  key: string,
): string | undefined {
  const value = attributes[key]
  return typeof value === 'string' ? value : undefined
}

function getTelegramCodeLanguageClass(
  attributes: Record<string, string | true>,
): string | undefined {
  const classValue = attributes.class
  if (typeof classValue !== 'string') return undefined
  return classValue
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token !== '')
    .find((token) => /^language-[\w#+-]+$/.test(token))
}

function collectTelegramHtmlMetrics(text: string): Omit<TelegramHtmlMetrics, 'changed' | 'reason'> {
  let normalizedTagCount = 0
  let removedAttributeCount = 0
  let removedLinkCount = 0
  let semanticLossTagCount = 0
  let strippedTagCount = 0

  for (const match of text.matchAll(TELEGRAM_HTML_START_TAG_PATTERN)) {
    const [, rawTagName, rawAttributes] = match
    const tagName = rawTagName.toLowerCase()
    const attributes = parseTelegramHtmlAttributes(rawAttributes)
    const attributeNames = Object.keys(attributes)

    if (tagName === 'span') {
      if (hasTelegramSpoilerClass(attributes)) {
        normalizedTagCount += 1
        removedAttributeCount += Math.max(0, attributeNames.length - 1)
      } else {
        strippedTagCount += 1
        removedAttributeCount += attributeNames.length
      }
      continue
    }

    if (!TELEGRAM_HTML_ALLOWED_TAGS.has(tagName)) {
      strippedTagCount += 1
      removedAttributeCount += attributeNames.length
      if (TELEGRAM_HTML_SEMANTIC_LOSS_TAGS.has(tagName)) {
        semanticLossTagCount += 1
      }
      continue
    }

    if (tagName === 'a') {
      const href = getTelegramAttributeValue(attributes, 'href')
      const hasAllowedHref = typeof href === 'string' && isAllowedTelegramHref(href)
      if (!hasAllowedHref) {
        removedLinkCount += 1
      }
      removedAttributeCount += attributeNames.length - (hasAllowedHref ? 1 : 0)
      continue
    }

    if (tagName === 'blockquote') {
      removedAttributeCount +=
        attributeNames.length - (Object.hasOwn(attributes, 'expandable') ? 1 : 0)
      continue
    }

    if (tagName === 'pre') {
      removedAttributeCount += attributeNames.length
      continue
    }

    if (tagName === 'code') {
      removedAttributeCount +=
        attributeNames.length - (getTelegramCodeLanguageClass(attributes) ? 1 : 0)
      continue
    }

    if (tagName === 'tg-emoji') {
      const emojiId = getTelegramAttributeValue(attributes, 'emoji-id')
      removedAttributeCount += attributeNames.length - (typeof emojiId === 'string' ? 1 : 0)
      continue
    }

    removedAttributeCount += attributeNames.length
  }

  return {
    normalizedTagCount,
    removedAttributeCount,
    removedLinkCount,
    semanticLossTagCount,
    strippedTagCount,
  }
}

function sanitizeTelegramHtml(text: string): TelegramHtmlSanitizeResult {
  const metrics = collectTelegramHtmlMetrics(text)
  const rawTagStack: string[] = []
  const sanitized = sanitizeHtml(text, {
    allowedTags: Array.from(TELEGRAM_HTML_ALLOWED_TAGS),
    allowedAttributes: {
      a: ['href'],
      blockquote: ['expandable'],
      code: ['class'],
      'tg-emoji': ['emoji-id'],
    },
    allowedClasses: {
      code: ['language-*'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tg'],
    allowProtocolRelative: false,
    onOpenTag: (tagName: string) => {
      rawTagStack.push(tagName.toLowerCase())
    },
    onCloseTag: (tagName: string) => {
      const normalizedTagName = tagName.toLowerCase()
      for (let index = rawTagStack.length - 1; index >= 0; index -= 1) {
        if (rawTagStack[index] === normalizedTagName) {
          rawTagStack.splice(index, 1)
          break
        }
      }
    },
    transformTags: {
      a: (tagName: string, attribs: Record<string, string>) => {
        const href = attribs.href
        if (typeof href !== 'string' || !isAllowedTelegramHref(href)) {
          return { tagName, attribs: {} }
        }
        return { tagName, attribs: { href } }
      },
      blockquote: (tagName: string, attribs: Record<string, string>) => {
        if (Object.hasOwn(attribs, 'expandable')) {
          return { tagName, attribs: { expandable: 'expandable' } }
        }
        return { tagName, attribs: {} }
      },
      code: (tagName: string, attribs: Record<string, string>) => {
        const languageClass = getTelegramCodeLanguageClass(attribs)
        const parentTag = rawTagStack.at(-2)
        if (parentTag === 'pre' && typeof languageClass === 'string') {
          return { tagName, attribs: { class: languageClass } }
        }
        return { tagName, attribs: {} }
      },
      pre: (tagName: string) => {
        return { tagName, attribs: {} }
      },
      span: (tagName: string, attribs: Record<string, string>) => {
        if (
          typeof attribs.class === 'string' &&
          attribs.class.split(/\s+/).includes('tg-spoiler')
        ) {
          return { tagName: 'tg-spoiler', attribs: {} }
        }
        return { tagName, attribs: {} }
      },
      'tg-emoji': (tagName: string, attribs: Record<string, string>) => {
        const emojiId = attribs['emoji-id']
        if (typeof emojiId === 'string' && emojiId.trim() !== '') {
          return { tagName, attribs: { 'emoji-id': emojiId } }
        }
        return { tagName, attribs: {} }
      },
    },
    exclusiveFilter: (frame: { tag: string; attribs: Record<string, string> }) => {
      return frame.tag === 'a' && !frame.attribs.href ? 'excludeTag' : false
    },
  })
  const html = sanitized.replace(/<blockquote expandable(?:="[^"]*")?>/g, '<blockquote expandable>')
  const changed =
    html !== text ||
    metrics.normalizedTagCount > 0 ||
    metrics.removedAttributeCount > 0 ||
    metrics.removedLinkCount > 0 ||
    metrics.semanticLossTagCount > 0 ||
    metrics.strippedTagCount > 0
  const reason = !changed
    ? 'unchanged'
    : metrics.semanticLossTagCount > 0
      ? 'semantic_loss'
      : 'auto_corrected'

  return {
    html,
    metrics: {
      ...metrics,
      changed,
      reason,
    },
  }
}

function logTelegramHtmlEvent(
  logger: Logger | undefined,
  result: TelegramHtmlSanitizeResult,
): void {
  if (!logger) return

  const fields = {
    'template.changed': result.metrics.changed,
    'template.filter_name': 'to_telegram_html',
    'template.normalized_tag_count': result.metrics.normalizedTagCount,
    'template.operation': 'sanitize_telegram_html',
    'template.reason': result.metrics.reason,
    'template.removed_attribute_count': result.metrics.removedAttributeCount,
    'template.removed_link_count': result.metrics.removedLinkCount,
    'template.semantic_loss_tag_count': result.metrics.semanticLossTagCount,
    'template.stripped_tag_count': result.metrics.strippedTagCount,
  }

  if (result.metrics.reason === 'unchanged') {
    logger.debug('Telegram HTML 渲染完成', fields)
    return
  }

  if (result.metrics.reason === 'semantic_loss') {
    logger.warn('Telegram HTML 渲染出现语义损失', fields)
    return
  }

  logger.info('Telegram HTML 已自动修正', fields)
}

function renderTelegramHtml(value: unknown, logger?: Logger): string {
  const text = toLiquidString(value)

  try {
    const result = sanitizeTelegramHtml(text)
    logTelegramHtmlEvent(logger, result)
    return result.html
  } catch (error) {
    logger?.error('Telegram HTML 渲染失败', {
      'template.changed': true,
      'template.filter_name': 'to_telegram_html',
      'template.operation': 'sanitize_telegram_html',
      'template.reason': 'render_failed',
      error_name: error instanceof Error ? error.name : 'Error',
      error_message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

function escapeTelegramMarkdownV2Text(value: string): string {
  return value.replace(/[*_\[\]()~`>#+\-=|{}.!]/g, '\\$&')
}

function convertTelegramMarkdownV2Markup(text: string): string {
  const protectedSegments: string[] = []
  const protect = (value: string): string => {
    const token = `__TGMDV2_${protectedSegments.length}__`
    protectedSegments.push(value)
    return token
  }

  let changed = false
  let result = text

  result = result.replace(/```[^\n]*\n([\s\S]*?)```/g, (_match, code: string) => {
    changed = true
    const normalizedCode = code.replace(/\n$/, '')
    return protect('```\n' + normalizedCode + '\n```')
  })
  result = result.replace(/`([^`]+)`/g, (_match, code: string) => {
    changed = true
    return protect(`\`${code}\``)
  })
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (match: string) => {
    changed = true
    return protect(match)
  })
  result = result.replace(
    /<span class="tg-spoiler">([\s\S]*?)<\/span>/g,
    (_match, content: string) => {
      changed = true
      return `\\|\\|${content}\\|\\|`
    },
  )
  result = result.replace(/<u>([\s\S]*?)<\/u>/g, (_match, content: string) => {
    changed = true
    return protect(`*${content}*`)
  })
  result = result.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, alt: string) => {
    changed = true
    return alt
  })
  result = result.replace(/^# (.+)$/gm, (_match, content: string) => {
    changed = true
    return protect(`*${content}*`)
  })
  result = result.replace(/^\- (.+)$/gm, (_match, content: string) => {
    changed = true
    return `•   ${content}`
  })
  result = result.replace(/^(\d+)\. (.+)$/gm, (_match, index: string, content: string) => {
    changed = true
    return `${index}\\.  ${content}`
  })
  result = result.replace(/\*\*([^*]+)\*\*/g, (_match, content: string) => {
    changed = true
    return protect(`*${content}*`)
  })
  result = result.replace(/__([^_]+)__/g, (_match, content: string) => {
    changed = true
    return protect(`*${content}*`)
  })
  result = result.replace(
    /(^|[^*])\*([^*]+)\*(?!\*)/g,
    (_match, prefix: string, content: string) => {
      changed = true
      return `${prefix}_${content}_`
    },
  )
  result = result.replace(/~~([^~]+)~~/g, (_match, content: string) => {
    changed = true
    return `~${content}~`
  })
  result = result.replace(/\|\|([^|]+)\|\|/g, (_match, content: string) => {
    changed = true
    return `\\|\\|${content}\\|\\|`
  })
  result = result.replace(/^> /gm, () => {
    changed = true
    return '\\> '
  })

  if (!changed) {
    return escapeTelegramMarkdownV2Text(text)
  }

  return result.replace(
    /__TGMDV2_(\d+)__/g,
    (_match, index: string) => protectedSegments[Number(index)] ?? '',
  )
}

function convertToTelegramMarkdownV2(value: unknown): string {
  const text = toLiquidString(value)
  try {
    return convertTelegramMarkdownV2Markup(text).trim()
  } catch {
    return escapeTelegramMarkdownV2Text(text).trim()
  }
}

export function assertLiquidTemplateSyntax(template: string) {
  return getSharedLiquidRuntime().asyncEngine.parse(template)
}

function registerSharedLiquidFilters(engine: Liquid, logger?: Logger): void {
  engine.registerFilter(
    'match_exact',
    (value: unknown, target: unknown, invert?: unknown): boolean => {
      const matched = toLiquidString(value) === toLiquidString(target)
      return parseInvertArg('match_exact', invert) ? !matched : matched
    },
  )

  engine.registerFilter(
    'match_fuzzy',
    (
      value: unknown,
      needle: unknown,
      modeOrInvert: unknown = 'both',
      invert?: unknown,
    ): boolean => {
      const text = toLiquidString(value)
      const keyword = toLiquidString(needle)

      let mode: MatchMode = 'both'
      let invertArg = invert
      if (typeof modeOrInvert === 'boolean') {
        invertArg = modeOrInvert
      } else {
        const normalizedMode = toLiquidString(modeOrInvert) as MatchMode
        if (normalizedMode === 'left' || normalizedMode === 'right' || normalizedMode === 'both') {
          mode = normalizedMode
        } else {
          throw new Error(`不支持的 match_fuzzy 模式: ${normalizedMode}`)
        }
      }

      const matched =
        mode === 'left'
          ? text.startsWith(keyword)
          : mode === 'right'
            ? text.endsWith(keyword)
            : text.includes(keyword)
      return parseInvertArg('match_fuzzy', invertArg) ? !matched : matched
    },
  )

  engine.registerFilter(
    'match_regex',
    (value: unknown, pattern: unknown, flagsOrInvert?: unknown, invert?: unknown): boolean => {
      const text = toLiquidString(value)
      const matched = compileRegex(
        'match_regex',
        pattern,
        typeof flagsOrInvert === 'boolean' ? undefined : flagsOrInvert,
      ).test(text)
      const resolvedInvert = typeof flagsOrInvert === 'boolean' ? flagsOrInvert : invert
      return parseInvertArg('match_regex', resolvedInvert) ? !matched : matched
    },
  )

  engine.registerFilter(
    'extract_regex',
    (value: unknown, pattern: unknown, flagsOrGroup?: unknown, group?: unknown): string => {
      const text = toLiquidString(value)
      const flags = typeof flagsOrGroup === 'string' ? flagsOrGroup : undefined
      const regex = compileRegex('extract_regex', pattern, flags)
      const match = regex.exec(text)
      if (!match) return ''

      const explicitGroup = flags !== undefined ? group : flagsOrGroup
      if (match.length === 1 && explicitGroup === undefined) {
        return match[0] ?? ''
      }

      const groupIndex = parseRegexGroupArg(explicitGroup)
      if (groupIndex >= match.length) {
        throw new Error(`extract_regex 的 group ${groupIndex} 超出可用捕获组范围`)
      }

      return match[groupIndex] ?? ''
    },
  )

  engine.registerFilter('strip_html', (value: unknown): string => {
    return stripHtml(toLiquidString(value))
  })

  engine.registerFilter('to_html', (value: unknown, ...args: unknown[]): string => {
    if (args.length > 0) throw new Error('to_html 不再接受 format 参数')
    return convertToHtml(value)
  })

  engine.registerFilter('to_markdown', (value: unknown, ...args: unknown[]): string => {
    if (args.length > 0) throw new Error('to_markdown 不再接受 format 参数')
    return convertToMarkdown(value)
  })

  engine.registerFilter('to_telegram_html', (value: unknown, ...args: unknown[]): string => {
    if (args.length > 0) throw new Error('to_telegram_html 不再接受参数')
    return renderTelegramHtml(value, logger)
  })

  engine.registerFilter('to_telegram_markdown_v2', (value: unknown, ...args: unknown[]): string => {
    if (args.length > 0) throw new Error('to_telegram_markdown_v2 不再接受参数')
    return convertToTelegramMarkdownV2(value)
  })
}

function registerAiLiquidFilters(engine: Liquid, aiRuntime?: AiRuntime): void {
  engine.registerFilter(
    'ai_translate',
    async function (this: unknown, value: unknown, ...args: unknown[]): Promise<string> {
      if (!aiRuntime) {
        throw new Error('未配置 ai，无法使用 ai_translate')
      }
      const entryRuntime = getEntryRuntimeFromFilterThis(this)
      if (!entryRuntime) {
        throw new Error('缺少 entry 级 AI runtime，无法执行 ai_translate')
      }
      return await aiRuntime.translate(entryRuntime, value, parseTranslateArgs(args, this))
    },
  )

  engine.registerFilter(
    'ai_summarize',
    async function (this: unknown, value: unknown, ...args: unknown[]): Promise<string> {
      if (!aiRuntime) {
        throw new Error('未配置 ai，无法使用 ai_summarize')
      }
      const entryRuntime = getEntryRuntimeFromFilterThis(this)
      if (!entryRuntime) {
        throw new Error('缺少 entry 级 AI runtime，无法执行 ai_summarize')
      }
      return await aiRuntime.summarize(entryRuntime, value, parseSummarizeArgs(args, this))
    },
  )
}

function registerSyncAiGuards(engine: Liquid): void {
  engine.registerFilter('ai_translate', (): never => {
    throw new Error('ai_translate 仅支持异步渲染')
  })
  engine.registerFilter('ai_summarize', (): never => {
    throw new Error('ai_summarize 仅支持异步渲染')
  })
}

export function createLiquidRuntime(options: CreateLiquidRuntimeOptions = {}): LiquidRuntime {
  const asyncEngine = new Liquid()
  registerSharedLiquidFilters(asyncEngine, options.logger)
  registerAiLiquidFilters(asyncEngine, options.aiRuntime)

  const syncEngine = new Liquid()
  registerSharedLiquidFilters(syncEngine, options.logger)
  registerSyncAiGuards(syncEngine)

  return {
    asyncEngine,
    syncEngine,
    render(template: string, context: LiquidContext): Promise<string> {
      return asyncEngine.parseAndRender(template, context)
    },
    renderSync(template: string, context: LiquidContext): string {
      return syncEngine.parseAndRenderSync(template, context)
    },
  }
}

let sharedLiquidRuntime: LiquidRuntime | null = null

function getSharedLiquidRuntime(): LiquidRuntime {
  if (!sharedLiquidRuntime) {
    sharedLiquidRuntime = createLiquidRuntime()
  }
  return sharedLiquidRuntime
}

export function renderLiquid(template: string, context: LiquidContext): Promise<string> {
  return getSharedLiquidRuntime().render(template, context)
}

export function renderLiquidSync(template: string, context: LiquidContext): string {
  return getSharedLiquidRuntime().renderSync(template, context)
}

export function registerLiquidFilter(name: string, filter: unknown): void {
  getSharedLiquidRuntime().asyncEngine.registerFilter(name, filter as never)
  getSharedLiquidRuntime().syncEngine.registerFilter(name, filter as never)
}
