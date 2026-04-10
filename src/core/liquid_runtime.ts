import { Liquid, TokenKind } from 'liquidjs'
import MarkdownIt from 'markdown-it'
import sanitizeHtml from 'sanitize-html'
import { convert as convertTelegramMarkdownV2 } from 'telegram-markdown-v2'
import TurndownService from 'turndown'
import type { AiRuntime } from './ai_runtime.ts'
import { getAiEntryRuntime } from './ai_runtime.ts'

type LiquidContext = Record<string, unknown>
type MatchMode = 'left' | 'right' | 'both'

interface CreateLiquidRuntimeOptions {
  aiRuntime?: AiRuntime
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

function assertAiFilterLiteralArguments(
  filterName: 'ai_translate' | 'ai_summarize',
  args: unknown[],
  filterThis: unknown,
): void {
  const maxArgs = filterName === 'ai_translate' ? 3 : 2
  if (args.length > maxArgs) {
    throw new Error(`${filterName} 仅支持 ${maxArgs} 个字符串字面量参数`)
  }

  const tokenArgs = (
    filterThis as {
      token?: {
        args?: Array<{
          kind?: number
        }>
      }
    }
  )?.token?.args

  if (!Array.isArray(tokenArgs) || tokenArgs.length !== args.length) {
    throw new Error(`${filterName} 参数解析失败`)
  }

  for (const tokenArg of tokenArgs) {
    if (tokenArg?.kind !== TokenKind.Quoted) {
      throw new Error('AI filter 参数必须是字符串字面量')
    }
  }
}

function parseTranslateArgs(args: unknown[]): {
  model?: string
  variant?: string
  language?: string
} {
  if (args.length > 3) {
    throw new Error('ai_translate 最多只接受 3 个字符串字面量参数')
  }
  for (const arg of args) {
    if (arg !== undefined && typeof arg !== 'string') {
      throw new Error('ai_translate 的 model / variant / language 参数必须是字符串字面量')
    }
  }

  if (args.length === 0) return {}
  if (args.length === 1) return { language: args[0] as string }
  if (args.length === 2) return { model: args[0] as string, language: args[1] as string }
  return {
    model: args[0] as string,
    variant: args[1] as string,
    language: args[2] as string,
  }
}

function parseSummarizeArgs(args: unknown[]): { model?: string; variant?: string } {
  if (args.length > 2) {
    throw new Error('ai_summarize 最多只接受 2 个字符串字面量参数')
  }
  for (const arg of args) {
    if (arg !== undefined && typeof arg !== 'string') {
      throw new Error('ai_summarize 的 model / variant 参数必须是字符串字面量')
    }
  }

  if (args.length === 0) return {}
  if (args.length === 1) return { model: args[0] as string }
  return { model: args[0] as string, variant: args[1] as string }
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

export function assertLiquidTemplateSyntax(template: string) {
  return getSharedLiquidRuntime().asyncEngine.parse(template)
}

function registerSharedLiquidFilters(engine: Liquid): void {
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

function registerAiLiquidFilters(engine: Liquid, aiRuntime?: AiRuntime): void {
  engine.registerFilter(
    'ai_translate',
    async function (value: unknown, ...args: unknown[]): Promise<string> {
      assertAiFilterLiteralArguments('ai_translate', args, this)
      if (!aiRuntime) {
        throw new Error('未配置 ai，无法使用 ai_translate')
      }
      const entryRuntime = getEntryRuntimeFromFilterThis(this)
      if (!entryRuntime) {
        throw new Error('缺少 entry 级 AI runtime，无法执行 ai_translate')
      }
      return await aiRuntime.translate(entryRuntime, value, parseTranslateArgs(args))
    },
  )

  engine.registerFilter(
    'ai_summarize',
    async function (value: unknown, ...args: unknown[]): Promise<string> {
      assertAiFilterLiteralArguments('ai_summarize', args, this)
      if (!aiRuntime) {
        throw new Error('未配置 ai，无法使用 ai_summarize')
      }
      const entryRuntime = getEntryRuntimeFromFilterThis(this)
      if (!entryRuntime) {
        throw new Error('缺少 entry 级 AI runtime，无法执行 ai_summarize')
      }
      return await aiRuntime.summarize(entryRuntime, value, parseSummarizeArgs(args))
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
  registerSharedLiquidFilters(asyncEngine)
  registerAiLiquidFilters(asyncEngine, options.aiRuntime)

  const syncEngine = new Liquid()
  registerSharedLiquidFilters(syncEngine)
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
