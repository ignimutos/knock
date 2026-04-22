import type {
  AiConfigResolved,
  AiModelRefResolved,
  AiModelResolved,
  AiProviderResolved,
} from './types.ts'
import type { AiConfigInput } from './schema.ts'

const AI_PROVIDER_DEFAULTS = {
  openai: {
    context: 128000,
    maxOutputTokens: 16384,
  },
  anthropic: {
    context: 200000,
    maxOutputTokens: 8192,
  },
  gemini: {
    context: 1048576,
    maxOutputTokens: 8192,
  },
} as const

const AI_MODEL_DEFAULTS: Record<string, { context: number; maxOutputTokens: number }> = {
  'gpt-4o': {
    context: 128000,
    maxOutputTokens: 16384,
  },
  'gpt-4o-mini': {
    context: 128000,
    maxOutputTokens: 16384,
  },
  'claude-3-7-sonnet-latest': {
    context: 200000,
    maxOutputTokens: 8192,
  },
  'claude-3-5-haiku-latest': {
    context: 200000,
    maxOutputTokens: 8192,
  },
  'gemini-2.5-flash': {
    context: 1048576,
    maxOutputTokens: 8192,
  },
} as const

function resolveAiModelDefaults(
  providerType: keyof typeof AI_PROVIDER_DEFAULTS,
  model: string,
): { context: number; maxOutputTokens: number } {
  return AI_MODEL_DEFAULTS[model] ?? AI_PROVIDER_DEFAULTS[providerType]
}

function shallowMergeOptions(
  base: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!base && !override) return undefined
  return {
    ...(base ?? {}),
    ...(override ?? {}),
  }
}

function toModelRef(providerId: string, modelId: string): AiModelRefResolved {
  return {
    ref: `${providerId}/${modelId}`,
    providerId,
    modelId,
  }
}

export function resolveAiConfig(input?: AiConfigInput): AiConfigResolved | undefined {
  if (!input) return undefined

  const providers: AiProviderResolved[] = []
  const modelRefs: Record<string, AiModelRefResolved> = {}
  const bareModelRefProviders = new Map<string, string[]>()

  for (const [providerId, provider] of Object.entries(input.providers)) {
    const resolvedProvider: AiProviderResolved = {
      id: providerId,
      type: provider.type,
      apiKey: provider.apiKey,
      baseURL: provider.baseURL,
      headers: provider.headers ? { ...provider.headers } : undefined,
      options: provider.options ? { ...provider.options } : undefined,
      models: [],
    }

    for (const [modelId, model] of Object.entries(provider.models)) {
      const defaults = resolveAiModelDefaults(provider.type, model.model)
      const resolvedModel: AiModelResolved = {
        id: modelId,
        providerId,
        providerType: provider.type,
        ref: `${providerId}/${modelId}`,
        model: model.model,
        context: model.context ?? defaults.context,
        temperature: model.temperature,
        maxOutputTokens: model.maxOutputTokens ?? defaults.maxOutputTokens,
        options: model.options ? { ...model.options } : undefined,
        variants: {},
      }

      for (const [variantId, variant] of Object.entries(model.variants ?? {})) {
        resolvedModel.variants[variantId] = {
          temperature: variant.temperature ?? model.temperature,
          maxOutputTokens: variant.maxOutputTokens ?? resolvedModel.maxOutputTokens,
          options: shallowMergeOptions(model.options, variant.options),
        }
      }

      resolvedProvider.models.push(resolvedModel)

      const ref = toModelRef(providerId, modelId)
      modelRefs[ref.ref] = ref
      bareModelRefProviders.set(modelId, [
        ...(bareModelRefProviders.get(modelId) ?? []),
        providerId,
      ])
      if ((bareModelRefProviders.get(modelId) ?? []).length === 1) {
        modelRefs[modelId] = ref
      }
    }

    providers.push(resolvedProvider)
  }

  for (const [modelId, providerIds] of bareModelRefProviders.entries()) {
    if (providerIds.length > 1) {
      delete modelRefs[modelId]
    }
  }

  const firstModel = providers.flatMap((provider) => provider.models)[0]
  const defaultModel = input.defaultModel
    ? (modelRefs[input.defaultModel] ?? modelRefs[`${input.defaultModel}`])
    : firstModel
      ? toModelRef(firstModel.providerId, firstModel.id)
      : undefined

  return {
    providers,
    defaultModel,
    modelRefs,
  }
}
