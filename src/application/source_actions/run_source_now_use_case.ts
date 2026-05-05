import type { AppConfigResolved } from '../../config/types.ts'
import type { LoadedCompiledConfig } from '../../config/load_compiled_config.ts'
import { buildCurrentReaderOverview, type ReaderOverview } from '../../web/reader_overview.ts'

export interface RunSourceNowUseCaseResult {
  started: boolean
  message: string
  overview: ReaderOverview
}

export class RunSourceNowUseCaseError extends Error {
  constructor(
    message: string,
    readonly kind: 'validation' | 'not_found' | 'conflict',
  ) {
    super(message)
    this.name = 'RunSourceNowUseCaseError'
  }
}

interface SourceActionContext {
  request: {
    sourceId: string
  }
  loaded: LoadedCompiledConfig
  source: AppConfigResolved['sources'][number]
}

type SourceActionContextErrorKind = 'validation' | 'not_found'

type LoadSourceActionContext = (input: unknown) => Promise<SourceActionContext>

function isSourceActionContextError(error: unknown): error is {
  message: string
  kind: SourceActionContextErrorKind
} {
  if (!(error instanceof Error)) {
    return false
  }
  const kind = (error as { kind?: unknown }).kind
  return kind === 'validation' || kind === 'not_found'
}

export class RunSourceNowUseCase {
  constructor(private readonly loadContext: LoadSourceActionContext) {}

  async execute(input: unknown): Promise<RunSourceNowUseCaseResult> {
    let context: SourceActionContext
    try {
      context = await this.loadContext(input)
    } catch (error) {
      if (isSourceActionContextError(error)) {
        throw new RunSourceNowUseCaseError(error.message, error.kind)
      }
      throw error
    }

    if (!context.source.enabled) {
      throw new RunSourceNowUseCaseError(
        `source ${context.request.sourceId} 已停用，不能强制获取`,
        'conflict',
      )
    }

    const { createProductionRuntime } = await import(
      new URL('../../composition/create_production_runtime.ts', import.meta.url).href
    )
    const runtime = createProductionRuntime({
      config: context.loaded.config,
      definitions: context.loaded.definitions,
      keepAlive: false,
    })

    try {
      const result = await runtime.runSourceNow(context.request.sourceId)
      return {
        started: result.started,
        message: result.started
          ? `source ${context.request.sourceId} 强制获取完成`
          : `source ${context.request.sourceId} 正在运行，已跳过本次强制获取`,
        overview: await buildCurrentReaderOverview({ loaded: context.loaded }),
      }
    } finally {
      runtime.stop()
    }
  }
}
