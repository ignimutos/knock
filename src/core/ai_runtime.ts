import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import type {
  AiConfigResolved,
  AiModelRefResolved,
  AiModelResolved,
  AiProviderResolved,
} from '../config/types.ts'
import type { Logger } from './logger.ts'

export const AI_ENTRY_RUNTIME_SYMBOL = Symbol('knock.ai.entryRuntime')

const PROMPT_ID_TRANSLATE = 'ai_translate'
const PROMPT_ID_SUMMARIZE = 'ai_summarize'
const TRANSLATE_PREVIOUS_CONTEXT_CHARS = 300
const TRANSLATE_NEXT_CONTEXT_CHARS = 150
const STAGE_PROMPT_OVERHEAD: Record<AiPromptStage, number> = {
  'translate.single': 900,
  'translate.chunk': 1100,
  'summarize.single': 700,
  'summarize.chunk': 900,
  'summarize.reduce': 700,
}
const PROVIDER_BYTES_PER_TOKEN = {
  openai: 2.8,
  anthropic: 3,
  gemini: 3.2,
} as const
const TOKEN_SAFETY_BUFFER = 512
const DEFAULT_SUMMARIZE_LENGTH = 200

type ProviderType = NonNullable<AiProviderResolved['type']>
export type AiPromptStage =
  | 'translate.single'
  | 'translate.chunk'
  | 'summarize.single'
  | 'summarize.chunk'
  | 'summarize.reduce'

export interface AiEntryRuntime {
  sourceId: string
  entryId: string
  cache: Map<string, Promise<string>>
}

export interface AiRuntime {
  createEntryRuntime(sourceId: string, entryId: string): AiEntryRuntime
  translate(
    entryRuntime: AiEntryRuntime,
    value: unknown,
    options?: AiTranslateOptions,
  ): Promise<string>
  summarize(
    entryRuntime: AiEntryRuntime,
    value: unknown,
    options?: AiSummarizeOptions,
  ): Promise<string>
}

export interface AiTranslateOptions {
  model?: string
  variant?: string
  language?: string
}

export interface AiSummarizeOptions {
  model?: string
  variant?: string
  language?: string
  length?: number
}

export interface CreateAiRuntimeOptions {
  ai?: AiConfigResolved
  defaultLanguage?: string
  logger?: Logger
  generateText?: GenerateTextFn
  now?: () => number
}

interface GenerateTextInput {
  model: unknown
  system: string
  prompt: string
  temperature?: number
  maxOutputTokens?: number
  providerOptions?: Record<string, unknown>
}

interface GenerateTextResult {
  text: string
}

type GenerateTextFn = (input: GenerateTextInput) => Promise<GenerateTextResult>

const AI_FAILURE_MESSAGE = 'AI 调用失败，错误详情已省略'

function getErrorStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const statusCode = (error as Record<string, unknown>).statusCode
  return typeof statusCode === 'number' ? statusCode : undefined
}

function getErrorRetryable(error: unknown): boolean | undefined {
  if (!error || typeof error !== 'object') return undefined
  const isRetryable = (error as Record<string, unknown>).isRetryable
  return typeof isRetryable === 'boolean' ? isRetryable : undefined
}

function getSafeErrorMessage(error: unknown): string | undefined {
  const statusCode = getErrorStatusCode(error)
  switch (statusCode) {
    case 400:
      return 'Bad Request'
    case 401:
      return 'Unauthorized'
    case 403:
      return 'Forbidden'
    case 404:
      return 'Not Found'
    case 408:
      return 'Request Timeout'
    case 409:
      return 'Conflict'
    case 413:
      return 'Payload Too Large'
    case 422:
      return 'Unprocessable Entity'
    case 429:
      return 'Too Many Requests'
    case 500:
      return 'Internal Server Error'
    case 502:
      return 'Bad Gateway'
    case 503:
      return 'Service Unavailable'
    case 504:
      return 'Gateway Timeout'
    default:
      return undefined
  }
}

interface ResolvedAiInvocation {
  provider: AiProviderResolved
  model: AiModelResolved
  variantId?: string
  temperature?: number
  contextWindow: number
  maxOutputTokens: number
  providerOptions?: Record<string, unknown>
  modelHandle: unknown
}

interface ChunkSegment {
  text: string
  start: number
  end: number
}

interface CallAiTextOptions {
  entryRuntime: AiEntryRuntime
  promptId: string
  stage: AiPromptStage
  inputText: string
  language?: string
  invocation: ResolvedAiInvocation
  system: string
  prompt: string
  promptFingerprint: string
  chunkIndex?: number
  chunkCount?: number
  truncated?: boolean
}

function defaultGenerateText(input: GenerateTextInput): Promise<GenerateTextResult> {
  return generateText(input as never).then((result) => ({ text: result.text }))
}

function toText(value: unknown): string {
  return String(value ?? '')
}

function toTrimmedString(name: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new Error(`${name} 参数必须是字符串字面量`)
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new Error(`${name} 参数不能为空字符串`)
  }
  return trimmed
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function hashAiFingerprint(parts: Array<string | number | undefined>): string {
  return hashString(parts.map((part) => String(part ?? '')).join('|'))
}

function estimateTokens(providerType: ProviderType, text: string): number {
  if (text === '') return 0
  const bytesPerToken = PROVIDER_BYTES_PER_TOKEN[providerType]
  const bytes = new TextEncoder().encode(text).length
  return Math.ceil(bytes / bytesPerToken)
}

function estimateNeighborWindowTokens(
  providerType: ProviderType,
  previousChars: number,
  nextChars: number,
): number {
  if (previousChars <= 0 && nextChars <= 0) return 0
  const bytesPerToken = PROVIDER_BYTES_PER_TOKEN[providerType]
  return Math.ceil(((previousChars + nextChars) * 3) / bytesPerToken)
}

function estimateMaxChunkBytes(
  providerType: ProviderType,
  stage: AiPromptStage,
  contextWindow: number,
  maxOutputTokens: number,
  neighborTokens = 0,
): number {
  const inputBudgetTokens =
    contextWindow -
    maxOutputTokens -
    STAGE_PROMPT_OVERHEAD[stage] -
    TOKEN_SAFETY_BUFFER -
    neighborTokens
  const bytesPerToken = PROVIDER_BYTES_PER_TOKEN[providerType]
  return Math.max(Math.floor(Math.max(inputBudgetTokens, 1) * bytesPerToken), 512)
}

function shouldChunkText(
  providerType: ProviderType,
  stage: AiPromptStage,
  contextWindow: number,
  maxOutputTokens: number,
  text: string,
  neighborTokens = 0,
): boolean {
  const totalTokens =
    estimateTokens(providerType, text) +
    STAGE_PROMPT_OVERHEAD[stage] +
    maxOutputTokens +
    TOKEN_SAFETY_BUFFER +
    neighborTokens
  return totalTokens > contextWindow
}

function splitParagraphSegments(text: string): ChunkSegment[] {
  if (text === '') return [{ text: '', start: 0, end: 0 }]

  const segments: ChunkSegment[] = []
  const matcher = /\n\s*\n+/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = matcher.exec(text)) !== null) {
    const end = match.index + match[0].length
    segments.push({
      text: text.slice(lastIndex, end),
      start: lastIndex,
      end,
    })
    lastIndex = end
  }

  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      start: lastIndex,
      end: text.length,
    })
  }

  return segments
}

function splitOversizedSegment(segment: ChunkSegment, maxChunkBytes: number): ChunkSegment[] {
  const bytes = new TextEncoder().encode(segment.text).length
  if (bytes <= maxChunkBytes) return [segment]

  const parts: ChunkSegment[] = []
  let currentText = ''
  let currentStart = segment.start
  let currentOffset = segment.start

  for (const char of Array.from(segment.text)) {
    const nextText = currentText + char
    const nextBytes = new TextEncoder().encode(nextText).length

    if (currentText !== '' && nextBytes > maxChunkBytes) {
      parts.push({
        text: currentText,
        start: currentStart,
        end: currentOffset,
      })
      currentText = char
      currentStart = currentOffset
    } else {
      currentText = nextText
    }

    currentOffset += char.length
  }

  if (currentText !== '') {
    parts.push({
      text: currentText,
      start: currentStart,
      end: segment.end,
    })
  }

  return parts
}

function splitIntoChunks(text: string, maxChunkBytes: number): ChunkSegment[] {
  const segments = splitParagraphSegments(text).flatMap((segment) =>
    splitOversizedSegment(segment, maxChunkBytes),
  )

  const chunks: ChunkSegment[] = []
  let currentChunk: ChunkSegment | undefined

  for (const segment of segments) {
    if (!currentChunk) {
      currentChunk = { ...segment }
      continue
    }

    const mergedText = currentChunk.text + segment.text
    const mergedBytes = new TextEncoder().encode(mergedText).length
    if (mergedBytes <= maxChunkBytes) {
      currentChunk = {
        text: mergedText,
        start: currentChunk.start,
        end: segment.end,
      }
      continue
    }

    chunks.push(currentChunk)
    currentChunk = { ...segment }
  }

  if (currentChunk) {
    chunks.push(currentChunk)
  }

  return chunks.length > 0 ? chunks : [{ text, start: 0, end: text.length }]
}

function sliceNeighborContext(
  text: string,
  start: number,
  end: number,
): { previous: string; next: string } {
  return {
    previous: text.slice(Math.max(0, start - TRANSLATE_PREVIOUS_CONTEXT_CHARS), start),
    next: text.slice(end, Math.min(text.length, end + TRANSLATE_NEXT_CONTEXT_CHARS)),
  }
}

function splitReduceInputs(
  providerType: ProviderType,
  contextWindow: number,
  maxOutputTokens: number,
  chunkSummaries: string[],
): string[] {
  const maxBytes = estimateMaxChunkBytes(
    providerType,
    'summarize.reduce',
    contextWindow,
    maxOutputTokens,
  )
  const lines = chunkSummaries.map((summary, index) => `- chunk ${index + 1}: ${summary}`)
  const groups: string[] = []
  let currentGroup: string[] = []

  for (const line of lines) {
    const nextGroup = [...currentGroup, line]
    const nextText = nextGroup.join('\n')
    const nextBytes = new TextEncoder().encode(nextText).length

    if (currentGroup.length > 0 && nextBytes > maxBytes) {
      groups.push(currentGroup.join('\n'))
      currentGroup = [line]
      continue
    }

    currentGroup = nextGroup
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup.join('\n'))
  }

  return groups.length > 0 ? groups : ['']
}

function buildTranslateSinglePrompt(
  text: string,
  language: string,
): { system: string; prompt: string } {
  return {
    system: `你是专业翻译。请把用户提供的文本翻译成 ${language}。只输出译文，不要解释，不要补充说明。`,
    prompt: `<TEXT>\n${text}\n</TEXT>`,
  }
}

function buildTranslateChunkPrompt(
  chunkText: string,
  previousContext: string,
  nextContext: string,
  language: string,
): { system: string; prompt: string } {
  return {
    system: `你是专业翻译。请把 CURRENT_CHUNK 翻译成 ${language}。可参考上下文保持术语与语气一致，但只输出 CURRENT_CHUNK 的译文，不要输出上下文译文，不要解释。`,
    prompt: [
      '<PREVIOUS_CONTEXT>',
      previousContext,
      '</PREVIOUS_CONTEXT>',
      '<CURRENT_CHUNK>',
      chunkText,
      '</CURRENT_CHUNK>',
      '<NEXT_CONTEXT>',
      nextContext,
      '</NEXT_CONTEXT>',
    ].join('\n'),
  }
}

function buildSummarizeLanguageInstruction(language?: string): string {
  if (language) {
    return `直接输出 ${language} 摘要，不要先输出原文语言版本。`
  }
  return '默认保持输入文本的主语言；专有名词、代码、标识符与固定术语保持原样，不要隐式翻译。'
}

function buildSummarizeLengthInstruction(length: number): string {
  return `最终摘要限制在 ${length} 字以内。`
}

function buildSummarizeSinglePrompt(
  text: string,
  options: { language?: string; length: number },
): { system: string; prompt: string } {
  return {
    system: [
      '请提炼用户提供文本的核心信息，只输出摘要，不要解释。',
      buildSummarizeLanguageInstruction(options.language),
      buildSummarizeLengthInstruction(options.length),
    ].join(' '),
    prompt: `<TEXT>\n${text}\n</TEXT>`,
  }
}

function buildSummarizeChunkPrompt(
  text: string,
  chunkIndex: number,
  chunkCount: number,
  language?: string,
): {
  system: string
  prompt: string
} {
  return {
    system: [
      '请提炼该分段的关键信息，只输出简洁摘要，不要解释。',
      buildSummarizeLanguageInstruction(language),
    ].join(' '),
    prompt: `<CHUNK index="${chunkIndex + 1}" total="${chunkCount}">\n${text}\n</CHUNK>`,
  }
}

function buildSummarizeReducePrompt(
  text: string,
  options: { language?: string; length: number },
): { system: string; prompt: string } {
  return {
    system: [
      '请基于这些分段摘要生成统一总摘要，只输出最终摘要，不要解释。',
      buildSummarizeLanguageInstruction(options.language),
      buildSummarizeLengthInstruction(options.length),
    ].join(' '),
    prompt: `<CHUNK_SUMMARIES>\n${text}\n</CHUNK_SUMMARIES>`,
  }
}

function resolveModelRef(
  ai: AiConfigResolved | undefined,
  explicitModelRef: string | undefined,
): AiModelRefResolved {
  if (!ai) {
    throw new Error('未配置 ai，无法调用 AI filter')
  }

  if (!explicitModelRef) {
    if (!ai.defaultModel) {
      throw new Error('未配置 ai.defaultModel，无法使用默认模型')
    }
    return ai.defaultModel
  }

  const resolved = ai.modelRefs[explicitModelRef]
  if (!resolved) {
    throw new Error(`未找到模型 ${explicitModelRef}`)
  }
  return resolved
}

function pickProvider(ai: AiConfigResolved, providerId: string): AiProviderResolved {
  const provider = ai.providers.find((item) => item.id === providerId)
  if (!provider) {
    throw new Error(`未找到 AI provider ${providerId}`)
  }
  return provider
}

function pickModel(provider: AiProviderResolved, modelId: string): AiModelResolved {
  const model = provider.models.find((item) => item.id === modelId)
  if (!model) {
    throw new Error(`未找到模型 ${provider.id}/${modelId}`)
  }
  return model
}

function toOpenAiProviderOptions(
  options: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!options) return undefined

  const providerOptions: Record<string, unknown> = {}
  if (typeof options.reasoningEffort === 'string' && options.reasoningEffort.trim() !== '') {
    providerOptions.reasoningEffort = options.reasoningEffort.trim()
  }
  if (options.json === true) {
    providerOptions.responseFormat = { type: 'json_object' }
  }
  return Object.keys(providerOptions).length > 0 ? { openai: providerOptions } : undefined
}

function toProviderCallOptions(
  providerType: ProviderType,
  options: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (providerType === 'openai') {
    return toOpenAiProviderOptions(options)
  }
  return undefined
}

function createModelHandle(provider: AiProviderResolved, modelName: string): unknown {
  if (provider.type === 'openai') {
    const openai = createOpenAI({
      apiKey: provider.apiKey,
      baseURL: provider.baseURL,
      headers: provider.headers,
      organization:
        typeof provider.options?.organization === 'string'
          ? provider.options.organization
          : undefined,
      project: typeof provider.options?.project === 'string' ? provider.options.project : undefined,
    } as never)
    return openai(modelName)
  }

  if (provider.type === 'anthropic') {
    const anthropic = createAnthropic({
      apiKey:
        provider.apiKey ??
        (typeof provider.options?.authToken === 'string' ? provider.options.authToken : undefined),
      baseURL: provider.baseURL,
      headers: provider.headers,
    } as never)
    return anthropic(modelName)
  }

  const gemini = createGoogleGenerativeAI({
    apiKey: provider.apiKey,
    baseURL: provider.baseURL,
    headers: provider.headers,
  } as never)
  return gemini(modelName)
}

function createLoggerOrNoop(logger?: Logger): Logger | undefined {
  return logger
}

export function getAiEntryRuntime(
  context: Record<PropertyKey, unknown>,
): AiEntryRuntime | undefined {
  const runtime = context[AI_ENTRY_RUNTIME_SYMBOL]
  if (!runtime || typeof runtime !== 'object') return undefined
  return runtime as AiEntryRuntime
}

export function attachAiEntryRuntime<T extends Record<string, unknown>>(
  context: T,
  entryRuntime: AiEntryRuntime | undefined,
): T {
  if (!entryRuntime) return context
  Object.defineProperty(context, AI_ENTRY_RUNTIME_SYMBOL, {
    value: entryRuntime,
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return context
}

export function createAiRuntime(options: CreateAiRuntimeOptions): AiRuntime {
  const logger = createLoggerOrNoop(options.logger)
  const now = options.now ?? Date.now
  const generateTextImpl = options.generateText ?? defaultGenerateText

  function resolveInvocation(
    modelRefValue: string | undefined,
    variantValue: string | undefined,
  ): ResolvedAiInvocation {
    const modelRef = resolveModelRef(options.ai, modelRefValue)
    const ai = options.ai!
    const provider = pickProvider(ai, modelRef.providerId)
    const model = pickModel(provider, modelRef.modelId)
    const variant = variantValue ? model.variants[variantValue] : undefined

    if (variantValue && !variant) {
      throw new Error(`模型 ${model.ref} 未定义 variant ${variantValue}`)
    }

    if (typeof model.context !== 'number' || typeof model.maxOutputTokens !== 'number') {
      throw new Error(`模型 ${model.ref} 缺少 context 或 maxOutputTokens`)
    }

    return {
      provider,
      model,
      variantId: variantValue,
      temperature: variant?.temperature ?? model.temperature,
      contextWindow: model.context,
      maxOutputTokens: variant?.maxOutputTokens ?? model.maxOutputTokens,
      providerOptions: toProviderCallOptions(provider.type, variant?.options ?? model.options),
      modelHandle: createModelHandle(provider, model.model),
    }
  }

  async function callAiText(callOptions: CallAiTextOptions): Promise<string> {
    const cacheKey = [
      callOptions.promptId,
      callOptions.stage,
      callOptions.invocation.provider.id,
      callOptions.invocation.model.id,
      callOptions.invocation.variantId ?? '',
      callOptions.language ?? '',
      callOptions.promptFingerprint,
    ].join('|')
    const cached = callOptions.entryRuntime.cache.get(cacheKey)
    const baseLogFields = {
      operation: 'generate',
      source_id: callOptions.entryRuntime.sourceId,
      item_id: callOptions.entryRuntime.entryId,
      input_length: callOptions.inputText.length,
      truncated: callOptions.truncated ?? false,
      'ai.provider': callOptions.invocation.provider.type,
      'ai.provider_id': callOptions.invocation.provider.id,
      'ai.model': callOptions.invocation.model.model,
      'ai.model_ref': callOptions.invocation.model.ref,
      'ai.prompt_id': callOptions.promptId,
      'ai.stage': callOptions.stage,
      'ai.cache': false,
      'ai.chunk': callOptions.chunkIndex !== undefined,
      'ai.variant': callOptions.invocation.variantId,
      'ai.language': callOptions.language,
      'ai.chunk_index': callOptions.chunkIndex,
      'ai.chunk_count': callOptions.chunkCount,
    }

    if (cached) {
      logger?.info('AI 缓存命中', {
        ...baseLogFields,
        outcome: 'cache_hit',
        'ai.cache': true,
      })
      return await cached
    }

    const startedAt = now()
    const request = generateTextImpl({
      model: callOptions.invocation.modelHandle,
      system: callOptions.system,
      prompt: callOptions.prompt,
      temperature: callOptions.invocation.temperature,
      maxOutputTokens: callOptions.invocation.maxOutputTokens,
      providerOptions: callOptions.invocation.providerOptions,
    })
      .then((result) => result.text.trim())
      .then(
        (text) => {
          logger?.info('AI 调用完成', {
            ...baseLogFields,
            outcome: 'success',
            output_length: text.length,
            duration_ms: now() - startedAt,
          })
          return text
        },
        (error) => {
          logger?.error('AI 调用失败', {
            ...baseLogFields,
            outcome: 'failure',
            duration_ms: now() - startedAt,
            error_name: error instanceof Error ? error.name : 'Error',
            error_message: AI_FAILURE_MESSAGE,
            'ai.error.status_code': getErrorStatusCode(error),
            'ai.error.retryable': getErrorRetryable(error),
            'ai.error.message': getSafeErrorMessage(error),
          })
          throw error
        },
      )

    callOptions.entryRuntime.cache.set(cacheKey, request)
    return await request
  }

  async function translate(
    entryRuntime: AiEntryRuntime,
    value: unknown,
    translateOptions: AiTranslateOptions = {},
  ): Promise<string> {
    const text = toText(value)
    const modelRefValue = toTrimmedString('model', translateOptions.model)
    const variantValue = toTrimmedString('variant', translateOptions.variant)
    const languageValue =
      toTrimmedString('language', translateOptions.language) ?? options.defaultLanguage

    if (!languageValue) {
      throw new Error('未配置 language，ai_translate 需要显式 language 或顶层 language 默认值')
    }

    const invocation = resolveInvocation(modelRefValue, variantValue)
    const needsChunk = shouldChunkText(
      invocation.provider.type,
      'translate.single',
      invocation.contextWindow,
      invocation.maxOutputTokens,
      text,
    )

    if (!needsChunk) {
      const prompt = buildTranslateSinglePrompt(text, languageValue)
      return await callAiText({
        entryRuntime,
        promptId: PROMPT_ID_TRANSLATE,
        stage: 'translate.single',
        inputText: text,
        language: languageValue,
        invocation,
        system: prompt.system,
        prompt: prompt.prompt,
        promptFingerprint: hashString(`${text}|${languageValue}`),
      })
    }

    const neighborTokens = estimateNeighborWindowTokens(
      invocation.provider.type,
      TRANSLATE_PREVIOUS_CONTEXT_CHARS,
      TRANSLATE_NEXT_CONTEXT_CHARS,
    )
    const maxChunkBytes = estimateMaxChunkBytes(
      invocation.provider.type,
      'translate.chunk',
      invocation.contextWindow,
      invocation.maxOutputTokens,
      neighborTokens,
    )
    const chunks = splitIntoChunks(text, maxChunkBytes)
    const outputs: string[] = []

    for (const [index, chunk] of chunks.entries()) {
      const contextWindow = sliceNeighborContext(text, chunk.start, chunk.end)
      const prompt = buildTranslateChunkPrompt(
        chunk.text,
        contextWindow.previous,
        contextWindow.next,
        languageValue,
      )
      outputs.push(
        await callAiText({
          entryRuntime,
          promptId: PROMPT_ID_TRANSLATE,
          stage: 'translate.chunk',
          inputText: chunk.text,
          language: languageValue,
          invocation,
          system: prompt.system,
          prompt: prompt.prompt,
          promptFingerprint: hashString(
            `${chunk.text}|${contextWindow.previous}|${contextWindow.next}|${languageValue}`,
          ),
          chunkIndex: index,
          chunkCount: chunks.length,
        }),
      )
    }

    return outputs.join('')
  }

  async function summarize(
    entryRuntime: AiEntryRuntime,
    value: unknown,
    summarizeOptions: AiSummarizeOptions = {},
  ): Promise<string> {
    const text = toText(value)
    const modelRefValue = toTrimmedString('model', summarizeOptions.model)
    const variantValue = toTrimmedString('variant', summarizeOptions.variant)
    const languageValue = toTrimmedString('language', summarizeOptions.language)
    const lengthValue = summarizeOptions.length ?? DEFAULT_SUMMARIZE_LENGTH
    if (!Number.isSafeInteger(lengthValue) || lengthValue < 1) {
      throw new Error('length 参数必须是正整数')
    }

    const invocation = resolveInvocation(modelRefValue, variantValue)
    const needsChunk = shouldChunkText(
      invocation.provider.type,
      'summarize.single',
      invocation.contextWindow,
      invocation.maxOutputTokens,
      text,
    )

    if (!needsChunk) {
      const prompt = buildSummarizeSinglePrompt(text, {
        language: languageValue,
        length: lengthValue,
      })
      return await callAiText({
        entryRuntime,
        promptId: PROMPT_ID_SUMMARIZE,
        stage: 'summarize.single',
        inputText: text,
        language: languageValue,
        invocation,
        system: prompt.system,
        prompt: prompt.prompt,
        promptFingerprint: hashAiFingerprint([text, languageValue, lengthValue]),
      })
    }

    const chunkOutputTokens = Math.min(invocation.maxOutputTokens, 512)
    const maxChunkBytes = estimateMaxChunkBytes(
      invocation.provider.type,
      'summarize.chunk',
      invocation.contextWindow,
      chunkOutputTokens,
    )
    const chunks = splitIntoChunks(text, maxChunkBytes)
    const chunkSummaries: string[] = []

    for (const [index, chunk] of chunks.entries()) {
      const prompt = buildSummarizeChunkPrompt(chunk.text, index, chunks.length, languageValue)
      chunkSummaries.push(
        await callAiText({
          entryRuntime,
          promptId: PROMPT_ID_SUMMARIZE,
          stage: 'summarize.chunk',
          inputText: chunk.text,
          language: languageValue,
          invocation: {
            ...invocation,
            maxOutputTokens: chunkOutputTokens,
          },
          system: prompt.system,
          prompt: prompt.prompt,
          promptFingerprint: hashAiFingerprint([index, chunks.length, chunk.text, languageValue]),
          chunkIndex: index,
          chunkCount: chunks.length,
        }),
      )
    }

    let reduceSummaries = chunkSummaries

    while (true) {
      const reduceInputs = splitReduceInputs(
        invocation.provider.type,
        invocation.contextWindow,
        invocation.maxOutputTokens,
        reduceSummaries,
      )

      if (reduceInputs.length === 1) {
        const reducePrompt = buildSummarizeReducePrompt(reduceInputs[0], {
          language: languageValue,
          length: lengthValue,
        })
        return await callAiText({
          entryRuntime,
          promptId: PROMPT_ID_SUMMARIZE,
          stage: 'summarize.reduce',
          inputText: reduceInputs[0],
          language: languageValue,
          invocation,
          system: reducePrompt.system,
          prompt: reducePrompt.prompt,
          promptFingerprint: hashAiFingerprint([reduceInputs[0], languageValue, lengthValue]),
          chunkCount: chunks.length,
          truncated: false,
        })
      }

      reduceSummaries = []
      for (const reduceInput of reduceInputs) {
        const reducePrompt = buildSummarizeReducePrompt(reduceInput, {
          language: languageValue,
          length: lengthValue,
        })
        reduceSummaries.push(
          await callAiText({
            entryRuntime,
            promptId: PROMPT_ID_SUMMARIZE,
            stage: 'summarize.reduce',
            inputText: reduceInput,
            language: languageValue,
            invocation,
            system: reducePrompt.system,
            prompt: reducePrompt.prompt,
            promptFingerprint: hashAiFingerprint([reduceInput, languageValue, lengthValue]),
            chunkCount: chunks.length,
            truncated: false,
          }),
        )
      }
    }
  }

  return {
    createEntryRuntime(sourceId: string, entryId: string): AiEntryRuntime {
      return {
        sourceId,
        entryId,
        cache: new Map<string, Promise<string>>(),
      }
    },
    translate,
    summarize,
  }
}
