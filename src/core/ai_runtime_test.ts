import { assertEquals, assertRejects } from '@std/assert'
import { resolveConfig } from '../config/resolve_config.ts'
import { validateConfig } from '../config/validate_config.ts'
import type { AppConfigInput } from '../config/schema.ts'
import { createAiRuntime } from './ai_runtime.ts'
import type { Logger } from './logger.ts'

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

function createTestLogger(records: Array<Record<string, unknown>>): Logger {
  const write = (level: string, message: string, fields?: Record<string, unknown>) => {
    records.push({ level, message, ...(fields ?? {}) })
  }

  return {
    trace: (message, fields) => write('trace', message, fields),
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: () => createTestLogger(records),
  }
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

Deno.test('aiRuntime: AI 失败应记录元信息但不泄露正文', async () => {
  const logs: Array<Record<string, unknown>> = []
  const runtime = createAiRuntime({
    ai: createResolvedAiConfig(),
    defaultLanguage: 'zh-CN',
    logger: createTestLogger(logs),
    now: (() => {
      const values = [1000, 1020]
      let index = 0
      return () => values[index++] ?? values[values.length - 1]
    })(),
    generateText: () => Promise.reject(new Error('upstream broken')),
  })

  await assertRejects(
    () => runtime.translate(runtime.createEntryRuntime('source-a', 'entry-a'), 'very secret body'),
    Error,
    'upstream broken',
  )

  assertEquals(
    logs.some(
      (item) =>
        item.message === 'AI 调用失败' &&
        item.provider === 'openai' &&
        item.model_ref === 'openai_main/default' &&
        item.stage === 'translate.single' &&
        item.input_length === 16 &&
        item.error_message === 'upstream broken',
    ),
    true,
  )
  assertEquals(
    logs.some((item) => String(item.prompt ?? '').includes('secret')),
    false,
  )
  assertEquals(
    logs.some((item) => String(item.input_text ?? '').includes('secret')),
    false,
  )
})
