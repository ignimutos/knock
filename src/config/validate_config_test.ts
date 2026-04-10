import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import { validateConfig } from './validate_config.ts'
import type { AppConfigInput } from './schema.ts'

Deno.test('validateConfig: schema 静态默认值应在校验阶段生效', () => {
  const validated = validateConfig({
    runtimeDir: '/tmp/runtime',
    sqlite: {},
    logging: {},
  })

  assertEquals(validated.timestampFormat, 'yyyy-MM-dd HH:mm:ss')
  assertEquals(validated.sqlite, {
    path: 'knock.db',
    busyTimeout: '5s',
    journalMode: 'WAL',
    retention: {
      maxAge: '180d',
      maxEntriesPerSource: 1000,
      vacuum: 'off',
    },
  })
  assertEquals(validated.logging, {
    level: 'info',
    format: 'json',
    sinks: {
      console: {
        type: 'console',
      },
    },
  })
})

Deno.test('validateConfig: logging.format 支持 pretty', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    logging: {
      format: 'pretty',
    },
  }

  const validated = validateConfig(input)
  assertEquals(validated.logging.format, 'pretty')
})

Deno.test('validateConfig: 新 push.http + push.request + source.http.url shape 应通过', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      webhook: {
        push: {
          http: {
            method: 'POST',
            url: 'https://example.com/hook',
            timeout: '10s',
            proxy: 'http://proxy.internal:8080',
            headers: {
              Authorization: 'Bearer token',
            },
          },
          request: {
            type: 'body',
            payload: {
              text: '{{ entry.title }}',
            },
          },
        },
      },
    },
    sources: {
      feed: {
        http: {
          url: 'https://example.com/feed.xml',
          timeout: '5s',
          proxy: 'socks5://127.0.0.1:1080',
          headers: {
            'User-Agent': 'knock-test',
          },
        },
        deliveries: ['webhook'],
      },
    },
  }

  validateConfig(input)
})

Deno.test('validateConfig: push.http.method 与 push.request.type 未配置时应使用默认值', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      webhook: {
        push: {
          http: {
            url: 'https://example.com/hook',
          },
        },
      },
    },
  }

  const validated = validateConfig(input)
  const push = validated.deliveries.webhook.push
  assertEquals(push?.http.method, 'POST')
  assertEquals(push?.request.type, 'body')
})

Deno.test('validateConfig: push.request 为空对象时也应补全 body 默认值', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      webhook: {
        push: {
          http: {
            url: 'https://example.com/hook',
          },
          request: {},
        },
      },
    },
  }

  const validated = validateConfig(input)
  assertEquals(validated.deliveries.webhook.push?.request.type, 'body')
})

Deno.test('validateConfig: 旧 delivery.http 应拒绝并指向新路径', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      webhook: {
        http: {
          timeout: '10s',
        },
        push: {
          http: {
            method: 'POST',
            url: 'https://example.com/hook',
          },
          request: {
            type: 'body',
          },
        },
      },
    },
  } as AppConfigInput

  assertThrows(
    () => validateConfig(input),
    Error,
    'delivery.webhook.http 已废弃，请改用 delivery.webhook.push.http',
  )
})

Deno.test('validateConfig: 旧 push.http.type/payload 或新旧混用应拒绝', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      webhook: {
        push: {
          http: {
            method: 'POST',
            url: 'https://example.com/hook',
            type: 'body',
          },
          request: {
            payload: {
              text: 'hello',
            },
          },
        },
      },
    },
  } as unknown as AppConfigInput

  const err = assertThrows(() => validateConfig(input), Error)
  assertStringIncludes(err.message, 'delivery.webhook.push.http.type')
})

Deno.test('validateConfig: push.http.url 为空时应报错', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      webhook: {
        push: {
          http: {
            method: 'POST',
            url: '   ',
          },
        },
      },
    },
  } as AppConfigInput

  assertThrows(() => validateConfig(input), Error, 'delivery.webhook.push.http.url 必填')
})

Deno.test('validateConfig: push.http.url 不支持 Liquid 模板时应报错', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      webhook: {
        push: {
          http: {
            method: 'POST',
            url: '{{ entry.link }}',
          },
        },
      },
    },
  } as unknown as AppConfigInput

  assertThrows(
    () => validateConfig(input),
    Error,
    'delivery.webhook.push.http.url 配置非法: deliveries.*.push.http.url 不支持 Liquid 模板',
  )
})

Deno.test('validateConfig: push.http.method 非法时应报错', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      webhook: {
        push: {
          http: {
            method: 'TRACE',
            url: 'https://example.com/hook',
          },
        },
      },
    },
  } as unknown as AppConfigInput

  assertThrows(
    () => validateConfig(input),
    Error,
    'delivery.webhook.push.http.method 配置非法: TRACE',
  )
})

Deno.test('validateConfig: GET/HEAD + body payload 应拒绝', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      webhook: {
        push: {
          http: {
            method: 'GET',
            url: 'https://example.com/hook',
          },
          request: {
            type: 'body',
            payload: {
              text: 'hello',
            },
          },
        },
      },
    },
  } as AppConfigInput

  assertThrows(
    () => validateConfig(input),
    Error,
    'delivery.webhook.push.request.payload 配置非法: GET/HEAD 请求不允许 body payload',
  )
})

Deno.test('validateConfig: push.http.proxy 协议非法时应报错', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      webhook: {
        push: {
          http: {
            method: 'POST',
            url: 'https://example.com/hook',
            proxy: 'ftp://proxy.internal:21',
          },
        },
      },
    },
  } as AppConfigInput

  assertThrows(
    () => validateConfig(input),
    Error,
    'delivery.webhook.push.http.proxy 配置非法: ftp://proxy.internal:21',
  )
})

Deno.test('validateConfig: push.http.proxy 格式非法时应报错', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      webhook: {
        push: {
          http: {
            method: 'POST',
            url: 'https://example.com/hook',
            proxy: 'proxy.internal:8080',
          },
        },
      },
    },
  } as AppConfigInput

  assertThrows(
    () => validateConfig(input),
    Error,
    'delivery.webhook.push.http.proxy 配置非法: proxy.internal:8080',
  )
})

Deno.test('validateConfig: source.http 与 source.byparr 不能同时存在，且不能同时缺失', () => {
  const bothPresent = {
    runtimeDir: '/tmp/runtime',
    sources: {
      feed: {
        http: {
          url: 'https://example.com/feed.xml',
        },
        byparr: {
          endpoint: 'http://byparr:8191/v1',
          url: 'https://example.com/news',
        },
      },
    },
  } as unknown as AppConfigInput

  assertThrows(() => validateConfig(bothPresent), Error, 'source.feed 不能同时配置 http 与 byparr')

  const bothMissing = {
    runtimeDir: '/tmp/runtime',
    sources: {
      feed: {
        syndication: {},
      },
    },
  } as unknown as AppConfigInput

  assertThrows(() => validateConfig(bothMissing), Error, 'source.feed 必须配置 http 或 byparr')
})

Deno.test('validateConfig: source.byparr 合法配置应通过并使用默认值', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    sources: {
      news: {
        byparr: {
          url: 'https://example.com/news',
          proxy: 'http://user:@127.0.0.1:8080',
        },
        xquery: {
          entry: {
            id: 'string(//article/@id)',
          },
        },
      },
    },
  }

  const validated = validateConfig(input)
  assertEquals(validated.sources.news.byparr?.endpoint, 'http://byparr:8191/v1')
  assertEquals(validated.sources.news.byparr?.cmd, 'request.get')
  assertEquals(validated.sources.news.byparr?.maxTimeout, '60s')
})

Deno.test('validateConfig: source.byparr 关键字段缺失时应报错', () => {
  const missingUrl = {
    runtimeDir: '/tmp/runtime',
    sources: {
      news: {
        byparr: {
          endpoint: 'http://byparr:8191/v1',
        },
      },
    },
  } as unknown as AppConfigInput

  assertThrows(() => validateConfig(missingUrl), Error, 'source.news.byparr.url 必填')
})

Deno.test('validateConfig: source.byparr.proxy 协议非法时应报错', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    sources: {
      news: {
        byparr: {
          endpoint: 'http://byparr:8191/v1',
          url: 'https://example.com/news',
          proxy: 'ftp://proxy.internal:21',
        },
      },
    },
  } as unknown as AppConfigInput

  assertThrows(
    () => validateConfig(input),
    Error,
    'source.news.byparr.proxy 配置非法: ftp://proxy.internal:21',
  )
})

Deno.test('validateConfig: source.http.proxy 支持带认证信息 URL', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    sources: {
      feed: {
        http: {
          url: 'https://example.com/feed.xml',
          proxy: 'http://user:pass@127.0.0.1:8080',
        },
      },
    },
  }

  validateConfig(input)
})

Deno.test('validateConfig: transport key 放在 source 错误层级时应报告完整路径', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    sources: {
      rust: {
        http: {
          url: 'https://example.com/feed.xml',
        },
        timeout: '5s',
      },
    },
  } as unknown as AppConfigInput

  assertThrows(() => validateConfig(input), Error, 'source.rust.timeout 配置非法')
})

Deno.test('validateConfig: email.smtp + email.message 合法配置应通过', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      release_email: {
        email: {
          smtp: {
            host: 'smtp.example.com',
            port: 587,
            security: 'starttls',
            auth: {
              username: 'user',
              password: 'pass',
            },
          },
          message: {
            from: '{{ source.id }}@example.com',
            to: ['team+{{ entry.id }}@example.com'],
            cc: ['ops@example.com'],
            bcc: ['audit@example.com'],
            replyTo: ['reply@example.com'],
            subject: '[{{ source.id }}] {{ entry.title }}',
            text: '{{ entry.title }}',
            html: '<p>{{ entry.title }}</p>',
            headers: {
              'X-Knock-Source': '{{ source.id }}',
            },
          },
        },
      },
    },
    sources: {
      feed: {
        http: {
          url: 'https://example.com/feed.xml',
        },
        deliveries: ['release_email'],
      },
    },
  } as const satisfies AppConfigInput

  const validated = validateConfig(input)
  assertEquals(validated.deliveries.release_email.email?.smtp.security, 'starttls')
  assertEquals(validated.deliveries.release_email.email?.message.to, [
    'team+{{ entry.id }}@example.com',
  ])
})

Deno.test('validateConfig: delivery 不能同时配置 push 与 email', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      mixed: {
        push: {
          http: {
            url: 'https://example.com/webhook',
          },
        },
        email: {
          smtp: {
            host: 'smtp.example.com',
            port: 587,
            security: 'starttls',
          },
          message: {
            from: 'bot@example.com',
            to: ['team@example.com'],
            subject: 'hello',
            text: 'world',
          },
        },
      },
    },
  } as unknown as AppConfigInput

  assertThrows(() => validateConfig(input), Error, 'delivery 不能同时配置 file、push 与 email')
})

Deno.test('validateConfig: email.message.text 与 html 不能同时缺失', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      release_email: {
        email: {
          smtp: {
            host: 'smtp.example.com',
            port: 587,
            security: 'implicit',
          },
          message: {
            from: 'bot@example.com',
            to: ['team@example.com'],
            subject: 'hello',
          },
        },
      },
    },
  } as unknown as AppConfigInput

  assertThrows(
    () => validateConfig(input),
    Error,
    'delivery.release_email.email.message 必须至少配置 text 或 html',
  )
})

Deno.test('validateConfig: email.smtp.security 非法时应报错', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      release_email: {
        email: {
          smtp: {
            host: 'smtp.example.com',
            port: 587,
            security: 'tls',
          },
          message: {
            from: 'bot@example.com',
            to: ['team@example.com'],
            subject: 'hello',
            text: 'world',
          },
        },
      },
    },
  } as unknown as AppConfigInput

  assertThrows(
    () => validateConfig(input),
    Error,
    'delivery.release_email.email.smtp.security 配置非法: tls',
  )
})

Deno.test('validateConfig: 非法 timezone 时应报错', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    timezone: 'Invalid/Zone',
    sources: {},
  } as AppConfigInput

  assertThrows(() => validateConfig(input), Error, 'timezone 配置非法: Invalid/Zone')
})

Deno.test('validateConfig: language 应做 BCP47 规范化', () => {
  const validated = validateConfig({
    runtimeDir: '/tmp/runtime',
    language: 'ZH-cn',
  } as AppConfigInput)

  assertEquals(validated.language, 'zh-CN')
})

Deno.test('validateConfig: 非法 language 时应报错', () => {
  assertThrows(
    () =>
      validateConfig({
        runtimeDir: '/tmp/runtime',
        language: 'not a language',
      } as AppConfigInput),
    Error,
    'language 配置非法: not a language',
  )
})

Deno.test('validateConfig: AI provider.type 仅支持 openai anthropic gemini', () => {
  assertThrows(
    () =>
      validateConfig({
        runtimeDir: '/tmp/runtime',
        ai: {
          providers: {
            main: {
              type: 'azure',
              models: {
                default: {
                  model: 'gpt-4o-mini',
                },
              },
            },
          },
        },
      } as unknown as AppConfigInput),
    Error,
    'ai.providers.main.type 配置非法: azure',
  )
})

Deno.test('validateConfig: gemini provider 不支持 provider-specific options', () => {
  assertThrows(
    () =>
      validateConfig({
        runtimeDir: '/tmp/runtime',
        ai: {
          providers: {
            google: {
              type: 'gemini',
              options: {
                project: 'demo',
              },
              models: {
                flash: {
                  model: 'gemini-2.5-flash',
                },
              },
            },
          },
        },
      } as unknown as AppConfigInput),
    Error,
    'ai.providers.google.options 配置非法: gemini provider 不支持 options',
  )
})

Deno.test('validateConfig: openai model/variant options 仅支持已落地字段', () => {
  const validated = validateConfig({
    runtimeDir: '/tmp/runtime',
    ai: {
      providers: {
        openai_main: {
          type: 'openai',
          models: {
            default: {
              model: 'gpt-4o-mini',
              options: {
                reasoningEffort: 'low',
                json: false,
              },
              variants: {
                creative: {
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
  } as unknown as AppConfigInput)

  assertEquals(validated.ai?.providers.openai_main.models.default.options, {
    reasoningEffort: 'low',
    json: false,
  })
  assertEquals(validated.ai?.providers.openai_main.models.default.variants?.creative.options, {
    reasoningEffort: 'medium',
    json: true,
  })
})

Deno.test('validateConfig: openai model/variant options 不支持未落地字段', () => {
  assertThrows(
    () =>
      validateConfig({
        runtimeDir: '/tmp/runtime',
        ai: {
          providers: {
            openai_main: {
              type: 'openai',
              models: {
                default: {
                  model: 'gpt-4o-mini',
                  options: {
                    responseFormat: 'json_schema',
                  },
                },
              },
            },
          },
        },
      } as unknown as AppConfigInput),
    Error,
    'ai.providers.openai_main.models.default.options.responseFormat 非法',
  )
})

Deno.test('validateConfig: anthropic 与 gemini 的非空 model/variant options 应在配置期报错', () => {
  assertThrows(
    () =>
      validateConfig({
        runtimeDir: '/tmp/runtime',
        ai: {
          providers: {
            claude: {
              type: 'anthropic',
              models: {
                sonnet: {
                  model: 'claude-3-7-sonnet-latest',
                  options: {
                    reasoningEffort: 'low',
                  },
                },
              },
            },
          },
        },
      } as unknown as AppConfigInput),
    Error,
    'ai.providers.claude.models.sonnet.options 配置非法: anthropic model 不支持 options',
  )

  assertThrows(
    () =>
      validateConfig({
        runtimeDir: '/tmp/runtime',
        ai: {
          providers: {
            google: {
              type: 'gemini',
              models: {
                flash: {
                  model: 'gemini-2.5-flash',
                  variants: {
                    fast: {
                      options: {
                        json: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      } as unknown as AppConfigInput),
    Error,
    'ai.providers.google.models.flash.variants.fast.options 配置非法: gemini variant 不支持 options',
  )
})

Deno.test('validateConfig: anthropic 同时配置 apiKey 与 authToken 时应报错', () => {
  assertThrows(
    () =>
      validateConfig({
        runtimeDir: '/tmp/runtime',
        ai: {
          providers: {
            claude: {
              type: 'anthropic',
              apiKey: 'key',
              options: {
                authToken: 'token',
              },
              models: {
                sonnet: {
                  model: 'claude-3-7-sonnet-latest',
                },
              },
            },
          },
        },
      } as unknown as AppConfigInput),
    Error,
    'ai.providers.claude 不能同时配置 apiKey 与 options.authToken',
  )
})

Deno.test('validateConfig: provider-specific options 允许 ENV 但不允许 Liquid', () => {
  const envValidated = validateConfig({
    runtimeDir: '/tmp/runtime',
    ai: {
      providers: {
        openai_main: {
          type: 'openai',
          options: {
            organization: '${OPENAI_ORG}',
            project: '${OPENAI_PROJECT}',
          },
          models: {
            mini: {
              model: 'gpt-4o-mini',
            },
          },
        },
        claude: {
          type: 'anthropic',
          options: {
            authToken: '${ANTHROPIC_AUTH_TOKEN}',
          },
          models: {
            sonnet: {
              model: 'claude-3-7-sonnet-latest',
            },
          },
        },
      },
    },
  } as unknown as AppConfigInput)

  assertEquals(envValidated.ai?.providers.openai_main.options, {
    organization: '${OPENAI_ORG}',
    project: '${OPENAI_PROJECT}',
  })
  assertEquals(envValidated.ai?.providers.claude.options, {
    authToken: '${ANTHROPIC_AUTH_TOKEN}',
  })

  assertThrows(
    () =>
      validateConfig({
        runtimeDir: '/tmp/runtime',
        ai: {
          providers: {
            openai_main: {
              type: 'openai',
              options: {
                organization: '{{ entry.title }}',
              },
              models: {
                mini: {
                  model: 'gpt-4o-mini',
                },
              },
            },
          },
        },
      } as unknown as AppConfigInput),
    Error,
    'ai.providers.openai_main.options.organization 配置非法: ai.providers.*.options.organization 不支持 Liquid 模板',
  )

  assertThrows(
    () =>
      validateConfig({
        runtimeDir: '/tmp/runtime',
        ai: {
          providers: {
            claude: {
              type: 'anthropic',
              options: {
                authToken: '{{ entry.title }}',
              },
              models: {
                sonnet: {
                  model: 'claude-3-7-sonnet-latest',
                },
              },
            },
          },
        },
      } as unknown as AppConfigInput),
    Error,
    'ai.providers.claude.options.authToken 配置非法: ai.providers.*.options.authToken 不支持 Liquid 模板',
  )
})

Deno.test('validateConfig: defaultModel 不允许 ENV 或 Liquid', () => {
  assertThrows(
    () =>
      validateConfig({
        runtimeDir: '/tmp/runtime',
        ai: {
          defaultModel: '${OPENAI_DEFAULT_MODEL}',
          providers: {
            main: {
              type: 'openai',
              models: {
                mini: {
                  model: 'gpt-4o-mini',
                },
              },
            },
          },
        },
      } as unknown as AppConfigInput),
    Error,
    'ai.defaultModel 不支持环境变量展开',
  )

  assertThrows(
    () =>
      validateConfig({
        runtimeDir: '/tmp/runtime',
        ai: {
          defaultModel: '{{ entry.title }}',
          providers: {
            main: {
              type: 'openai',
              models: {
                mini: {
                  model: 'gpt-4o-mini',
                },
              },
            },
          },
        },
      } as unknown as AppConfigInput),
    Error,
    'ai.defaultModel 配置非法: ai.defaultModel 不支持 Liquid 模板',
  )
})

Deno.test('validateConfig: modelRef 裸 modelId 跨 provider 重名时应报错', () => {
  assertThrows(
    () =>
      validateConfig({
        runtimeDir: '/tmp/runtime',
        ai: {
          defaultModel: 'shared',
          providers: {
            openai_main: {
              type: 'openai',
              models: {
                shared: {
                  model: 'gpt-4o-mini',
                },
              },
            },
            anthropic_main: {
              type: 'anthropic',
              models: {
                shared: {
                  model: 'claude-3-5-haiku-latest',
                },
              },
            },
          },
        },
      } as unknown as AppConfigInput),
    Error,
    'ai.defaultModel 配置非法: 裸 modelId shared 存在多个 provider，请改用 providerId/modelId',
  )
})

Deno.test('validateConfig: variant 不允许覆盖 model 与 context', () => {
  assertThrows(
    () =>
      validateConfig({
        runtimeDir: '/tmp/runtime',
        ai: {
          providers: {
            main: {
              type: 'openai',
              models: {
                default: {
                  model: 'gpt-4o-mini',
                  variants: {
                    hot: {
                      model: 'gpt-4o',
                    },
                  },
                },
              },
            },
          },
        },
      } as unknown as AppConfigInput),
    Error,
    'ai.providers.main.models.default.variants.hot.model 非法',
  )

  assertThrows(
    () =>
      validateConfig({
        runtimeDir: '/tmp/runtime',
        ai: {
          providers: {
            main: {
              type: 'openai',
              models: {
                default: {
                  model: 'gpt-4o-mini',
                  variants: {
                    hot: {
                      context: 1,
                    },
                  },
                },
              },
            },
          },
        },
      } as unknown as AppConfigInput),
    Error,
    'ai.providers.main.models.default.variants.hot.context 非法',
  )
})

Deno.test('validateConfig: model 必须是静态字面量，不允许 ENV 或 Liquid', () => {
  assertThrows(
    () =>
      validateConfig({
        runtimeDir: '/tmp/runtime',
        ai: {
          providers: {
            main: {
              type: 'openai',
              models: {
                env_model: {
                  model: '${OPENAI_MODEL}',
                },
              },
            },
          },
        },
      } as unknown as AppConfigInput),
    Error,
    'ai.providers.main.models.env_model.model 不支持环境变量展开',
  )

  assertThrows(
    () =>
      validateConfig({
        runtimeDir: '/tmp/runtime',
        ai: {
          providers: {
            main: {
              type: 'openai',
              models: {
                liquid_model: {
                  model: '{{ entry.title }}',
                },
              },
            },
          },
        },
      } as unknown as AppConfigInput),
    Error,
    'ai.providers.main.models.liquid_model.model 配置非法: ai.providers.*.models.*.model 不支持 Liquid 模板',
  )
})

Deno.test('validateConfig: sources.filter 字符串字面量里的 AI filter 文本不应误报', () => {
  const validated = validateConfig({
    runtimeDir: '/tmp/runtime',
    sources: {
      feed: {
        http: {
          url: 'https://example.com/feed.xml',
        },
        filter: '{{ "literal | ai_translate: \"zh-CN\"" }}',
      },
    },
  } as unknown as AppConfigInput)

  assertEquals(validated.sources.feed.filter, '{{ "literal | ai_translate: \"zh-CN\"" }}')
})

Deno.test('validateConfig: sources.filter comment 里的 AI filter 文本不应误报', () => {
  const validated = validateConfig({
    runtimeDir: '/tmp/runtime',
    sources: {
      feed: {
        http: {
          url: 'https://example.com/feed.xml',
        },
        filter: '{% comment %}| ai_translate: "zh-CN"{% endcomment %}',
      },
    },
  } as unknown as AppConfigInput)

  assertEquals(
    validated.sources.feed.filter,
    '{% comment %}| ai_translate: "zh-CN"{% endcomment %}',
  )
})

Deno.test('validateConfig: sources.filter 真实命中 AI filter 且无可解析模型时应报错', () => {
  assertThrows(
    () =>
      validateConfig({
        runtimeDir: '/tmp/runtime',
        sources: {
          feed: {
            http: {
              url: 'https://example.com/feed.xml',
            },
            filter: '{{ title | ai_summarize }}',
          },
        },
      } as unknown as AppConfigInput),
    Error,
    'source.feed.filter 配置非法: 模板使用了 AI filter，但未解析到可用模型',
  )
})

Deno.test('validateConfig: 其他 Liquid 位点命中 AI filter 且无可解析模型时应报错', () => {
  const cases = [
    {
      name: 'deliveries.file.content',
      input: {
        runtimeDir: '/tmp/runtime',
        deliveries: {
          archive: {
            file: {
              path: 'out.txt',
              content: '{{ entry.title | ai_summarize }}',
            },
          },
        },
      },
      message: 'delivery.archive.file.content 配置非法: 模板使用了 AI filter，但未解析到可用模型',
    },
    {
      name: 'deliveries.push.request.payload.**',
      input: {
        runtimeDir: '/tmp/runtime',
        deliveries: {
          webhook: {
            push: {
              http: {
                method: 'POST',
                url: 'https://example.com/hook',
              },
              request: {
                type: 'body',
                payload: {
                  nested: {
                    text: '{{ entry.title | ai_summarize }}',
                  },
                },
              },
            },
          },
        },
      },
      message:
        'delivery.webhook.push.request.payload.nested.text 配置非法: 模板使用了 AI filter，但未解析到可用模型',
    },
    {
      name: 'deliveries.push.response.message',
      input: {
        runtimeDir: '/tmp/runtime',
        deliveries: {
          webhook: {
            push: {
              http: {
                method: 'POST',
                url: 'https://example.com/hook',
              },
              response: {
                message: '{{ body.error | ai_summarize }}',
              },
            },
          },
        },
      },
      message:
        'delivery.webhook.push.response.message 配置非法: 模板使用了 AI filter，但未解析到可用模型',
    },
    {
      name: 'deliveries.email.message.subject',
      input: {
        runtimeDir: '/tmp/runtime',
        deliveries: {
          release_email: {
            email: {
              smtp: {
                host: 'smtp.example.com',
                port: 465,
                security: 'implicit',
              },
              message: {
                from: 'bot@example.com',
                to: ['team@example.com'],
                subject: '{{ entry.title | ai_summarize }}',
                text: 'plain text',
              },
            },
          },
        },
      },
      message:
        'delivery.release_email.email.message.subject 配置非法: 模板使用了 AI filter，但未解析到可用模型',
    },
    {
      name: 'deliveries.email.message.headers.*',
      input: {
        runtimeDir: '/tmp/runtime',
        deliveries: {
          release_email: {
            email: {
              smtp: {
                host: 'smtp.example.com',
                port: 465,
                security: 'implicit',
              },
              message: {
                from: 'bot@example.com',
                to: ['team@example.com'],
                subject: 'hello',
                text: 'plain text',
                headers: {
                  'X-AI-Summary': '{{ entry.title | ai_summarize }}',
                },
              },
            },
          },
        },
      },
      message:
        'delivery.release_email.email.message.headers.X-AI-Summary 配置非法: 模板使用了 AI filter，但未解析到可用模型',
    },
    {
      name: 'sources.syndication.entry.*',
      input: {
        runtimeDir: '/tmp/runtime',
        sources: {
          feed: {
            http: {
              url: 'https://example.com/feed.xml',
            },
            syndication: {
              entry: {
                summary: '{{ entry.title | ai_summarize }}',
              },
            },
          },
        },
      },
      message:
        'source.feed.syndication.entry.summary 配置非法: 模板使用了 AI filter，但未解析到可用模型',
    },
  ] as const satisfies Array<{
    name: string
    input: AppConfigInput
    message: string
  }>

  for (const testCase of cases) {
    assertThrows(() => validateConfig(testCase.input), Error, testCase.message, testCase.name)
  }
})
