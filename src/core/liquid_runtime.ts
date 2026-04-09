import { Liquid } from 'liquidjs'
import MarkdownIt from 'markdown-it'
import sanitizeHtml from 'sanitize-html'
import { convert as convertTelegramMarkdownV2 } from 'telegram-markdown-v2'
import TurndownService from 'turndown'

type LiquidContext = Record<string, unknown>
type MatchMode = 'left' | 'right' | 'both'

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

function isAllowedTelegramHref(value: string): boolean {
  try {
    const url = new URL(value)
    return ['http:', 'https:', 'mailto:', 'tg:'].includes(url.protocol)
  } catch {
    return false
  }
}

function convertToTelegramHtml(value: unknown): string {
  const text = toLiquidString(value)
  const sanitized = sanitizeHtml(text, {
    allowedTags: ['b', 'i', 'u', 's', 'code', 'pre', 'a', 'tg-spoiler', 'blockquote', 'span'],
    allowedAttributes: {
      a: ['href'],
      span: ['class'],
    },
    allowedClasses: {
      span: ['tg-spoiler'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tg'],
    allowProtocolRelative: false,
    transformTags: {
      strong: 'b',
      em: 'i',
      ins: 'u',
      strike: 's',
      del: 's',
      a: (tagName: string, attribs: Record<string, string>) => {
        const href = attribs.href
        if (typeof href !== 'string' || !isAllowedTelegramHref(href)) {
          return { tagName, attribs: {} }
        }
        return { tagName, attribs: { href } }
      },
      span: (tagName: string, attribs: Record<string, string>) => {
        if (attribs.class === 'tg-spoiler') {
          return { tagName, attribs: { class: 'tg-spoiler' } }
        }
        return { tagName, attribs: {} }
      },
    },
  })

  return sanitized.replace(/<span>(.*?)<\/span>/g, '$1').replace(/<a>(.*?)<\/a>/g, '$1')
}

function convertToTelegramMarkdownV2(value: unknown): string {
  const text = toLiquidString(value)
  try {
    return convertTelegramMarkdownV2(text, 'escape').trim()
  } catch {
    return convertTelegramMarkdownV2(
      text.replace(/[*_\[\]()~`>#+\-=|{}.!]/g, '\\$&'),
      'keep',
    ).trim()
  }
}

interface LiquidRuntime {
  engine: Liquid
  render(template: string, context: LiquidContext): Promise<string>
  renderSync(template: string, context: LiquidContext): string
}

export function assertLiquidTemplateSyntax(template: string): void {
  getSharedLiquidRuntime().engine.parse(template)
}

function registerSharedLiquidFilters(engine: Liquid): void {
  // 共享 runtime 同时服务同步与异步渲染，新增 filter 必须兼容同步调用。
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
      const flags =
        typeof flagsOrInvert === 'boolean'
          ? undefined
          : flagsOrInvert === undefined
            ? undefined
            : toLiquidString(flagsOrInvert)
      const matched = new RegExp(toLiquidString(pattern), flags).test(text)
      const resolvedInvert = typeof flagsOrInvert === 'boolean' ? flagsOrInvert : invert
      return parseInvertArg('match_regex', resolvedInvert) ? !matched : matched
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
    return convertToTelegramHtml(value)
  })

  engine.registerFilter('to_telegram_markdown_v2', (value: unknown, ...args: unknown[]): string => {
    if (args.length > 0) throw new Error('to_telegram_markdown_v2 不再接受参数')
    return convertToTelegramMarkdownV2(value)
  })
}

function createLiquidRuntime(): LiquidRuntime {
  const engine = new Liquid()
  registerSharedLiquidFilters(engine)

  return {
    engine,
    render(template: string, context: LiquidContext): Promise<string> {
      return engine.parseAndRender(template, context)
    },
    renderSync(template: string, context: LiquidContext): string {
      return engine.parseAndRenderSync(template, context)
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
  getSharedLiquidRuntime().engine.registerFilter(name, filter as never)
}
