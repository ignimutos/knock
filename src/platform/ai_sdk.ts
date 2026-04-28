type ModelHandleFactory = (modelName: string) => unknown

type CreateModelFactory = (options: unknown) => ModelHandleFactory

interface GenerateTextResult {
  text: string
}

type GenerateText = (input: unknown) => Promise<GenerateTextResult>

interface AiSdkModule {
  generateText: GenerateText
}

interface AnthropicModule {
  createAnthropic: CreateModelFactory
}

interface GoogleModule {
  createGoogleGenerativeAI: CreateModelFactory
}

interface OpenAiModule {
  createOpenAI: CreateModelFactory
}

const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
const [aiMod, anthropicMod, googleMod, openAiMod] = (await Promise.all([
  import(isBunRuntime ? 'ai' : 'npm:ai'),
  import(isBunRuntime ? '@ai-sdk/anthropic' : 'npm:@ai-sdk/anthropic'),
  import(isBunRuntime ? '@ai-sdk/google' : 'npm:@ai-sdk/google'),
  import(isBunRuntime ? '@ai-sdk/openai' : 'npm:@ai-sdk/openai'),
])) as [AiSdkModule, AnthropicModule, GoogleModule, OpenAiModule]

export const generateText = aiMod.generateText
export const createAnthropic = anthropicMod.createAnthropic
export const createGoogleGenerativeAI = googleMod.createGoogleGenerativeAI
export const createOpenAI = openAiMod.createOpenAI
