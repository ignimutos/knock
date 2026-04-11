import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { resolveConfig } from '../config/resolve_config.ts'
import { validateConfig } from '../config/validate_config.ts'
import type { AppConfigInput } from '../config/schema.ts'
import { createAiRuntime } from './ai_runtime.ts'
import { createLogger } from './logger.ts'

function createResolvedAiConfig(context = 8192) {
  return resolveConfig(
    validateConfig({
      runtimeDir: '/tmp/runtime',
      language: 'zh-CN',
      ai: {
        defaultModel: 'openai_main/default',
        providers: {
          openai_main: {
            type: 'openai',
            apiKey: 'test-key',
            models: {
              default: {
                model: 'gpt-4o-mini',
                context,
                maxOutputTokens: 400,
                temperature: 0.2,
                options: {
                  reasoningEffort: 'low',
                },
                variants: {
                  creative: {
                    temperature: 0.8,
                    maxOutputTokens: 300,
                    options: {
                      reasoningEffort: 'medium',
                      json: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    } as AppConfigInput),
  ).ai!
}

function parseRecord(line: string): Record<string, unknown> {
  return JSON.parse(line) as Record<string, unknown>
}

function getScopeName(record: Record<string, unknown>): string {
  const scope = record.scope
  if (!scope || typeof scope !== 'object') {
    throw new Error('缺少 scope')
  }
  return String((scope as { name?: unknown }).name ?? '')
}

function getAttributes(record: Record<string, unknown>): Record<string, unknown> {
  const attributes = record.attributes
  if (!attributes || typeof attributes !== 'object') {
    throw new Error('缺少 attributes')
  }
  return attributes as Record<string, unknown>
}

function createJsonLogger(lines: string[], module = 'core.ai.runtime') {
  return createLogger({
    enabled: true,
    level: 'info',
    module,
    writeStdout: (line) => lines.push(line),
    writeStderr: (line) => lines.push(line),
    writeWarn: (line) => lines.push(line),
  })
}

Deno.test('aiRuntime: translate 0 参数走默认模型与默认 language', async () => {
  const calls: Array<Record<string, unknown>> = []
  const runtime = createAiRuntime({
    ai: createResolvedAiConfig(),
    defaultLanguage: 'zh-CN',
    generateText: (input) => {
      calls.push(input as unknown as Record<string, unknown>)
      return Promise.resolve({ text: '默认译文' })
    },
  })

  const out = await runtime.translate(runtime.createEntryRuntime('s1', 'e1'), 'hello world')

  assertEquals(out, '默认译文')
  assertEquals(calls.length, 1)
  assertEquals(String(calls[0].system).includes('zh-CN'), true)
  assertEquals(calls[0].temperature, 0.2)
  assertEquals(calls[0].maxOutputTokens, 400)
  assertEquals(calls[0].providerOptions, { openai: { reasoningEffort: 'low' } })
})

Deno.test(
  'aiRuntime: translate 应解析 modelRef 与 variant 并下发白名单 providerOptions',
  async () => {
    const calls: Array<Record<string, unknown>> = []
    const runtime = createAiRuntime({
      ai: createResolvedAiConfig(),
      defaultLanguage: 'zh-CN',
      generateText: (input) => {
        calls.push(input as unknown as Record<string, unknown>)
        return Promise.resolve({ text: '创意译文' })
      },
    })

    const out = await runtime.translate(runtime.createEntryRuntime('s1', 'e1'), 'hello world', {
      model: 'openai_main/default',
      variant: 'creative',
      language: 'en',
    })

    assertEquals(out, '创意译文')
    assertEquals(calls.length, 1)
    assertEquals(calls[0].temperature, 0.8)
    assertEquals(calls[0].maxOutputTokens, 300)
    assertEquals(calls[0].providerOptions, {
      openai: { reasoningEffort: 'medium', responseFormat: { type: 'json_object' } },
    })
    assertEquals(String(calls[0].system).includes('en'), true)
  },
)

Deno.test('aiRuntime: entry 级缓存应复用 in-flight 与成功结果', async () => {
  let callCount = 0
  let resolveCall: ((value: { text: string }) => void) | undefined
  const runtime = createAiRuntime({
    ai: createResolvedAiConfig(),
    defaultLanguage: 'zh-CN',
    generateText: (input) => {
      void input
      callCount += 1
      return new Promise((resolve) => {
        resolveCall = resolve
      })
    },
  })

  const entryRuntime = runtime.createEntryRuntime('s1', 'e1')
  const first = runtime.translate(entryRuntime, 'same text')
  const second = runtime.translate(entryRuntime, 'same text')
  resolveCall?.({ text: '复用结果' })

  assertEquals(await first, '复用结果')
  assertEquals(await second, '复用结果')
  assertEquals(callCount, 1)

  const third = await runtime.translate(entryRuntime, 'same text')
  assertEquals(third, '复用结果')
  assertEquals(callCount, 1)
})

Deno.test('aiRuntime: 失败结果也应在 entry 级缓存中复用并继续抛错', async () => {
  let callCount = 0
  const runtime = createAiRuntime({
    ai: createResolvedAiConfig(),
    defaultLanguage: 'zh-CN',
    generateText: () => {
      callCount += 1
      return Promise.reject(new Error('provider failed'))
    },
  })

  const entryRuntime = runtime.createEntryRuntime('s1', 'e1')
  await assertRejects(() => runtime.translate(entryRuntime, 'boom'), Error, 'provider failed')
  await assertRejects(() => runtime.translate(entryRuntime, 'boom'), Error, 'provider failed')
  assertEquals(callCount, 1)
})

Deno.test('aiRuntime: translate 超长时按段调用并只让每段输出当前 chunk', async () => {
  const prompts: string[] = []
  const runtime = createAiRuntime({
    ai: createResolvedAiConfig(1500),
    defaultLanguage: 'zh-CN',
    generateText: (input) => {
      prompts.push(String(input.prompt))
      return Promise.resolve({ text: `[${prompts.length}]` })
    },
  })

  const text = ['A'.repeat(1200), 'B'.repeat(1200), 'C'.repeat(1200)].join('\n\n')
  const out = await runtime.translate(runtime.createEntryRuntime('s1', 'e1'), text)

  assertEquals(prompts.length > 1, true)
  assertEquals(out, prompts.map((_, index) => `[${index + 1}]`).join(''))
  assertEquals(
    prompts.every((prompt) => prompt.includes('<CURRENT_CHUNK>')),
    true,
  )
  assertEquals(
    prompts.every((prompt) => prompt.includes('<PREVIOUS_CONTEXT>')),
    true,
  )
  assertEquals(
    prompts.every((prompt) => prompt.includes('<NEXT_CONTEXT>')),
    true,
  )
})

Deno.test('aiRuntime: summarize 超长时应先分段摘要再做 reduce', async () => {
  const stages: Array<{ system: string; prompt: string; maxOutputTokens?: unknown }> = []
  const runtime = createAiRuntime({
    ai: createResolvedAiConfig(1500),
    defaultLanguage: 'zh-CN',
    generateText: (input) => {
      stages.push({
        system: String(input.system),
        prompt: String(input.prompt),
        maxOutputTokens: input.maxOutputTokens,
      })
      const isReduce = String(input.prompt).includes('<CHUNK_SUMMARIES>')
      return Promise.resolve(
        isReduce ? { text: 'final-summary' } : { text: `chunk-${stages.length}` },
      )
    },
  })

  const text = ['A'.repeat(1200), 'B'.repeat(1200), 'C'.repeat(1200)].join('\n\n')
  const out = await runtime.summarize(runtime.createEntryRuntime('s1', 'e1'), text)

  assertEquals(out, 'final-summary')
  assertEquals(stages.length > 1, true)
  const chunkStages = stages.filter((stage) => stage.prompt.includes('<CHUNK index='))
  const reduceStage = stages.find((stage) => stage.prompt.includes('<CHUNK_SUMMARIES>'))
  assertEquals(chunkStages.length > 1, true)
  assertEquals(reduceStage !== undefined, true)
  assertEquals(reduceStage?.prompt.includes('chunk-1'), true)
})

Deno.test(
  'aiRuntime: summarize reduce 输入超长时仍应保留所有 chunk 摘要并分层 reduce',
  async () => {
    const prompts: string[] = []
    let reduceCallCount = 0
    const runtime = createAiRuntime({
      ai: createResolvedAiConfig(2200),
      defaultLanguage: 'zh-CN',
      generateText: (input) => {
        const prompt = String(input.prompt)
        prompts.push(prompt)
        const isReduce = prompt.includes('<CHUNK_SUMMARIES>')
        if (!isReduce) {
          const match = prompt.match(/<CHUNK index="(\d+)"/)
          return Promise.resolve({ text: `chunk-${match?.[1] ?? 'x'}-${'S'.repeat(1200)}` })
        }
        reduceCallCount += 1
        return Promise.resolve({
          text:
            prompt.includes('mid-') || prompt.includes('final-summary')
              ? 'final-summary'
              : `mid-${reduceCallCount}-${'R'.repeat(1200)}`,
        })
      },
    })

    const text = ['A'.repeat(2400), 'B'.repeat(2400), 'C'.repeat(2400)].join('\n\n')
    const out = await runtime.summarize(runtime.createEntryRuntime('s1', 'e1'), text)

    assertEquals(out, 'final-summary')
    const reducePrompts = prompts.filter((prompt) => prompt.includes('<CHUNK_SUMMARIES>'))
    assertEquals(reducePrompts.length > 1, true)
    const firstLevelReduce = reducePrompts.slice(0, -1).join('\n')
    assertEquals(firstLevelReduce.includes('chunk-1-'), true)
    assertEquals(firstLevelReduce.includes('chunk-2-'), true)
    assertEquals(firstLevelReduce.includes('chunk-3-'), true)
    const higherLevelReduce = reducePrompts.slice(1).join('\n')
    assertEquals(
      higherLevelReduce.includes('mid-') || higherLevelReduce.includes('final-summary'),
      true,
    )
  },
)

Deno.test('aiRuntime: translate 0 参数应消费 resolved config 默认 language', async () => {
  const calls: Array<Record<string, unknown>> = []
  const resolved = resolveConfig(
    validateConfig({
      runtimeDir: '/tmp/runtime',
      ai: {
        defaultModel: 'openai_main/default',
        providers: {
          openai_main: {
            type: 'openai',
            apiKey: 'test-key',
            models: {
              default: {
                model: 'gpt-4o-mini',
                context: 8192,
                maxOutputTokens: 400,
              },
            },
          },
        },
      },
    } as AppConfigInput),
  )
  const runtime = createAiRuntime({
    ai: resolved.ai,
    defaultLanguage: resolved.language,
    generateText: (input) => {
      calls.push(input as unknown as Record<string, unknown>)
      return Promise.resolve({ text: '默认译文' })
    },
  })

  const out = await runtime.translate(runtime.createEntryRuntime('s1', 'e1'), 'hello world')

  assertEquals(out, '默认译文')
  assertEquals(String(calls[0].system).includes(resolved.language!), true)
})

Deno.test('aiRuntime: 缺少默认 language 时 translate 应直接报错', async () => {
  const runtime = createAiRuntime({
    ai: createResolvedAiConfig(),
    generateText: () => Promise.resolve({ text: 'should-not-run' }),
  })

  await assertRejects(
    () => runtime.translate(runtime.createEntryRuntime('s1', 'e1'), 'hello'),
    Error,
    '未配置 language',
  )
})

Deno.test('aiRuntime: AI 调用完成与缓存命中应继承注入 logger module 并不泄露正文', async () => {
  const lines: string[] = []
  const runtime = createAiRuntime({
    ai: createResolvedAiConfig(),
    defaultLanguage: 'zh-CN',
    logger: createJsonLogger(lines, 'test.ai.runtime'),
    now: (() => {
      const values = [1000, 1020]
      let index = 0
      return () => values[index++] ?? values[values.length - 1]
    })(),
    generateText: () => Promise.resolve({ text: '译文结果' }),
  })

  const entryRuntime = runtime.createEntryRuntime('source-a', 'entry-a')
  const first = await runtime.translate(entryRuntime, 'very secret body')
  const second = await runtime.translate(entryRuntime, 'very secret body')

  assertEquals(first, '译文结果')
  assertEquals(second, '译文结果')
  assertEquals(lines.length, 2)

  const successRecord = parseRecord(lines[0])
  const successAttributes = getAttributes(successRecord)
  assertEquals(successRecord.body, 'AI 调用完成')
  assertEquals(getScopeName(successRecord), 'test.ai.runtime')
  assertEquals(successAttributes.operation, 'generate')
  assertEquals(successAttributes.outcome, 'success')
  assertEquals(successAttributes['source.id'], 'source-a')
  assertEquals(successAttributes['pipeline.item_id'], 'entry-a')
  assertEquals(successAttributes.duration_ms, 20)
  assertEquals(successAttributes.input_length, 16)
  assertEquals(successAttributes.output_length, 4)
  assertEquals(successAttributes.truncated, false)
  assertEquals(successAttributes['ai.provider'], 'openai')
  assertEquals(successAttributes['ai.model'], 'gpt-4o-mini')
  assertEquals(successAttributes['ai.model_ref'], 'openai_main/default')
  assertEquals(successAttributes['ai.prompt_id'], 'ai_translate')
  assertEquals(successAttributes['ai.stage'], 'translate.single')
  assertEquals(successAttributes['ai.cache'], false)
  assertEquals(successAttributes['ai.chunk'], false)
  assertEquals(String(JSON.stringify(successRecord)).includes('secret'), false)

  const cacheHitRecord = parseRecord(lines[1])
  const cacheHitAttributes = getAttributes(cacheHitRecord)
  assertEquals(cacheHitRecord.body, 'AI 缓存命中')
  assertEquals(getScopeName(cacheHitRecord), 'test.ai.runtime')
  assertEquals(cacheHitAttributes.operation, 'generate')
  assertEquals(cacheHitAttributes.outcome, 'cache_hit')
  assertEquals(cacheHitAttributes['source.id'], 'source-a')
  assertEquals(cacheHitAttributes['pipeline.item_id'], 'entry-a')
  assertEquals(cacheHitAttributes.input_length, 16)
  assertEquals(cacheHitAttributes.truncated, false)
  assertEquals(cacheHitAttributes['ai.provider'], 'openai')
  assertEquals(cacheHitAttributes['ai.model'], 'gpt-4o-mini')
  assertEquals(cacheHitAttributes['ai.model_ref'], 'openai_main/default')
  assertEquals(cacheHitAttributes['ai.prompt_id'], 'ai_translate')
  assertEquals(cacheHitAttributes['ai.stage'], 'translate.single')
  assertEquals(cacheHitAttributes['ai.cache'], true)
  assertEquals(cacheHitAttributes['ai.chunk'], false)
  assertEquals(String(JSON.stringify(cacheHitRecord)).includes('secret'), false)
})

Deno.test('aiRuntime: AI 失败应写入固定摘要且继承注入 logger module', async () => {
  const lines: string[] = []
  const runtime = createAiRuntime({
    ai: createResolvedAiConfig(),
    defaultLanguage: 'zh-CN',
    logger: createJsonLogger(lines, 'test.ai.runtime'),
    now: (() => {
      const values = [1000, 1020]
      let index = 0
      return () => values[index++] ?? values[values.length - 1]
    })(),
    generateText: () => Promise.reject(new Error('provider returned very secret body')),
  })

  await assertRejects(
    () => runtime.translate(runtime.createEntryRuntime('source-a', 'entry-a'), 'very secret body'),
    Error,
    'provider returned very secret body',
  )

  assertEquals(lines.length, 1)
  const record = parseRecord(lines[0])
  const attributes = getAttributes(record)
  assertEquals(record.body, 'AI 调用失败')
  assertEquals(getScopeName(record), 'test.ai.runtime')
  assertEquals(attributes.operation, 'generate')
  assertEquals(attributes.outcome, 'failure')
  assertEquals(attributes['source.id'], 'source-a')
  assertEquals(attributes['pipeline.item_id'], 'entry-a')
  assertEquals(attributes.duration_ms, 20)
  assertEquals(attributes.input_length, 16)
  assertEquals(attributes.truncated, false)
  assertEquals(attributes['exception.type'], 'Error')
  assertEquals(attributes['exception.message'], 'AI 调用失败，错误详情已省略')
  assertEquals(attributes['ai.error.message'], undefined)
  assertEquals(attributes['ai.error.status_code'], undefined)
  assertEquals(attributes['ai.error.retryable'], undefined)
  assertEquals(attributes['ai.provider'], 'openai')
  assertEquals(attributes['ai.model'], 'gpt-4o-mini')
  assertEquals(attributes['ai.model_ref'], 'openai_main/default')
  assertEquals(attributes['ai.prompt_id'], 'ai_translate')
  assertEquals(attributes['ai.stage'], 'translate.single')
  assertEquals(attributes['ai.cache'], false)
  assertEquals(attributes['ai.chunk'], false)
  assertEquals(String(JSON.stringify(record)).includes('secret'), false)
  assertEquals(String(JSON.stringify(record)).includes('provider returned'), false)
})

Deno.test('aiRuntime: AI 401 失败应记录安全诊断字段而不泄露原始 body', async () => {
  const lines: string[] = []
  const error = Object.assign(new Error('Unauthorized'), {
    name: 'AI_APICallError',
    statusCode: 401,
    isRetryable: false,
    responseBody: 'very secret provider body',
  })
  const runtime = createAiRuntime({
    ai: createResolvedAiConfig(),
    defaultLanguage: 'zh-CN',
    logger: createJsonLogger(lines, 'test.ai.runtime'),
    now: (() => {
      const values = [1000, 1006]
      let index = 0
      return () => values[index++] ?? values[values.length - 1]
    })(),
    generateText: () => Promise.reject(error),
  })

  await assertRejects(
    () => runtime.translate(runtime.createEntryRuntime('source-a', 'entry-a'), 'hello body'),
    Error,
    'Unauthorized',
  )

  assertEquals(lines.length, 1)
  const record = parseRecord(lines[0])
  const attributes = getAttributes(record)
  assertEquals(record.body, 'AI 调用失败')
  assertEquals(attributes['exception.type'], 'AI_APICallError')
  assertEquals(attributes['exception.message'], 'AI 调用失败，错误详情已省略')
  assertEquals(attributes['ai.error.message'], 'Unauthorized')
  assertEquals(attributes['ai.error.status_code'], 401)
  assertEquals(attributes['ai.error.retryable'], false)
  assertEquals(String(JSON.stringify(record)).includes('very secret provider body'), false)
  assertEquals(String(JSON.stringify(record)).includes('hello body'), false)
  assertStringIncludes(String(JSON.stringify(record)), 'Unauthorized')
})
