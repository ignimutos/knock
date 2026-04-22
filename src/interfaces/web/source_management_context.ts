import type { AppConfigResolved } from '../../config/types.ts'
import { loadCompiledConfig, type LoadedCompiledConfig } from '../../config/load_compiled_config.ts'
import { getConfigDocumentLookupFromEnv } from '../../config/raw_config_document.ts'
import { parseSourceAction, SourceManagementContractError } from './source_management_contract.ts'

export interface SourceActionContext {
  request: {
    sourceId: string
  }
  loaded: LoadedCompiledConfig
  source: AppConfigResolved['sources'][number]
}

export class SourceActionContextError extends Error {
  constructor(
    message: string,
    readonly kind: 'validation' | 'not_found',
  ) {
    super(message)
    this.name = 'SourceActionContextError'
  }
}

export async function loadSourceActionContext(input: unknown): Promise<SourceActionContext> {
  let request: { sourceId: string }
  try {
    request = parseSourceAction(input)
  } catch (error) {
    if (error instanceof SourceManagementContractError) {
      throw new SourceActionContextError(error.message, 'validation')
    }
    throw error
  }

  const loaded = await loadCompiledConfig({
    ...getConfigDocumentLookupFromEnv(),
    envMode: 'preserve_unknown',
  })
  const source = loaded.config.sources.find((item) => item.id === request.sourceId)
  if (!source) {
    throw new SourceActionContextError(`source 未定义: ${request.sourceId}`, 'not_found')
  }

  return {
    request,
    loaded,
    source,
  }
}
