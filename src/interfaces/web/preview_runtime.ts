import {
  PreviewSourceUseCase,
  type PreviewSourceRequest,
} from '../../application/preview_source_use_case.ts'
import type { AppConfigResolved, ResolvedSourceConfig } from '../../config/types.ts'
import { buildLoadedDefinitionsFromResolvedConfig } from '../config/load_definitions.ts'
import { createPreviewComposition } from '../../composition/create_preview_runtime.ts'

export interface PreviewRuntimeDeps<TRequest, TParsedRequest, TResponse> {
  previewSourceUseCase: Pick<PreviewSourceUseCase, 'execute'>
  parseRequest(request: TRequest): TParsedRequest
  toResponse(input: {
    request: TRequest
    parsedRequest: TParsedRequest
    warnings: string[]
    result: Awaited<ReturnType<PreviewSourceUseCase['execute']>>
  }): TResponse
}

export interface ParsedPreviewRequest extends PreviewSourceRequest {
  warnings?: string[]
}

export interface PreviewExecutionResult {
  warnings: string[]
  fetchMeta: {
    ok: boolean
    payloadBytes?: number
    fetchDurationMs?: number
    parseDurationMs?: number
  }
  parser: string
  rawContent: string
  feed: unknown
  entries: unknown[]
}

export function createPreviewRuntime<
  TRequest,
  TParsedRequest extends ParsedPreviewRequest,
  TResponse,
>(deps: PreviewRuntimeDeps<TRequest, TParsedRequest, TResponse>) {
  return {
    async evaluate(request: TRequest): Promise<TResponse> {
      const parsedRequest = deps.parseRequest(request)
      const result = await deps.previewSourceUseCase.execute({
        source: parsedRequest.source,
        bindings: parsedRequest.bindings,
        scheduledAt: parsedRequest.scheduledAt,
      })

      return deps.toResponse({
        request,
        parsedRequest,
        warnings: parsedRequest.warnings ?? [],
        result,
      })
    },
  }
}

export function createPreviewSourceUseCaseRuntime(input: {
  config: AppConfigResolved
  fetcher?: typeof fetch
  now?: () => string
}) {
  return createPreviewComposition(input).previewSourceUseCase
}

export async function executePreviewSource(input: {
  config: AppConfigResolved
  source: ResolvedSourceConfig
  fetcher?: typeof fetch
  now?: () => string
}): Promise<Awaited<ReturnType<PreviewSourceUseCase['execute']>>> {
  const previewSourceUseCase = createPreviewSourceUseCaseRuntime({
    config: input.config,
    fetcher: input.fetcher,
    now: input.now,
  })

  const definitions = buildLoadedDefinitionsFromResolvedConfig(input.config)
  const sourceDefinition = definitions.sources.find((source) => source.sourceId === input.source.id)
  if (!sourceDefinition) {
    throw new Error(`source 未定义: ${input.source.id}`)
  }

  return await previewSourceUseCase.execute({
    source: sourceDefinition,
    bindings: definitions.bindings.filter((binding) => binding.sourceId === input.source.id),
  })
}

export function toPreviewExecutionResult(input: {
  warnings: string[]
  result: Awaited<ReturnType<PreviewSourceUseCase['execute']>>
}): PreviewExecutionResult {
  return {
    warnings: input.warnings,
    fetchMeta: {
      ok: true,
      payloadBytes: input.result.fetchedInput.rawText?.length,
      fetchDurationMs: undefined,
      parseDurationMs: undefined,
    },
    parser: input.result.parsed.parser,
    rawContent:
      input.result.fetchedInput.rawText ??
      JSON.stringify(input.result.fetchedInput.collectedJson ?? {}),
    feed: input.result.parsed.feed,
    entries: input.result.parsed.items.map((item) => ({ mapped: item })),
  }
}
